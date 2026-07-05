
import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {CardUnit} from '../../../drivers/home-power-station/device';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class IsManualChargeActiveConditionCard implements RunListener {
    run(args: { device: HomePowerStation; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device;
            hps.log('Starting card to check if a manual charge is active')
            const state = hps.getManualChargeState()
            if (state) {
                resolve(state.active)
            }
            else {
                hps.log('No manual charge state available')
                resolve(false)
            }
        })
    }

}

