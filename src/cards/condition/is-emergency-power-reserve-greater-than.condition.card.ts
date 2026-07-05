
import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {CardUnit} from '../../../drivers/home-power-station/device';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class IsEmergencyPowerReserveGreaterThanConditionCard implements RunListener {
    run(args: { device: HomePowerStation; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const value: number = (args.reserve as number) ?? 0
            const unit: string = (args.unit as string) ?? 'w'
            hps.log('Starting card to check if the emergency power is greater than ' + value + ' ' + unit)
            const state = hps.getEmergencyPowerState()
            if (state) {
                if (unit == 'wh') {
                    hps.log('Comparing with WH reserve ' + state.reserveWh)
                    resolve(state.reserveWh > value)
                }
                else {
                    hps.log('Comparing with % reserve ' + state.reservePercentage)
                    resolve(state.reservePercentage * 100.0 > value)
                }
            }
            else {
                resolve(false)
            }

        })
    }

}

