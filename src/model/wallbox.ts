import {InternalDevice} from '../internal-api/internal-device';
import {WallboxEmsSettings} from './wallbox-ems-settings';
import {WallboxLiveState} from './wallbox-live-state';

export interface WallboxCommandResult {
    ok: boolean;
    skipped: boolean;
}

/**
 * Typed representation of a Wallbox Ladeplan (schedule) entry from settings.
 * Used for parsing and applying time-based charging plans.
 */
export interface WallboxSchedule {
  id?: string;
  start?: string;
  startTs?: number;
  end?: string;
  endTs?: number;
  durationMin?: number;
  action: string;           // 'allow' | 'block' | 'sun_on' | 'sun_off'
  current?: number;
  untilFull?: boolean;
  untilVehicleSoc?: number;
}

export interface Wallbox extends InternalDevice{
    sync(state: WallboxLiveState): void

    /** System-wide EMS Ladepriorisierung (same value on every wallbox device). */
    syncEmsSettings(settings: Partial<WallboxEmsSettings>): void

    /** Set max charging current (A) without changing the active mode. */
    setCurrentLimit(maxCurrentA: number): Promise<boolean>

    /** Flow: allow/block charging with tile + RSCP read-back guard. */
    applyChargingAllowed(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult>

    /** Flow: enable/disable sun mode with tile + RSCP read-back guard. */
    applySunMode(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult>

    /** Resume / allow charging (mixed mode, clears abort flag). */
    startCharging(maxCurrentA?: number): Promise<boolean>

    /** Stop / pause charging. */
    stopCharging(): Promise<boolean>

    /** Enable PV surplus (sun) mode or switch to mixed/grid mode. */
    setSunMode(enabled: boolean, maxCurrentA?: number): Promise<boolean>

    /** Allow home battery discharge for EV charging (system-wide EMS setting). */
    setBatteryToCar(enabled: boolean): Promise<boolean>

    /** Prioritize EV charging before home battery (requires battery-to-car off). */
    setBatteryBeforeCar(enabled: boolean): Promise<boolean>

    /** Min. home battery SOC (%) for EV charging. */
    setDischargeBatteryUntil(percent: number): Promise<boolean>

    /** Block home battery use for EV in wallbox mixed mode. */
    setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean>

    /** Returns true if a user Ladeplan is currently active (plans take precedence over flows). */
    hasActivePlan(): boolean
}
