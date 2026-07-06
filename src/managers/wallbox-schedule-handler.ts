import { WallboxSchedule } from '../model/wallbox';
import { formatError } from '../utils/error-utils';

/**
 * WallboxScheduleHandler
 *
 * Extrahierte Logik für Wallbox-spezifische Ladepläne (Schedules).
 * 
 * Verantwortlichkeiten:
 * - Parsen und Verwalten von Schedules aus Settings
 * - Periodisches Prüfen und Anwenden aktiver Pläne
 * - Sofortiges Revertieren bei manuellem Löschen
 * - Behandlung von untilFull / vehicle SOC Bedingungen
 * - Auto-Cleanup abgelaufener Pläne
 * - Tile-Visibility Updates für Ladepläne
 *
 * Wird vom WallboxDevice verwendet, um den Device schlank zu halten.
 * Entkoppelt Schedule-Logik von Hardware- und Flow-Logik.
 */
export class WallboxScheduleHandler {
  private wallboxScheduleCheckId: NodeJS.Timeout | null = null;
  private triggeredWallboxSchedules: Map<string, string> = new Map();
  private lastScheduleCheck = 0;
  private untilFullLowPowerSince: Record<string, number> = {};
  private _lastHasActivePlan: boolean = false;

  constructor(
    private readonly device: {
      getSetting(key: string): unknown;
      setSettings(settings: Record<string, unknown>): Promise<void>;
      log(msg: string): void;
      error(msg: string): void;
      homey: {
        setInterval(fn: () => void, ms: number): NodeJS.Timeout;
        setTimeout(fn: () => void, ms: number): NodeJS.Timeout;
      };
      getCapabilityValue(key: string): unknown;
      applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force?: boolean): Promise<unknown>;
      applySunMode(enabled: boolean, maxCurrentA?: number, force?: boolean): Promise<unknown>;
      setCurrentLimit(maxCurrentA: number): Promise<unknown>;
      applyLadeplanTileVisibility(): Promise<void>;
    }
  ) {}

  /**
   * Startet den periodischen Scheduler für Ladepläne (alle 60 Sekunden, wie beim HKW).
   * Sollte in onInit des Devices aufgerufen werden.
   */
  start() {
    if (this.wallboxScheduleCheckId) clearInterval(this.wallboxScheduleCheckId);
    // 60s wie beim HKW
    this.wallboxScheduleCheckId = this.device.homey.setInterval(() => this.check(), 60 * 1000);
    setTimeout(() => this.check(), 3000);
  }

  stop() {
    if (this.wallboxScheduleCheckId) {
      clearInterval(this.wallboxScheduleCheckId);
      this.wallboxScheduleCheckId = null;
    }
  }

  /**
   * Parst die Schedules aus dem JSON-String der Settings.
   * Gibt leeres Array bei Fehlern zurück.
   */
  private parseSchedules(json: string): WallboxSchedule[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed as WallboxSchedule[] : [];
    } catch {
      return [];
    }
  }

  /**
   * Führt das Revert einer Schedule-Action aus (allow/block/sun_on/sun_off).
   * @param force - Ob Force-Modus verwendet werden soll
   */
  private async revertAction(action: string, force = true) {
    if (action === 'allow') {
      await this.device.applyChargingAllowed(false, undefined, force);
    } else if (action === 'block') {
      await this.device.applyChargingAllowed(true, undefined, force);
    } else if (action === 'sun_on') {
      await this.device.applySunMode(false, undefined, force);
    } else if (action === 'sun_off') {
      await this.device.applySunMode(true, undefined, force);
    }
  }

  /**
   * Führt einen vollständigen Check aller Schedules durch:
   * - Revert manuell gelöschter Pläne
   * - Anwenden aktiver Pläne
   * - Behandlung untilFull
   * - Cleanup abgelaufener Pläne
   * - Update der Tile-Visibility
   */
  async check() {
    const now = Date.now();
    if (now - (this.lastScheduleCheck || 0) < 5000) return;
    this.lastScheduleCheck = now;

    const json = (this.device.getSetting('schedules') as string) || '[]';
    let schedules: WallboxSchedule[] = this.parseSchedules(json);

    this.revertDeleted(schedules);

    if (schedules.length === 0) return;

    await this.applyActive(schedules, now);
    await this.handleUntilFull(schedules, now);
    await this.cleanExpired(schedules, now);
    this.updateTile();
  }

  private revertDeleted(schedules: WallboxSchedule[]) {
    const currentIds = new Set(schedules.map(s => s.id || (s.start + '_' + s.action)));
    for (const [id, action] of this.triggeredWallboxSchedules.entries()) {
      if (!currentIds.has(id)) {
        this.device.log(`Wallbox schedule ${id} manually deleted, reverting action ${action}`);
        this.revertAction(action, true).catch(e =>
          this.device.error('Error reverting deleted schedule: ' + formatError(e))
        );
        this.triggeredWallboxSchedules.delete(id);
        delete this.untilFullLowPowerSince[id];
      }
    }
  }

  private async applyActive(schedules: WallboxSchedule[], now: number) {
    for (const s of schedules) {
      if (!s?.start || !s.action) continue;
      const id = s.id || (s.start + '_' + s.action);
      const startTs = typeof s.startTs === 'number' ? s.startTs : new Date(s.start).getTime();
      if (isNaN(startTs)) continue;

      let endTs: number | null = null;
      if (s.untilFull) endTs = null;
      else if (typeof s.endTs === 'number') endTs = s.endTs;
      else if (s.end) endTs = new Date(s.end).getTime();

      const active = now >= startTs && (endTs === null || now < endTs);
      if (active && !this.triggeredWallboxSchedules.has(id)) {
        await this.execute(s, id);
      }
    }
  }

  private async execute(s: WallboxSchedule, id: string) {
    try {
      if (s.action === 'allow') {
        await this.device.applySunMode(false, undefined, true);
        await this.device.applyChargingAllowed(true, s.current, true);
        if (s.current) await this.device.setCurrentLimit(s.current);
      } else if (s.action === 'block') {
        await this.device.applyChargingAllowed(false);
      } else if (s.action === 'sun_on') {
        await this.device.applySunMode(true);
      } else if (s.action === 'sun_off') {
        await this.device.applySunMode(false);
      }
      this.triggeredWallboxSchedules.set(id, s.action);
    } catch (e) {
      this.device.error('Schedule apply error: ' + formatError(e));
    }
  }

  private async handleUntilFull(schedules: WallboxSchedule[], now: number) {
    // Until full for Wallbox: we do NOT use vehicle SOC (not reliably available like house battery).
    // Instead we monitor the wallbox power draw. If after the plan has started,
    // the power stays very low for a longer period, we consider the car full,
    // stop charging and remove the plan.
    let currentPower = 0;
    try {
      currentPower = Number(this.device.getCapabilityValue('measure_power')) || 0;
    } catch (e) {
      // ignore, use 0
    }
    const absPower = Math.abs(currentPower);

    const LOW_POWER_THRESHOLD = 80;      // W
    const LOW_POWER_DURATION_MS = 5 * 60 * 1000; // 5 minutes of low power

    const plansToRemove: string[] = [];

    for (const s of schedules) {
      const id = s.id || (s.start + '_' + s.action);
      if (!s.untilFull || !this.triggeredWallboxSchedules.has(id)) continue;

      const action = this.triggeredWallboxSchedules.get(id);
      if (action !== 'allow') continue; // "bis voll" typically applies to allow charging

      if (absPower < LOW_POWER_THRESHOLD) {
        if (!this.untilFullLowPowerSince[id]) {
          this.untilFullLowPowerSince[id] = now;
          this.device.log(`[WallboxLadeplan] Low power draw (${absPower}W) detected for untilFull plan ${id} — starting low-power timer`);
        } else if (now - this.untilFullLowPowerSince[id] >= LOW_POWER_DURATION_MS) {
          this.device.log(`[WallboxLadeplan] untilFull reached for ${id} (low power for >5 min after start). Stopping and removing plan.`);
          await this.device.applyChargingAllowed(false, undefined, true).catch(() => {});
          this.triggeredWallboxSchedules.delete(id);
          delete this.untilFullLowPowerSince[id];
          plansToRemove.push(id);
        }
      } else {
        // power is flowing again → reset the low-power timer
        if (this.untilFullLowPowerSince[id]) {
          delete this.untilFullLowPowerSince[id];
          this.device.log(`[WallboxLadeplan] Power draw resumed for untilFull plan ${id}, timer reset`);
        }
      }
    }

    if (plansToRemove.length > 0) {
      const remaining = schedules.filter(s => {
        const sid = s.id || (s.start + '_' + (s.action || ''));
        return !plansToRemove.includes(sid);
      });
      await this.device.setSettings({ schedules: JSON.stringify(remaining) }).catch(() => {});
    }
  }

  private async cleanExpired(schedules: WallboxSchedule[], now: number) {
    const before = schedules.length;
    const valid = schedules.filter(s => {
      if (!s?.start) return false;
      if (s.untilFull) return true;
      const eTs = typeof s.endTs === 'number' ? s.endTs : (s.end ? new Date(s.end).getTime() : null);
      return !(eTs && now >= eTs);
    });

    if (valid.length < before) {
      const ids = new Set(valid.map(s => s.id || (s.start + '_' + s.action)));
      for (const [id, action] of this.triggeredWallboxSchedules) {
        if (!ids.has(id)) {
          await this.revertAction(action, true).catch(e =>
            this.device.error('Auto-clean revert: ' + formatError(e))
          );
          this.triggeredWallboxSchedules.delete(id);
          delete this.untilFullLowPowerSince[id];
        }
      }
      await this.device.setSettings({ schedules: JSON.stringify(valid) }).catch(() => {});
    }
  }

  private updateTile() {
    const has = this.triggeredWallboxSchedules.size > 0;
    if (has !== this._lastHasActivePlan) {
      this._lastHasActivePlan = has;
      this.device.applyLadeplanTileVisibility().catch(() => {});
    }
  }

  /**
   * Wird von onSettings aufgerufen, wenn Schedules geändert wurden.
   * Behandelt sofortiges Revert von manuell gelöschten laufenden Plänen.
   */
  async handleManualDeletion(newSettings: Record<string, unknown>) {
    try {
      const json = (newSettings['schedules'] as string) || '[]';
      const fresh = this.parseSchedules(json);
      const newIds = new Set(fresh.map(s => s.id || (s.start + '_' + (s.action || ''))));

      for (const [id, action] of this.triggeredWallboxSchedules.entries()) {
        if (!newIds.has(id)) {
          this.device.log(`[WallboxLadeplan] Manually deleted ${id} — reverting`);
          await this.revertAction(action, true).catch(e =>
            this.device.error('onSettings revert error: ' + formatError(e))
          );
          this.triggeredWallboxSchedules.delete(id);
          delete this.untilFullLowPowerSince[id];
        }
      }
    } catch (e) {
      this.device.error('Manual schedule delete handling failed: ' + formatError(e));
    }
  }

  /**
   * Löscht alle getriggerten Pläne (z.B. bei manuellem Reset).
   */
  clear() {
    this.triggeredWallboxSchedules.clear();
    this.untilFullLowPowerSince = {};
  }

  /**
   * Gibt zurück, ob aktuell ein Ladeplan aktiv ist.
   * Wird für Tile-Visibility verwendet.
   */
  hasActivePlan(): boolean {
    return this.triggeredWallboxSchedules.size > 0;
  }
}
