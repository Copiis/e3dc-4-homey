import {RunListener} from '../run-listener';
import {Wallbox} from '../../model/wallbox';
import {formatError} from '../../utils/error-utils';

export class WallboxChargingIsAllowedConditionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<any>((resolve) => {
            const wallbox = args.device as Wallbox & { getCapabilityValue(id: string): unknown };
            if (!wallbox || typeof wallbox.getCapabilityValue !== 'function') {
                resolve(false);
                return;
            }
            resolve(!!wallbox.getCapabilityValue('wallbox_charging'));
        });
    }
}