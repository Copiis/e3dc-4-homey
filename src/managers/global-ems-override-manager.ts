import { WallboxEmsSettings } from '../model/wallbox-ems-settings';

/**
 * GlobalEmsOverrideManager
 *
 * Handles temporary overrides of global EMS settings (e.g. from Wallbox Ladepläne).
 * Snapshots original values, applies overrides, and restores on plan end.
 * This centralizes the logic that was previously scattered in the schedule executor.
 */
export class GlobalEmsOverrideManager {
  private overrides: Map<string, Partial<WallboxEmsSettings>> = new Map(); // planId -> original values

  constructor(
    private readonly device: {
      getCapabilityValue(key: string): unknown;
      setDischargeBatteryUntil(percent: number): Promise<boolean>;
      setBatteryToCar(enabled: boolean): Promise<boolean>;
      setBatteryBeforeCar(enabled: boolean): Promise<boolean>;
      setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean>;
      invalidateAssociatedEmsCache?(): void;
      postTimelineNotification?(excerpt: string): void;
      log(msg: string): void;
      error(msg: string): void;
    }
  ) {}

  async applyOverrides(planId: string, overrides: Partial<WallboxEmsSettings>): Promise<void> {
    const original: Partial<WallboxEmsSettings> = {};

    if (typeof overrides.dischargeBatteryUntilPercent === 'number') {
      const current = this.device.getCapabilityValue('measure_wallbox_discharge_soc') as number | undefined;
      if (typeof current === 'number' && current !== overrides.dischargeBatteryUntilPercent) {
        original.dischargeBatteryUntilPercent = current;
      }
      await this.device.setDischargeBatteryUntil(overrides.dischargeBatteryUntilPercent);
      this.device.postTimelineNotification?.(`Ladeplan hat "Batterie entladen bis" auf ${overrides.dischargeBatteryUntilPercent}% gesetzt`);
    }

    if (typeof overrides.batteryToCarAllowed === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_battery_discharge_sun') as boolean | undefined;
      if (typeof current === 'boolean' && current !== overrides.batteryToCarAllowed) {
        original.batteryToCarAllowed = current;
      }
      await this.device.setBatteryToCar(overrides.batteryToCarAllowed);
      this.device.postTimelineNotification?.(`Ladeplan hat "Batterie für Auto" auf ${overrides.batteryToCarAllowed} gesetzt`);
    }

    if (typeof overrides.batteryBeforeCar === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_priority_battery_first') as boolean | undefined;
      if (typeof current === 'boolean' && current !== overrides.batteryBeforeCar) {
        original.batteryBeforeCar = current;
      }
      await this.device.setBatteryBeforeCar(overrides.batteryBeforeCar);
      this.device.postTimelineNotification?.(`Ladeplan hat "Auto vor Batterie" auf ${overrides.batteryBeforeCar} gesetzt`);
    }

    if (typeof overrides.batteryDischargeMixBlocked === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_battery_discharge_mix') as boolean | undefined;
      if (typeof current === 'boolean' && current !== !overrides.batteryDischargeMixBlocked) {
        original.batteryDischargeMixBlocked = !current; // store as blocked
      }
      await this.device.setDisableBatteryAtMixMode(overrides.batteryDischargeMixBlocked);
      this.device.postTimelineNotification?.(`Ladeplan hat Mix-Modus-Entladung auf ${overrides.batteryDischargeMixBlocked ? 'gesperrt' : 'erlaubt'} gesetzt`);
    }

    if (Object.keys(original).length > 0) {
      this.overrides.set(planId, original);
    }

    this.device.invalidateAssociatedEmsCache?.();
  }

  async restoreOverrides(planId: string): Promise<void> {
    const original = this.overrides.get(planId);
    if (!original) return;

    if (typeof original.dischargeBatteryUntilPercent === 'number') {
      await this.device.setDischargeBatteryUntil(original.dischargeBatteryUntilPercent);
      this.device.postTimelineNotification?.(`Ladeplan beendet – "Batterie entladen bis" auf ${original.dischargeBatteryUntilPercent}% zurückgesetzt`);
    }
    if (typeof original.batteryToCarAllowed === 'boolean') {
      await this.device.setBatteryToCar(original.batteryToCarAllowed);
      this.device.postTimelineNotification?.(`Ladeplan beendet – "Batterie für Auto" auf ${original.batteryToCarAllowed} zurückgesetzt`);
    }
    if (typeof original.batteryBeforeCar === 'boolean') {
      await this.device.setBatteryBeforeCar(original.batteryBeforeCar);
      this.device.postTimelineNotification?.(`Ladeplan beendet – "Auto vor Batterie" auf ${original.batteryBeforeCar} zurückgesetzt`);
    }
    if (typeof original.batteryDischargeMixBlocked === 'boolean') {
      await this.device.setDisableBatteryAtMixMode(original.batteryDischargeMixBlocked);
      this.device.postTimelineNotification?.(`Ladeplan beendet – Mix-Modus-Entladung zurückgesetzt`);
    }

    this.overrides.delete(planId);
    this.device.invalidateAssociatedEmsCache?.();
  }

  clear() {
    this.overrides.clear();
  }
}
