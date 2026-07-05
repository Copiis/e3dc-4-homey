
import {RunListener} from '../run-listener';
import {HomePowerStation} from '../../model/home-power-station';
import {formatError} from '../../utils/error-utils';

export class IsIslandModePossibleConditionCard implements RunListener {
    run(args: { device: HomePowerStation; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const hps: HomePowerStation = args.device;
            hps.log('Starting card to check if the island mode is possible')
            const state = hps.getEmergencyPowerState()
            if (state) {
                hps.log('Checking state')
                hps.log(state)
                resolve(!state.island && state.emergencyPowerPossible && state.readyForSwitch)
            }
            else {
                hps.log('State not available')
                resolve(false)
            }

        })
    }

}

