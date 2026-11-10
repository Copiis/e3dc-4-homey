import { EmsSchedule } from '../../model/home-power-station';
import { IHpsDevice } from '../../types/hps-device';
import { formatError } from '../../utils/error-utils';
import { getScheduleId, parseDateTime, pruneExpiredSchedules } from '../../utils/ems-schedule-utils';
import { updateEmsSchedules } from '../../utils/ems-schedule-write';

/**
 * EmsScheduleStore
 *
 * Zuständig für:
 * - Laden & Parsen der Schedules aus den Device-Settings
 * - Pruning abgelaufener Pläne + Persistierung
 * - Verwaltung des triggeredEmsSchedules-Sets
 * - Aufräumen bei manuell gelöschten Plänen
 * - Entfernen abgeschlossener Pläne
 *
 * Reine Store-Logik, keine Business-Regeln und keine Timer/Execution.
 * Wird vom EmsScheduleManager orchestriert.
 */
export class EmsScheduleStore {
  private emsSchedules: EmsSchedule[] = [];
  /** Ids seen at the last read. A later save only removes ids from this set. */
  private baselineIds: Set<string> = new Set();
  private triggeredEmsSchedules: Set<string> = new Set();
  /** Plans that already reached untilSoc. Must not be restarted in the same process. */
  private finishedScheduleIds: Set<string> = new Set();

  constructor(
    private readonly device: IHpsDevice,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void }
  ) {}

  /** Aktuell geladene Schedules (Kopie für Sicherheit) */
  getSchedules(): EmsSchedule[] {
    return [...this.emsSchedules];
  }

  /** IDs der bereits getriggerten Schedules */
  getTriggeredIds(): Set<string> {
    return new Set(this.triggeredEmsSchedules);
  }

  hasTriggered(id: string): boolean {
    return this.triggeredEmsSchedules.has(id);
  }

  addTriggered(id: string): void {
    this.triggeredEmsSchedules.add(id);
  }

  deleteTriggered(id: string): void {
    this.triggeredEmsSchedules.delete(id);
  }

  markFinished(id: string): void {
    if (id) {
      this.finishedScheduleIds.add(id);
    }
  }

  hasFinished(id: string): boolean {
    return this.finishedScheduleIds.has(id);
  }

  clearTriggered(): void {
    this.triggeredEmsSchedules.clear();
  }

  /** Lädt Schedules aus Settings, parsed, pruned und räumt auf. Persistiert bei Bedarf. */
  loadFromSettings(): EmsSchedule[] {
    const json = (this.device.getSetting('emsSchedules') as string) || '[]';
    try {
      let parsed: unknown = JSON.parse(json);
      if (!Array.isArray(parsed)) parsed = [];
      this.emsSchedules = parsed as EmsSchedule[];
      this.rememberBaseline();

      this.logger.log(`[Ladeplan] device=${this.device.getData().id} raw json length: ${json.length}, parsed ${this.emsSchedules.length} plans`);
      this.device.recordAnalysisEvent('info', `[Ladeplan] Loaded ${this.emsSchedules.length} plans from settings (device=${this.device.getData().id})`);

      const now = Date.now();
      const before = this.emsSchedules.length;
      this.emsSchedules = pruneExpiredSchedules(this.emsSchedules, now);

      if (this.emsSchedules.length < before) {
        this.logger.log('Cleaned expired EMS schedules on load');
        this.persist();
      }

      // Cleanup triggered for schedules that no longer exist
      const currentIds = new Set(this.emsSchedules.map((s: EmsSchedule) => getScheduleId(s)));
      this.triggeredEmsSchedules.forEach(id => {
        if (!currentIds.has(id)) this.triggeredEmsSchedules.delete(id);
      });

      return [...this.emsSchedules];
    } catch (e) {
      this.logger.error('Failed to parse emsSchedules: ' + formatError(e));
      this.emsSchedules = [];
      return [];
    }
  }

  /** Frisches Refresh aus Settings (wird im Checker genutzt) */
  refreshFromSettings(): void {
    try {
      const json = (this.device.getSetting('emsSchedules') as string) || '[]';
      const fresh = JSON.parse(json);
      if (Array.isArray(fresh)) {
        if (fresh.length !== this.emsSchedules.length) {
          this.logger.log(`[Ladeplan] refreshed from setting: ${fresh.length} plans (was ${this.emsSchedules.length})`);
        }
        this.emsSchedules = fresh;
        this.rememberBaseline();
      }
    } catch (_) {
      // ignore parse errors here – handled on next full load
    }
  }

  /** Prune + persist (wird sowohl von load als auch check verwendet) */
  pruneAndPersistIfNeeded(now: number = Date.now()): boolean {
    const beforeLen = this.emsSchedules.length;
    this.emsSchedules = pruneExpiredSchedules(this.emsSchedules, now);

    if (this.emsSchedules.length < beforeLen) {
      this.logger.log('[Ladeplan] Removed expired plans from storage');

      const remainingIds = new Set(this.emsSchedules.map((s: EmsSchedule) => getScheduleId(s)));
      this.triggeredEmsSchedules.forEach(id => {
        if (!remainingIds.has(id)) this.triggeredEmsSchedules.delete(id);
      });

      this.persist();
      return true;
    }
    return false;
  }

  /** Ids that were in the last read and are no longer in memory. */
  private removedSinceRead(): Set<string> {
    const keep = new Set(this.emsSchedules.map(schedule => getScheduleId(schedule)));
    const removed = new Set<string>();
    this.baselineIds.forEach(id => {
      if (id && !keep.has(id)) removed.add(id);
    });
    return removed;
  }

  private rememberBaseline(): void {
    this.baselineIds = new Set(this.emsSchedules.map(schedule => getScheduleId(schedule)));
  }

  /**
   * Drops finished plans from the list that is stored right now.
   * A plan added in the meantime stays. An already removed plan is not put back.
   */
  persist(): void {
    const removed = this.removedSinceRead();
    if (removed.size === 0) return;
    updateEmsSchedules(this.device, current =>
      current.filter(schedule => !removed.has(getScheduleId(schedule))),
    ).then(() => {
      removed.forEach(id => this.baselineIds.delete(id));
    }).catch((e: unknown) => this.logger.error('Failed to persist schedules: ' + formatError(e)));
  }

  /** Entfernt einen abgeschlossenen Plan und persistiert */
  removeCompleted(scheduleId: string): void {
    const before = this.emsSchedules.length;
    this.emsSchedules = this.emsSchedules.filter((s: EmsSchedule) => getScheduleId(s) !== scheduleId);
    if (this.emsSchedules.length < before) {
      this.logger.log(`Removing completed EMS schedule ${scheduleId}`);
      this.persist();
    }
  }

  /** Prüft ob ein Schedule mit der ID noch existiert */
  isStillPresent(id: string): boolean {
    return this.emsSchedules.some((p: EmsSchedule) => getScheduleId(p) === id);
  }

  /** Liefert die aktuelle Liste (intern genutzt) */
  get internalSchedules(): EmsSchedule[] {
    return this.emsSchedules;
  }

  /**
   * Prüft ob ein laufender (über PowerModeState referenzierter) Plan noch existiert.
   * Räumt bei Bedarf auf und liefert true, wenn revert notwendig ist.
   */
  handleDeletedActiveSchedule(activeId: string): boolean {
    if (!activeId) return false;
    const stillPresent = this.isStillPresent(activeId);
    if (!stillPresent) {
      this.logger.log(`[Ladeplan] Manually deleted running schedule ${activeId}`);
      this.triggeredEmsSchedules.delete(activeId);
      return true; // caller should revert
    }
    return false;
  }
}
