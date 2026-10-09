import {RunListener} from '../run-listener';
import {Wallbox} from '../../model/wallbox';
import {flowText, resolveWallboxFlowResult} from './wallbox-flow-result';
import {formatError} from '../../utils/error-utils';

export class WallboxSunModeOffActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;

            if (!wallbox || typeof wallbox.applySunMode !== 'function') {
                reject(flowText(wallbox, 'messages.invalid-wallbox-device', 'Invalid wallbox device'));
                return;
            }

            if (typeof wallbox.hasActivePlan === 'function' && wallbox.hasActivePlan()) {
                wallbox.log && wallbox.log('Wallbox sun mode off blocked by active Ladeplan');
                resolve({ skipped: true, reason: 'active plan' });
                return;
            }

            try {
                const result = await wallbox.applySunMode(false);
                resolveWallboxFlowResult(
                    result,
                    {},
                    flowText(wallbox, 'messages.wallbox-sun-off-rejected', 'Wallbox rejected sun mode off'),
                    resolve,
                    reject,
                );
            } catch (e) {
                wallbox.error && wallbox.error('Failed to disable wallbox sun mode: ' + formatError(e));
                reject(e);
            }
        });
    }
}