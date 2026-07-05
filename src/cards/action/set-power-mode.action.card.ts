import {HomePowerStation} from '../../model/home-power-station';
import {RunListener} from '../run-listener';
import {formatError} from '../../utils/error-utils';

export const POWER_MODE_AUTO = 0
export const POWER_MODE_IDLE = 1
export const POWER_MODE_DISCHARGE = 2
export const POWER_MODE_CHARGE = 3
export const POWER_MODE_GRID_CHARGE = 4

export class SetPowerModeAutoActionCard implements RunListener {
    run(args: { device: HomePowerStation; duration?: number; power?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const hps: HomePowerStation = args.device;
            hps.log('SetPowerModeAutoActionCard: triggered')
            hps.setPowerModeState(null)
            hps.getApi()
                .setPowerMode(POWER_MODE_AUTO, 0, true, hps)
                .then(() => resolve(undefined))
                .catch(reason => {
                    hps.error('SetPowerModeAutoActionCard failed: ' + formatError(reason))
                    reject(reason)
                })
        })
    }
}

export class SetPowerModeIdleActionCard implements RunListener {
    run(args: { device: HomePowerStation; duration?: number; power?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const hps: HomePowerStation = args.device;
            const durationMinutes: number = args.duration ?? 0;
            hps.log('SetPowerModeIdleActionCard: triggered -> ' + durationMinutes + ' min')
            hps.setPowerModeState({
                mode: POWER_MODE_IDLE,
                powerW: 0,
                expiresAt: Date.now() + durationMinutes * 60 * 1000
            })
            hps.getApi()
                .setPowerMode(POWER_MODE_IDLE, 0, true, hps)
                .then(() => resolve(undefined))
                .catch(reason => {
                    hps.error('SetPowerModeIdleActionCard failed: ' + formatError(reason))
                    reject(reason)
                })
        })
    }
}

export class SetPowerModeChargeActionCard implements RunListener {
    run(args: { device: HomePowerStation; duration?: number; power?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const hps: HomePowerStation = args.device;
            const powerW: number = args.power ?? 0;
            const durationMinutes: number = args.duration ?? 0;
            hps.log('SetPowerModeChargeActionCard: triggered -> ' + powerW + 'W for ' + durationMinutes + ' min')
            hps.setPowerModeState({
                mode: POWER_MODE_CHARGE,
                powerW,
                expiresAt: Date.now() + durationMinutes * 60 * 1000
            })
            hps.getApi()
                .setPowerMode(POWER_MODE_CHARGE, powerW, true, hps)
                .then(() => resolve(undefined))
                .catch(reason => {
                    hps.error('SetPowerModeChargeActionCard failed: ' + formatError(reason))
                    reject(reason)
                })
        })
    }
}

export class SetPowerModeDischargeActionCard implements RunListener {
    run(args: { device: HomePowerStation; duration?: number; power?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const hps: HomePowerStation = args.device;
            const powerW: number = args.power ?? 0;
            const durationMinutes: number = args.duration ?? 0;
            hps.log('SetPowerModeDischargeActionCard: triggered -> ' + powerW + 'W for ' + durationMinutes + ' min')
            hps.setPowerModeState({
                mode: POWER_MODE_DISCHARGE,
                powerW,
                expiresAt: Date.now() + durationMinutes * 60 * 1000
            })
            hps.getApi()
                .setPowerMode(POWER_MODE_DISCHARGE, powerW, true, hps)
                .then(() => resolve(undefined))
                .catch(reason => {
                    hps.error('SetPowerModeDischargeActionCard failed: ' + formatError(reason))
                    reject(reason)
                })
        })
    }
}

export class SetPowerModeGridChargeActionCard implements RunListener {
    run(args: { device: HomePowerStation; duration?: number; power?: number; [key: string]: unknown }, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>((resolve, reject) => {
            const hps: HomePowerStation = args.device;
            const powerW: number = args.power ?? 0;
            const durationMinutes: number = args.duration ?? 0;
            hps.log('SetPowerModeGridChargeActionCard: triggered -> ' + powerW + 'W for ' + durationMinutes + ' min')
            hps.setPowerModeState({
                mode: POWER_MODE_GRID_CHARGE,
                powerW,
                expiresAt: Date.now() + durationMinutes * 60 * 1000
            })
            hps.getApi()
                .setPowerMode(POWER_MODE_GRID_CHARGE, powerW, true, hps)
                .then(() => resolve(undefined))
                .catch(reason => {
                    hps.error('SetPowerModeGridChargeActionCard failed: ' + formatError(reason))
                    reject(reason)
                })
        })
    }
}
