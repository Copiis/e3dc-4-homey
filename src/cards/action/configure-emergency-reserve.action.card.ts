import {HomePowerStation} from '../../model/home-power-station';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';

export class ConfigureEmergencyReserveActionCard implements RunListener {

    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const amount: number = (args.amount as number) ?? 0;
            const unit: string = (args.unit as string) ?? 'w';
            hps.log('ConfigureEmergencyReserveActionCard: triggered -> ' + amount + '' + unit)
            const api = hps.getApi()
            api.writeEmergencyPowerReserve(amount, unit == 'percentage', true, hps)
                .then(value => {
                    hps.log('ConfigureEmergencyReserveActionCard: success')
                    hps.log(value)
                    resolve(undefined)
                })
                .catch(e => {
                    hps.error('ConfigureEmergencyReserveActionCard: failed')                    reject(e)
                })
        })
    }
}

