
import {RunListener} from '../run-listener';
import {BatteryUnit, ResultCode} from 'easy-rscp';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class StopManualBatteryChargeActionCard implements RunListener {

    constructor() {
    }

    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const amount: number = (args.amount as number) ?? 0
            hps.log('StopManualBatteryChargeActionCard: triggered')
            const state = hps.getManualChargeState()
            if (state && state.active) {
                hps.getApi()
                    .startManualCharge(0, true, hps)
                    .then(_ => {
                        resolve(undefined)
                    })
                    .catch(reason => {
                        hps.log('StopManualBatteryChargeActionCard: failed')
                        hps.error(formatError(reason))
                        reject(reason)
                    })
            }
            else {
                hps.log('StopManualBatteryChargeActionCard: Stop not needed. No manual charge is running')
                resolve(undefined)
            }
        })
    }
}
