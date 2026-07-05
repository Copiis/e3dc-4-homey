
import {RunListener} from '../run-listener';
import {ResultCode} from 'easy-rscp';
import {getResultCode} from '../../utils/i18n-utils';
import {CardUnit} from '../../../drivers/home-power-station/device';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class SetMaxDischargingPowerActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const value: number = (args.limit as number) ?? 0;
            const unit: CardUnit = (args.unit as CardUnit) ?? 'w';
            hps.log('Starting card to configure the max discharging power to ' + value + ' ' + unit)
            const validationResult = hps.validateUnit(value, unit)
            if (validationResult) {
                hps.log('Rejected max discharging power configuration: ' + validationResult)
                reject(validationResult)
            }
            else {
                let requestedWattLimit = value
                hps.getApi().readChargingConfiguration(true, hps.asSimple())
                    .then(config => {
                        if (unit == CardUnit.PERCENTAGE) {
                            requestedWattLimit = Math.floor((value / 100.0) * config.maxPossibleDischargingPower)
                        }

                        hps.log('Max discharging power should be ' + requestedWattLimit + ' Watt. Checking if the HPS can handle this ...')
                        if (requestedWattLimit > config.maxPossibleDischargingPower) {
                            hps.log('Rejected max discharging power configuration. Requested value is higher than the allowed max of the HPS. Requested: ' + requestedWattLimit + ', HPS-max: ' + config.maxPossibleDischargingPower)
                            reject(hps.translate('messages.requested-max-discharging-power-to-high', {REQUESTED: requestedWattLimit, MAX: config.maxPossibleDischargingPower}))
                        }
                        else if (requestedWattLimit < config.minPossibleChargingPower) {
                            hps.log('Rejected max charging power configuration. Requested value is lower than the allowed min of the HPS. Requested: ' + requestedWattLimit + ', HPS-min: ' + config.minPossibleDischargingPower)
                            reject(hps.translate('messages.requested-max-discharging-power-to-low', {REQUESTED: requestedWattLimit, MIN: config.minPossibleDischargingPower}))
                        }
                        else {
                            const limits = config.currentLimitations
                            limits.chargingLimitationsEnabled = true
                            limits.maxCurrentDischargingPower = requestedWattLimit

                            hps.getApi().writeChargingLimits(limits, true, hps)
                                .then(result => {
                                    if (result.maxCurrentDischargingPower == ResultCode.SUCCESS) {
                                        hps.log('Max allowed discharging power configured')
                                        // best-effort post-read verify (consistent with wallbox readback)
                                        hps.getApi().readChargingConfiguration(true, hps.asSimple()).then(verify => {
                                            hps.log('Post-write verify discharging limit: ' + verify.currentLimitations.maxCurrentDischargingPower)
                                        }).catch(() => {})
                                        const token = {
                                            'max discharging limit': requestedWattLimit
                                        }
                                        resolve(token)
                                    }
                                    else {
                                        hps.error('Failed to configure max allowed discharging power: ResultCode=' + result.maxCurrentDischargingPower)
                                        reject(hps.translate('messages.requested-max-discharging-power-denied-by-hps', {RESULTCODE: getResultCode(result.maxCurrentDischargingPower, hps)}))
                                    }
                                })
                                .catch(e => {
                                    hps.error('Writing discharging limits failed: ' + formatError(e))                                    reject(e)
                                })
                        }

                    })
                    .catch(e => {
                        hps.error('Reading charging configuration failed: ' + formatError(e))                        reject(e)
                    })
            }
        })
    }

}

