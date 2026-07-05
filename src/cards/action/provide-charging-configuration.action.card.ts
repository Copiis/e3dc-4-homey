import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class ProvideChargingConfigurationActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            hps.log('Starting card to provide the charging configuration')

            hps.getApi().readChargingConfiguration(true, hps.asSimple())
                .then(config => {
                    const limits = config.currentLimitations
                    const token = {
                        'max possible charging limit': config.maxPossibleChargingPower,
                        'max possible discharging limit': config.maxPossibleDischargingPower,
                        'min possible charging limit': config.minPossibleChargingPower,
                        'min possible discharging limit': config.minPossibleDischargingPower,
                        'max charging limit': limits.maxCurrentChargingPower,
                        'max discharging limit': limits.maxCurrentDischargingPower,
                        'limits active': limits.chargingLimitationsEnabled
                    }
                    resolve(token)
                })
                .catch(e => {
                    hps.error('Reading charging configuration failed: ' + formatError(e))                    reject(e)
                })

        })
    }

}

