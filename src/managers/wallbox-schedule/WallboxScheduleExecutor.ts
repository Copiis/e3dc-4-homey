import { formatError } from '../../utils/error-utils';
import { WallboxSchedule } from '../../model/wallbox';

/** Rich info stored per triggered plan so we can restore side-effects like dischargeSoc. */
export interface TriggeredWallboxScheduleInfo {
  action: string;
  /** If the plan overrode the global "Batterie entladen bis", this holds the value that was active right before the override. */
  savedDischargeSoc?: number;
}

/**
 * WallboxScheduleExecutor
 *
 * Execution of schedule actions and reverts.
 * Now also handles temporary override of "Entlade Hausakku bis %" (dischargeBatteryUntilPercent)
 * with guaranteed restore of the original value when the plan ends (or is deleted).
 */
export class WallboxScheduleExecutor {
  constructor(
    private readonly device: {
      applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force?: boolean): Promise<unknown>;
      applySunMode(enabled: boolean, maxCurrentA?: number, force?: boolean): Promise<unknown>;
      setCurrentLimit(maxCurrentA: number): Promise<unknown>;
      log(msg: string): void;
      error(msg: string): void;
      /** Discharge battery until % (global EMS). Snapshot original on plan start, restore on end. */
      setDischargeBatteryUntil(percent: number): Promise<boolean>;
      getCurrentDischargeBatteryUntil(): number | undefined;
    }
  ) {}

  async execute(s: WallboxSchedule, id: string, triggered: Map<string, TriggeredWallboxScheduleInfo>) {
    try {
      const info: TriggeredWallboxScheduleInfo = { action: s.action };

      // === DISCHARGE SOC OVERRIDE (user requirement: must restore original after plan ends) ===
      if (typeof s.dischargeSoc === 'number' && s.dischargeSoc >= 0 && s.dischargeSoc <= 100) {
        const current = this.device.getCurrentDischargeBatteryUntil();
        if (typeof current === 'number' && current !== s.dischargeSoc) {
          info.savedDischargeSoc = current;
        }
        try {
          const setOk = await this.device.setDischargeBatteryUntil(s.dischargeSoc);
          if (setOk) {
            this.device.log?.(`[WallboxLadeplan] set dischargeSoc=${s.dischargeSoc}% (previous=${current ?? 'n/a'}%) for plan ${id} — ok`);
          } else {
            this.device.log?.(`[WallboxLadeplan] set dischargeSoc=${s.dischargeSoc}% (previous=${current ?? 'n/a'}%) for plan ${id} — set returned false (E3DC may have ignored or delayed)`);
          }
        } catch (e) {
          this.device.error('Schedule dischargeSoc apply failed: ' + formatError(e));
        }
      }

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

      triggered.set(id, info);
    } catch (e) {
      this.device.error('Schedule apply error: ' + formatError(e));
    }
  }

  /**
   * Revert the action side effects. If a savedDischargeSoc exists for this activation,
   * the original value is restored. This fulfills the requirement that after a wallbox
   * Ladeplan ends, user-configured "Batterie entladen bis" is put back.
   */
  async revertActionForInfo(info: TriggeredWallboxScheduleInfo | undefined, force = true) {
    const action = info?.action ?? '';

    if (action === 'allow') {
      await this.device.applyChargingAllowed(false, undefined, force);
    } else if (action === 'block') {
      await this.device.applyChargingAllowed(true, undefined, force);
    } else if (action === 'sun_on') {
      await this.device.applySunMode(false, undefined, force);
    } else if (action === 'sun_off') {
      await this.device.applySunMode(true, undefined, force);
    }

    // Restore original discharge value if this plan had overridden it
    if (info && typeof info.savedDischargeSoc === 'number') {
      try {
        const setOk = await this.device.setDischargeBatteryUntil(info.savedDischargeSoc);
        if (setOk) {
          this.device.log?.(`[WallboxLadeplan] restored original dischargeSoc=${info.savedDischargeSoc}% after plan ended — ok`);
        } else {
          this.device.log?.(`[WallboxLadeplan] restored original dischargeSoc=${info.savedDischargeSoc}% after plan ended — set returned false`);
        }
      } catch (e) {
        this.device.error('Schedule dischargeSoc restore failed: ' + formatError(e));
      }
    }
  }

  /**
   * Legacy helper kept for compatibility with a few call sites that only know the action string.
   * When a richer info is available, prefer revertActionForInfo.
   */
  async revertAction(actionOrInfo: string | TriggeredWallboxScheduleInfo, force = true) {
    if (typeof actionOrInfo === 'string') {
      await this.revertActionForInfo({ action: actionOrInfo }, force);
    } else {
      await this.revertActionForInfo(actionOrInfo, force);
    }
  }

  async stopForUntilFull() {
    await this.device.applyChargingAllowed(false, undefined, true).catch(() => {});
  }
}
