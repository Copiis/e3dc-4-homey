import {HomePowerStation} from '../../model/home-power-station';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';

export class RemoveEmergencyReserveActionCard implements RunListener {

    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const amount: number = (args.amount as number) ?? 0;
            const unit: string = (args.unit as string) ?? 'w';
            hps.log('RemoveEmergencyReserveActionCard: triggered')
            const api = hps.getApi()
            api.writeEmergencyPowerReserve(0, false, true, hps)
                .then(value => {
                    hps.log('RemoveEmergencyReserveActionCard: success')
                    hps.log(value)
                    resolve(undefined)
                })
                .catch(e => {
                    hps.error('RemoveEmergencyReserveActionCard: failed')                    reject(e)
                })
        })
    }
}

