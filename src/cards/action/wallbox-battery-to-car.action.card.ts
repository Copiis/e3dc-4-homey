import {Wallbox} from '../../model/wallbox';
import {isErlaubt} from '../../utils/wallbox-e3dc-settings';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';
import {flowText} from './wallbox-flow-result';

export class WallboxBatteryToCarActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;
            const erlaubt = isErlaubt(args.permission, args.enabled);

            if (!wallbox || typeof wallbox.setBatteryToCar !== 'function') {
                reject(flowText(wallbox, 'messages.invalid-wallbox-device', 'Invalid wallbox device'));
                return;
            }

            wallbox.log && wallbox.log(`Batterieentladung im Sonnenmodus: ${erlaubt ? 'Erlaubt' : 'Unterbunden'}`);
            try {
                const ok = await wallbox.setBatteryToCar(erlaubt);
                if (ok) {
                    resolve({ permission: erlaubt ? 'erlaubt' : 'unterbunden' });
                } else {
                    reject(flowText(wallbox, 'messages.wallbox-sun-discharge-rejected', 'E3/DC hat „Batterieentladung im Sonnenmodus“ abgelehnt'));
                }
            } catch (e) {
                wallbox.error && wallbox.error('Batterieentladung im Sonnenmodus failed: ' + formatError(e));
                reject(e);
            }
        });
    }
}