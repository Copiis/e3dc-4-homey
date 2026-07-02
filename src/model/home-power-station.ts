import {RscpApi} from '../rscp-api';
import {CardUnit} from '../../drivers/home-power-station/device';
import {InternalDevice} from '../internal-api/internal-device';
import {EmergencyPowerState, ManualChargeState} from 'easy-rscp';

export interface PowerModeState {
    mode: number
    powerW: number
    expiresAt: number  // Unix timestamp in ms
    untilSoc?: number  // optional: stop when house battery SOC reaches this %
    scheduleId?: string // optional: id of the emsSchedule that started this mode (for auto-cleanup)
}

export interface HomePowerStation extends InternalDevice{
    getApi(): RscpApi
    getId(): string
    validateUnit(value: number, unit: CardUnit): string | undefined
    getBatteryCapacity(): Promise<number>
    getManualChargeState(): ManualChargeState | null
    getCurrentSOC(): number
    getEmergencyPowerState(): EmergencyPowerState | null
    buildDiagnosticReport(): Promise<string>
    setPowerModeState(state: PowerModeState | null): void
}
