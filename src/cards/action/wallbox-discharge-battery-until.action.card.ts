import {Wallbox} from '../../model/wallbox';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';
import {flowText} from './wallbox-flow-result';

export class WallboxDischargeBatteryUntilActionCard implements RunListener {
    run(args: { device: Wallbox; percent?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device;
            const percent: number = args.percent ?? 0;

            if (!wallbox || typeof wallbox.setDischargeBatteryUntil !== 'function') {
                reject(flowText(wallbox, 'messages.invalid-wallbox-device', 'Invalid wallbox device'));
                return;
            }

            wallbox.log && wallbox.log(`Batterie Entladegrenze: ${percent}%`);
            try {
                const ok = await wallbox.setDischargeBatteryUntil(percent);
                if (ok) {
                    resolve({ percent });
                } else {
                    reject(flowText(wallbox, 'messages.wallbox-discharge-until-rejected', 'E3/DC hat „Batterie Entladegrenze“ abgelehnt'));
                }
            } catch (e) {
                wallbox.error && wallbox.error('Batterie Entladegrenze failed: ' + formatError(e));
                reject(e);
            }
        });
    }
}