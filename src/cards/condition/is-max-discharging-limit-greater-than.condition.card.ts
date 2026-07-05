
import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {CardUnit} from '../../../drivers/home-power-station/device';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class IsMaxDischargingLimitGreaterThanConditionCard implements RunListener {
    run(args: { device: HomePowerStation; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device;
            const value: number = (args.limit as number) ?? 0;
            const unit: CardUnit = (args.unit as CardUnit) ?? 'w';
            hps.log('Starting card to check if the max discharging power is greater than ' + value + ' ' + unit)
            const validationResult = hps.validateUnit(value, unit)
            if (validationResult) {
                hps.log('Rejected discharging power check: ' + validationResult)
                reject(validationResult)
            }
            else {
                let requestedWattLimit = value
                hps.getApi().readChargingConfiguration(true, hps.asSimple())
                    .then(config => {
                        if (unit == CardUnit.PERCENTAGE) {
                            requestedWattLimit = Math.floor((value / 100.0) * config.maxPossibleDischargingPower)
                        }

                        hps.log('Checking if the current max discharging power limit of ' + config.currentLimitations.maxCurrentDischargingPower + ' Watt is greater than ' + requestedWattLimit + ' Watt ...')
                        resolve(config.currentLimitations.maxCurrentDischargingPower > requestedWattLimit)
                    })
                    .catch(e => {
                        hps.error('Reading charging configuration failed: ' + formatError(e))                        reject(e)
                    })
            }
        })
    }

}

