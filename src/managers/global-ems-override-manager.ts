import { WallboxEmsSettings } from '../model/wallbox-ems-settings';
import { deviceText } from '../utils/device-i18n';

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
      translate?: (key: string, tags?: Record<string, string | number>) => string;
      homey?: { __?: (key: string, tags?: Record<string, string | number>) => string };
    }
  ) {}

  private text(key: string, tags: Record<string, string | number> | undefined, fallback: string): string {
    return deviceText(this.device, key, tags, fallback);
  }

  private yesNo(value: boolean): string {
    return value
      ? this.text('timeline.state-yes', undefined, 'Ja')
      : this.text('timeline.state-no', undefined, 'Nein');
  }

  private blockedWord(blocked: boolean): string {
    return blocked
      ? this.text('timeline.state-blocked', undefined, 'gesperrt')
      : this.text('timeline.state-allowed', undefined, 'erlaubt');
  }

  async applyOverrides(planId: string, overrides: Partial<WallboxEmsSettings>): Promise<void> {
    const original: Partial<WallboxEmsSettings> = {};

    if (typeof overrides.dischargeBatteryUntilPercent === 'number') {
      const current = this.device.getCapabilityValue('measure_wallbox_discharge_soc') as number | undefined;
      if (typeof current === 'number' && current !== overrides.dischargeBatteryUntilPercent) {
        original.dischargeBatteryUntilPercent = current;
      }
      await this.device.setDischargeBatteryUntil(overrides.dischargeBatteryUntilPercent);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-discharge-set',
        { PERCENT: overrides.dischargeBatteryUntilPercent },
        `Ladeplan hat "Batterie entladen bis" auf ${overrides.dischargeBatteryUntilPercent}% gesetzt`,
      ));
    }

    if (typeof overrides.batteryToCarAllowed === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_battery_discharge_sun') as boolean | undefined;
      if (typeof current === 'boolean' && current !== overrides.batteryToCarAllowed) {
        original.batteryToCarAllowed = current;
      }
      await this.device.setBatteryToCar(overrides.batteryToCarAllowed);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-battery-to-car-set',
        { STATE: this.yesNo(overrides.batteryToCarAllowed) },
        `Ladeplan hat "Batterie für Auto" auf ${overrides.batteryToCarAllowed} gesetzt`,
      ));
    }

    if (typeof overrides.batteryBeforeCar === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_priority_battery_first') as boolean | undefined;
      if (typeof current === 'boolean' && current !== overrides.batteryBeforeCar) {
        original.batteryBeforeCar = current;
      }
      await this.device.setBatteryBeforeCar(overrides.batteryBeforeCar);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-battery-before-car-set',
        { STATE: this.yesNo(overrides.batteryBeforeCar) },
        `Ladeplan hat "Auto vor Batterie" auf ${overrides.batteryBeforeCar} gesetzt`,
      ));
    }

    if (typeof overrides.batteryDischargeMixBlocked === 'boolean') {
      const current = this.device.getCapabilityValue('wallbox_battery_discharge_mix') as boolean | undefined;
      if (typeof current === 'boolean' && current !== !overrides.batteryDischargeMixBlocked) {
        original.batteryDischargeMixBlocked = !current; // store as blocked
      }
      await this.device.setDisableBatteryAtMixMode(overrides.batteryDischargeMixBlocked);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-mix-set',
        { STATE: this.blockedWord(overrides.batteryDischargeMixBlocked) },
        `Ladeplan hat Mix-Modus-Entladung auf ${overrides.batteryDischargeMixBlocked ? 'gesperrt' : 'erlaubt'} gesetzt`,
      ));
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
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-discharge-restored',
        { PERCENT: original.dischargeBatteryUntilPercent },
        `Ladeplan beendet – "Batterie entladen bis" auf ${original.dischargeBatteryUntilPercent}% zurückgesetzt`,
      ));
    }
    if (typeof original.batteryToCarAllowed === 'boolean') {
      await this.device.setBatteryToCar(original.batteryToCarAllowed);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-battery-to-car-restored',
        { STATE: this.yesNo(original.batteryToCarAllowed) },
        `Ladeplan beendet – "Batterie für Auto" auf ${original.batteryToCarAllowed} zurückgesetzt`,
      ));
    }
    if (typeof original.batteryBeforeCar === 'boolean') {
      await this.device.setBatteryBeforeCar(original.batteryBeforeCar);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-battery-before-car-restored',
        { STATE: this.yesNo(original.batteryBeforeCar) },
        `Ladeplan beendet – "Auto vor Batterie" auf ${original.batteryBeforeCar} zurückgesetzt`,
      ));
    }
    if (typeof original.batteryDischargeMixBlocked === 'boolean') {
      await this.device.setDisableBatteryAtMixMode(original.batteryDischargeMixBlocked);
      this.device.postTimelineNotification?.(this.text(
        'timeline.plan-mix-restored',
        undefined,
        'Ladeplan beendet – Mix-Modus-Entladung zurückgesetzt',
      ));
    }

    this.overrides.delete(planId);
    this.device.invalidateAssociatedEmsCache?.();
  }

  clear() {
    this.overrides.clear();
  }
}
