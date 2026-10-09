import {Wallbox} from '../../model/wallbox';
import {isUnterbunden} from '../../utils/wallbox-e3dc-settings';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';
import {flowText} from './wallbox-flow-result';

export class WallboxDisableBatteryMixModeActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;
            const unterbunden = isUnterbunden(args.permission, args.enabled);

            if (!wallbox || typeof wallbox.setDisableBatteryAtMixMode !== 'function') {
                reject(flowText(wallbox, 'messages.invalid-wallbox-device', 'Invalid wallbox device'));
                return;
            }

            wallbox.log && wallbox.log(
                `Batterieentladung im Mischmodus: ${unterbunden ? 'Unterbunden' : 'Erlaubt'}`,
            );
            try {
                const ok = await wallbox.setDisableBatteryAtMixMode(unterbunden);
                if (ok) {
                    resolve({ permission: unterbunden ? 'unterbunden' : 'erlaubt' });
                } else {
                    reject(flowText(wallbox, 'messages.wallbox-mix-rejected', 'E3/DC hat „Batterieentladung im Mischmodus“ abgelehnt'));
                }
            } catch (e) {
                wallbox.error && wallbox.error('Batterieentladung im Mischmodus failed: ' + formatError(e));
                reject(e);
            }
        });
    }
}