import {HomePowerStation} from '../../model/home-power-station';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';

function startCharge(amount: number,
                      hps: HomePowerStation,
                      resolve: ((value: unknown | PromiseLike<unknown>) => void),
                      reject: ((reason?: unknown) => void)) {
    if (amount < 200) {
        reject(hps.translate('messages.manual-charge-input-wrong-wh-to-low', {MIN: 200}))
    }
    else {
        hps.getApi()
            .startManualCharge(amount, true, hps)
            .then(started => {
                hps.log('StartManualBatteryChargingActionCard (' + amount + 'Wh): Answer received ' + started)
                if (started) {
                    resolve(undefined)
                }
                else {
                    reject(hps.translate('messages.manual-charge-rejected-by-hps'))
                }
            })
            .catch(reason => {
                hps.log('StartManualBatteryChargingActionCard: ' + amount + ' failed')
                hps.error(formatError(reason))
                reject(reason)
            })
    }
}

export class StartManualBatteryChargeActionPercentageCard implements RunListener {


    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const amount: number = (args.amount as number) ?? 0
            hps.log('StartManualBatteryChargingActionCard: triggered -> ' + amount + '%')
            const currentState = hps.getManualChargeState()
            if (!currentState?.active) {
                hps.getBatteryCapacity()
                    .then(capacity => {
                        const wh = capacity * (amount / 100.0)
                        const soc = hps.getCurrentSOC()
                        const alreadyLoadedWh = capacity * soc
                        const whToLoad = wh - alreadyLoadedWh
                        if (whToLoad > 0) {
                            startCharge(whToLoad, hps, resolve, reject)
                        }
                        else {
                            hps.log('Desired battery charge level already reached. Manual storage charging skipped')
                            resolve(undefined)
                        }
                    })
                    .catch(reason => {
                        hps.log('Unable to start manual charge. Error reading battery capacity')
                        hps.error(formatError(reason))
                        reject(reason)
                    })
            }
            else {
                hps.log('Manual charge is already running')
                reject(hps.translate('messages.manual-charge-already-running'))
            }
        })
    }

}

export class StartManualBatteryChargeWhActionCard implements RunListener {


    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device as HomePowerStation;
            const amount: number = (args.amount as number) ?? 0
            hps.log('StartManualBatteryChargingActionCardWh: triggered -> ' + amount)
            const currentState = hps.getManualChargeState()
            if (!currentState?.active) {
                startCharge(amount, hps, resolve, reject)
            }
            else {
                hps.log('Manual charge is already running')
                reject(hps.translate('messages.manual-charge-already-running'))
            }
        })
    }
}

