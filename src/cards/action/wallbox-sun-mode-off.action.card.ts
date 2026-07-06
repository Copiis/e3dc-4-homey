import {RunListener} from '../run-listener';
import {Wallbox} from '../../model/wallbox';
import {resolveWallboxFlowResult} from './wallbox-flow-result';
import {formatError} from '../../utils/error-utils';

export class WallboxSunModeOffActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;

            if (!wallbox || typeof wallbox.applySunMode !== 'function') {
                reject('Invalid wallbox device');
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
                    'Wallbox rejected sun mode off',
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