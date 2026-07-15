import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';
import {isPlausibleVehicleSocPercent, normalizeVehicleSocPercent} from '../../utils/vehicle-soc';

/**
 * Flow action: set wallbox vehicle SOC from an external source
 * (manual value or token from Tesla / other apps).
 */
export class WallboxSetVehicleSocActionCard implements RunListener {
  run(
    args: {device?: {applyCloudVehicleSoc?: (n: number) => void; log?: (m: string) => void; error?: (m: string) => void}; percent?: number; [key: string]: unknown},
    _state: unknown,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const wallbox = args.device;
      const raw = args.percent;
      const soc = normalizeVehicleSocPercent(typeof raw === 'number' ? raw : Number(raw));

      if (!wallbox || typeof wallbox.applyCloudVehicleSoc !== 'function') {
        reject(new Error('Invalid wallbox device'));
        return;
      }
      if (!isPlausibleVehicleSocPercent(soc)) {
        reject(new Error('SOC must be between 1 and 100 %'));
        return;
      }

      try {
        wallbox.applyCloudVehicleSoc!(soc!);
        wallbox.log?.(`Flow set vehicle SOC to ${soc}%`);
        resolve({percent: soc});
      } catch (e) {
        wallbox.error?.('set vehicle SOC failed: ' + formatError(e));
        reject(e);
      }
    });
  }
}
