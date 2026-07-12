import { formatError } from '../utils/error-utils';
import { Wallbox } from '../model/wallbox';

/**
 * WallboxEmsSettingsManager
 *
 * Extrahiert die repetitiven EMS-Setting Calls für die Wallbox (Battery mix, discharge until etc.).
 */
export class WallboxEmsSettingsManager {
  constructor(
    private readonly device: Wallbox & { getApi(): Promise<any>; refreshEmsSettings(): Promise<void>; log: (m: string) => void; error: (m: string) => void }
  ) {}

  async setBatteryToCar(enabled: boolean): Promise<boolean> {
    const api = await this.device.getApi();
    const ok = await api.setBatteryToCarMode(enabled, true, this.device);
    await this.refreshAfter(ok, 'setBatteryToCar');
    return ok;
  }

  async setBatteryBeforeCar(enabled: boolean): Promise<boolean> {
    const api = await this.device.getApi();
    const ok = await api.setBatteryBeforeCarMode(enabled, true, this.device);
    await this.refreshAfter(ok, 'setBatteryBeforeCar');
    return ok;
  }

  async setDischargeBatteryUntil(percent: number): Promise<boolean> {
    const api = await this.device.getApi();
    const ok = await api.setWbDischargeBatteryUntil(percent, true, this.device);
    await this.refreshAfter(ok, 'setDischargeBatteryUntil');
    return ok;
  }

  async setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean> {
    const api = await this.device.getApi();
    const ok = await api.setWallboxDisableBatteryAtMixMode(enabled, true, this.device);
    await this.refreshAfter(ok, 'setDisableBatteryAtMixMode');
    return ok;
  }

  private async refreshAfter(ok: boolean, method: string) {
    if (ok) {
      await this.device.refreshEmsSettings().catch(e => {
        this.device.log(`refreshEmsSettings after ${method} failed: ` + formatError(e));
      });
    }
  }
}
