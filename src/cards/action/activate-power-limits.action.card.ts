import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class ActivatePowerLimitsActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            hps.log('Starting card to activate preconfigured power limits')

            hps.getApi().readChargingConfiguration(true, hps.asSimple())
                .then(config => {
                    const limits = config.currentLimitations
                    if (limits.chargingLimitationsEnabled) {
                        hps.log('Limits already activated')
                        const token = {
                            'max charging limit': limits.maxCurrentChargingPower,
                            'max discharging limit': limits.maxCurrentDischargingPower,
                        }
                        resolve(token)
                    }
                    else {
                        limits.chargingLimitationsEnabled = true

                        hps.getApi().writeChargingLimits(limits, true, hps)
                            .then(result => {
                                if (result.chargingLimitationsEnabled == ResultCode.SUCCESS) {
                                    hps.log('Successful activated the limits')
                                    const token = {
                                        'max charging limit': limits.maxCurrentChargingPower,
                                        'max discharging limit': limits.maxCurrentDischargingPower,
                                    }
                                    resolve(token)
                                } else {
                                    hps.error('Activation of preconfigured power limits failed by HPS: ' + result.chargingLimitationsEnabled)
                                    reject(hps.translate('messages.activating-of-powerlimits-failed-by-hps',
                                        {
                                            RESULTCODE: getResultCode(result.chargingLimitationsEnabled, hps)
                                        }))
                                }
                            })
                            .catch(e => {
                                hps.error('Activating preconfigured power limits failed: ' + formatError(e))                                reject(e)
                            })
                    }


                })
                .catch(e => {
                    hps.error('Reading charging configuration failed: ' + formatError(e))                    reject(e)
                })

        })
    }

}

