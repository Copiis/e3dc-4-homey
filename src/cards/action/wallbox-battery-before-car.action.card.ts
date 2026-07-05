import {Wallbox} from '../../model/wallbox';
import {isBatteryFirst} from '../../utils/wallbox-e3dc-settings';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';

export class WallboxBatteryBeforeCarActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;
            const batteryFirst = isBatteryFirst(args.priority, args.enabled);

            if (!wallbox || typeof wallbox.setBatteryBeforeCar !== 'function') {
                reject('Invalid wallbox device');
                return;
            }

            wallbox.log && wallbox.log(`Ladepriorität: ${batteryFirst ? 'Batterie zuerst' : 'Wallbox zuerst'}`);
            try {
                const ok = await wallbox.setBatteryBeforeCar(batteryFirst);
                if (ok) {
                    resolve({ priority: batteryFirst ? 'batterie_zuerst' : 'wallbox_zuerst' });
                } else {
                    reject('E3/DC hat „Ladepriorität“ abgelehnt');
                }
            } catch (e) {
                wallbox.error && wallbox.error('Ladepriorität failed: ' + formatError(e));
                reject(e);
            }
        });
    }
}