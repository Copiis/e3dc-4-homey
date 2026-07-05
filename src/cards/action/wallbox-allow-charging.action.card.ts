import {RunListener} from '../run-listener';
import {Wallbox} from '../../model/wallbox';
import {DEFAULT_WALLBOX_CURRENT_A} from '../../model/wallbox-control';
import {resolveWallboxFlowResult} from './wallbox-flow-result';
import {formatError} from '../../utils/error-utils';

export class WallboxAllowChargingActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        // cleaner async without outer Promise constructor
        return (async () => {
            const wallbox: Wallbox = args.device as Wallbox;
            const current: number = (args.current !== undefined && args.current !== null)
                ? (args.current as number)
                : DEFAULT_WALLBOX_CURRENT_A;

            if (!wallbox || typeof wallbox.applyChargingAllowed !== 'function') {
                throw new Error('Invalid wallbox device');
            }

            try {
                const result = await wallbox.applyChargingAllowed(true, current);
                return resolveWallboxFlowResultForAsync(
                    result,
                    { current },
                    'Wallbox rejected allow charging',
                );
            } catch (e) {
                wallbox.error && wallbox.error('Failed to allow wallbox charging: ' + formatError(e));
                throw e;
            }
        })();
    }
}

// helper to avoid changing resolve function for now
function resolveWallboxFlowResultForAsync(result: { ok: boolean; skipped?: boolean }, payload: Record<string, unknown>, rejectMessage: string) {
    if (!result.ok) {
        throw new Error(rejectMessage);
    }
    if (result.skipped) {
        return { ...payload, skipped: true, verified: false };
    }
    return { ...payload, skipped: false, verified: true };
}