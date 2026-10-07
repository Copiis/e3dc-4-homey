import { formatError } from '../../utils/error-utils';
import { WallboxSchedule } from '../../model/wallbox';

/** Rich info stored per triggered plan so we can restore side-effects like dischargeSoc. */
export interface TriggeredWallboxScheduleInfo {
  action: string;
  /** If the plan overrode the global "Batterie entladen bis", this holds the value that was active right before the override. */
  savedDischargeSoc?: number;
  savedBatteryToCar?: boolean;
  savedBatteryBeforeCar?: boolean;
  savedMixBlocked?: boolean;
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
      /** Invalidate the WallboxManager EMS cache after we change the value (prevents stale cache overwriting the tile). */
      invalidateAssociatedEmsCache?(): void;
      /** Post to Homey timeline for important plan actions like global setting changes. */
      postTimelineNotification?(excerpt: string): void;
      setBatteryToCar(enabled: boolean): Promise<boolean>;
      setBatteryBeforeCar(enabled: boolean): Promise<boolean>;
      setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean>;
      getCapabilityValue(key: string): unknown;
      globalEmsOverrideManager?: { applyOverrides(planId: string, overrides: any): Promise<void>; restoreOverrides(planId: string): Promise<void>; };
    }
  ) {}

  async execute(s: WallboxSchedule, id: string, triggered: Map<string, TriggeredWallboxScheduleInfo>) {
    try {
      const info: TriggeredWallboxScheduleInfo = { action: s.action };

      // Snapshot "Batterie entladen bis" before any override so untilFull and
      // manual deletion can put the user value back. The live device applies
      // the override through GlobalEmsOverrideManager (one RSCP write). Without
      // that manager the executor writes the percent itself.
      const planOverrides: any = {};
      if (typeof s.dischargeSoc === 'number') {
        const current = this.currentDischargePercent();
        if (typeof current === 'number') info.savedDischargeSoc = current;
        planOverrides.dischargeBatteryUntilPercent = s.dischargeSoc;
      }
      if (s.batteryToCar !== undefined) planOverrides.batteryToCarAllowed = s.batteryToCar;
      if (s.batteryBeforeCar !== undefined) planOverrides.batteryBeforeCar = s.batteryBeforeCar;
      if (s.batteryDischargeMixBlocked !== undefined) planOverrides.batteryDischargeMixBlocked = s.batteryDischargeMixBlocked;

      if (Object.keys(planOverrides).length > 0 && this.device.globalEmsOverrideManager) {
        await this.device.globalEmsOverrideManager.applyOverrides(id, planOverrides);
      } else if (typeof s.dischargeSoc === 'number') {
        await this.writeDischargePercent(s.dischargeSoc, false);
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
  async revertActionForInfo(id: string, info: TriggeredWallboxScheduleInfo | undefined, force = true) {
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

    // One restore path. The manager owns the snapshot on the live device.
    // The saved percent is the fallback when that manager is absent.
    if (this.device.globalEmsOverrideManager && id) {
      await this.device.globalEmsOverrideManager.restoreOverrides(id);
    } else if (typeof info?.savedDischargeSoc === 'number') {
      await this.writeDischargePercent(info.savedDischargeSoc, true);
    }
  }

  private currentDischargePercent(): number | undefined {
    const fromGetter = this.device.getCurrentDischargeBatteryUntil();
    if (typeof fromGetter === 'number') return fromGetter;
    const fromCap = this.device.getCapabilityValue('measure_wallbox_discharge_soc');
    return typeof fromCap === 'number' ? fromCap : undefined;
  }

  private async writeDischargePercent(percent: number, restore: boolean): Promise<void> {
    await this.device.setDischargeBatteryUntil(percent);
    this.device.invalidateAssociatedEmsCache?.();
    const text = restore
      ? `Ladeplan beendet – "Batterie entladen bis" auf ${percent}% zurückgesetzt`
      : `Ladeplan hat "Batterie entladen bis" auf ${percent}% gesetzt`;
    this.device.postTimelineNotification?.(text);
  }

  /**
   * Legacy helper kept for compatibility with a few call sites that only know the action string.
   * When a richer info is available, prefer revertActionForInfo.
   */
  async revertAction(actionOrInfo: string | TriggeredWallboxScheduleInfo, force = true) {
    if (typeof actionOrInfo === 'string') {
      await this.revertActionForInfo('', { action: actionOrInfo }, force);
    } else {
      await this.revertActionForInfo('', actionOrInfo, force);
    }
  }

  async stopForUntilFull() {
    await this.device.applyChargingAllowed(false, undefined, true).catch(() => {});
  }
}
