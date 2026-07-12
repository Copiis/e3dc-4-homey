import { WallboxSchedule } from '../model/wallbox';
import { WallboxScheduleStore } from './wallbox-schedule/WallboxScheduleStore';
import { WallboxScheduleValidator } from './wallbox-schedule/WallboxScheduleValidator';
import { WallboxScheduleExecutor, TriggeredWallboxScheduleInfo } from './wallbox-schedule/WallboxScheduleExecutor';

/**
 * WallboxScheduleHandler (Koordinator)
 *
 * Nach Split schlank:
 * - Koordination + Timer
 * - Delegiert an Store, Validator, Executor
 */
export class WallboxScheduleHandler {
  private wallboxScheduleCheckId: NodeJS.Timeout | null = null;
  private store: WallboxScheduleStore;
  private validator: WallboxScheduleValidator;
  private executor: WallboxScheduleExecutor;
  private lastScheduleCheck = 0;
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
      /** For Wallbox Ladeplan dischargeSoc support: apply new value and read current for snapshot/restore. */
      setDischargeBatteryUntil(percent: number): Promise<boolean>;
      getCurrentDischargeBatteryUntil(): number | undefined;
    }
  ) {
    this.store = new WallboxScheduleStore(device);
    this.validator = new WallboxScheduleValidator();
    this.executor = new WallboxScheduleExecutor(device);
  }

  start() {
    if (this.wallboxScheduleCheckId) clearInterval(this.wallboxScheduleCheckId);
    this.wallboxScheduleCheckId = this.device.homey.setInterval(() => this.check(), 60 * 1000);
    setTimeout(() => this.check(), 3000);
  }

  stop() {
    if (this.wallboxScheduleCheckId) {
      clearInterval(this.wallboxScheduleCheckId);
      this.wallboxScheduleCheckId = null;
    }
  }

  async check() {
    const now = Date.now();
    if (now - (this.lastScheduleCheck || 0) < 5000) return;
    this.lastScheduleCheck = now;

    let schedules = this.store.getSchedules();

    this.store.revertDeleted(schedules, (info) => this.executor.revertAction(info, true));

    if (schedules.length === 0) return;

    await this.applyActive(schedules, now);
    await this.handleUntilFull(schedules, now);
    await this.cleanExpired(schedules, now);
    this.updateTile();
  }

  private async applyActive(schedules: WallboxSchedule[], now: number) {
    for (const s of schedules) {
      if (!this.validator.isActive(s, now)) continue;
      const id = this.validator.getId(s);
      if (!this.store.getTriggered().has(id)) {
        await this.executor.execute(s, id, this.store.getTriggered());
      }
    }
  }

  private async handleUntilFull(schedules: WallboxSchedule[], now: number) {
    let currentPower = 0;
    try {
      currentPower = Number(this.device.getCapabilityValue('measure_power')) || 0;
    } catch {}
    const absPower = Math.abs(currentPower);

    const plansToRemove: string[] = [];
    const triggered = this.store.getTriggered();
    const lowPowerState = this.store.getUntilFullState();

    for (const s of schedules) {
      const id = this.validator.getId(s);
      if (!s.untilFull || !triggered.has(id)) continue;
      const info = triggered.get(id);
      if (info?.action !== 'allow') continue;

      if (absPower < this.validator.LOW_POWER_THRESHOLD) {
        if (!lowPowerState[id]) {
          this.store.setLowPowerSince(id, now);
          this.device.log(`[WallboxLadeplan] Low power draw (${absPower}W) detected for untilFull plan ${id}`);
        } else if (this.validator.shouldRemoveForUntilFull(absPower, lowPowerState[id], now)) {
          this.device.log(`[WallboxLadeplan] untilFull reached for ${id}`);
          await this.executor.stopForUntilFull();
          // Ensure discharge restore even for untilFull plans (use the info we already fetched)
          if (info?.savedDischargeSoc !== undefined) {
            await this.executor.revertActionForInfo(info, true).catch(e => this.device.error('untilFull discharge restore: ' + e));
          }
          this.store.deleteTriggered(id);
          plansToRemove.push(id);
        }
      } else {
        if (lowPowerState[id]) {
          this.store.deleteLowPowerSince(id);
        }
      }
    }

    if (plansToRemove.length > 0) {
      const remaining = schedules.filter(s => !plansToRemove.includes(this.validator.getId(s)));
      await this.store.persistSchedules(remaining);
    }
  }

  private async cleanExpired(schedules: WallboxSchedule[], now: number) {
    const valid = this.validator.filterValid(schedules, now);
    if (valid.length < schedules.length) {
      const triggered = this.store.getTriggered();
      const ids = new Set(valid.map(s => this.validator.getId(s)));
      for (const [id, info] of triggered) {
        if (!ids.has(id)) {
          // Use rich info so that dischargeSoc override gets properly restored to original value
          await this.executor.revertActionForInfo(info, true).catch(e => this.device.error('Auto-clean revert: ' + e));
          this.store.deleteTriggered(id);
        }
      }
      await this.store.persistSchedules(valid);
    }
  }

  private updateTile() {
    const has = this.store.getTriggered().size > 0;
    if (has !== this._lastHasActivePlan) {
      this._lastHasActivePlan = has;
      this.device.applyLadeplanTileVisibility().catch(() => {});
    }
  }

  async handleManualDeletion(newSettings: Record<string, unknown>) {
    try {
      const json = (newSettings['schedules'] as string) || '[]';
      const fresh = this.store.parseSchedules(json);
      const newIds = new Set(fresh.map(s => this.validator.getId(s)));
      const triggered = this.store.getTriggered();
      for (const [id, info] of triggered.entries()) {
        if (!newIds.has(id)) {
          this.device.log(`[WallboxLadeplan] Manually deleted ${id} — reverting (incl. discharge restore if any)`);
          await this.executor.revertActionForInfo(info, true).catch(e => this.device.error('onSettings revert error: ' + e));
          this.store.deleteTriggered(id);
        }
      }
    } catch (e) {
      this.device.error('Manual schedule delete handling failed: ' + e);
    }
  }

  clear() {
    this.store.clear();
  }

  hasActivePlan(): boolean {
    return this.store.getTriggered().size > 0;
  }
}
