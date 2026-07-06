import { EmsSchedule } from '../../model/home-power-station';
import { IHpsDevice } from '../../types/hps-device';
import { formatError } from '../../utils/error-utils';
import { getScheduleId, parseDateTime, pruneExpiredSchedules } from '../../utils/ems-schedule-utils';

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
  private triggeredEmsSchedules: Set<string> = new Set();

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

  /** Persistiert den aktuellen Stand */
  persist(): void {
    this.device.setSettings({ emsSchedules: JSON.stringify(this.emsSchedules) })
      .catch((e: unknown) => this.logger.error('Failed to persist schedules: ' + formatError(e)));
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
