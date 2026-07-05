import {RscpApi} from '../rscp-api';
import {CardUnit} from '../../drivers/home-power-station/device';
import {InternalDevice} from '../internal-api/internal-device';
import {EmergencyPowerState, ManualChargeState} from 'easy-rscp';

/**
 * Model-Definitionen für das HomePowerStationDevice.
 *
 * Enthält die zentralen Interfaces und State-Typen, die zwischen
 * Device, Managern und Flow-Karten ausgetauscht werden.
 */

/**
 * Repräsentiert den aktuellen Power-Mode des HKW.
 *
 * Modi: AUTO (0), IDLE (1), CHARGE (2), DISCHARGE (3), GRID_CHARGE (4).
 * Wird von PowerModeManager und EmsScheduleManager verwendet.
 *
 * @property mode       - 0=AUTO, 1=IDLE, 2=CHARGE, 3=DISCHARGE, 4=GRID_CHARGE
 * @property powerW     - Ziel-Leistung in Watt
 * @property expiresAt  - Unix-Timestamp (ms), wann der Modus automatisch endet
 * @property untilSoc   - Optional: Modus endet, wenn Hausbatterie diesen SOC erreicht
 * @property scheduleId - Optional: ID des EMS/Ladeplan-Schedules, der diesen Mode ausgelöst hat
 */
export interface PowerModeState {
    mode: number
    powerW: number
    expiresAt: number  // Unix timestamp in ms
    untilSoc?: number  // optional: stop when house battery SOC reaches this %
    scheduleId?: string // optional: id of the emsSchedule that started this mode (for auto-cleanup)
}

/**
 * Typed representation of an EMS / Ladeplan schedule entry.
 * Used by EmsScheduleManager and related flow/widget logic.
 * All fields are optional except the core mode because user input from widgets can be partial.
 * 
 * @property id - Unique ID
 * @property start - Start time (HH:MM or ISO)
 * @property mode - Power mode string (auto, idle, charge, discharge, grid_charge)
 * @property powerW - Target power
 * @property untilSoc - Stop when house battery reaches this SOC
 * @property scheduleId - Reference to parent schedule
 */
export interface EmsSchedule {
  id?: string;
  start?: string;          // e.g. "08:00"
  startTs?: number;        // pre-parsed timestamp
  end?: string;
  endTs?: number;
  durationMin?: number;
  mode: string;            // "auto" | "idle" | "discharge" | "charge" | "grid_charge" etc.
  powerW?: number;
  untilSoc?: number;
  untilFull?: boolean;
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
