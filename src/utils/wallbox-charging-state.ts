import {WallboxLiveState} from '../model/wallbox-live-state';
import {
    WB_ALG_STATUS_CHARGING_ACTIVE,
    WB_ALG_STATUS_CHARGING_CANCELED,
    WB_ALG_STATUS_PLUG_LOCKED,
    WB_ALG_STATUS_PLUGGED,
    WB_ALG_STATUS_SUN_MODE,
} from '../model/wallbox-extern-alg-status';

/**
 * Prüft ob gemischtes Laden (Wallbox + Hausbatterie) aktuell erlaubt ist.
 * Sun-Mode oder canceled = nicht erlaubt.
 */
export function isWallboxMixedChargingAllowed(state: WallboxLiveState): boolean {
    if (state.sunModeActive) {
        return false;
    }
    return !state.chargingCanceled;
}

/**
 * Prüft ob ein "Allow Charging" Befehl erfolgreich war.
 * Berücksichtigt State-Änderungen und Sun-Mode-Übergänge.
 */
export function wallboxChargingAllowSucceeded(before: WallboxLiveState, after: WallboxLiveState): boolean {
    if (!after.chargingCanceled) {
        return true;
    }
    if (after.chargingActive) {
        return true;
    }
    if (before.sunModeActive && !after.sunModeActive) {
        return true;
    }
    return false;
}

/**
 * Prüft ob ein "Block Charging" Befehl erfolgreich war.
 */
export function wallboxChargingBlockSucceeded(after: WallboxLiveState): boolean {
    return after.chargingCanceled;
}

/**
 * Formatiert den ALG-Status-Hex-String für Logs/Diagnose (menschlich lesbar + englisch).
 */
export function formatWallboxAlgHexSummary(hex: string | undefined): string | undefined {
    if (!hex || hex.length < 8) {
        return undefined;
    }
    const buffer = Buffer.from(hex, 'hex');
    if (buffer.length < 4) {
        return undefined;
    }
    const statusByte = buffer.readUInt8(2);
    const sun = (statusByte & WB_ALG_STATUS_SUN_MODE) !== 0;
    const canceled = (statusByte & WB_ALG_STATUS_CHARGING_CANCELED) !== 0;
    const active = (statusByte & WB_ALG_STATUS_CHARGING_ACTIVE) !== 0;
    const locked = (statusByte & WB_ALG_STATUS_PLUG_LOCKED) !== 0;
    const plugged = (statusByte & WB_ALG_STATUS_PLUGGED) !== 0;
    return [
        `Phasen/phases: ${buffer.readUInt8(1)}`,
        `Sonnenmodus/sun: ${sun ? 'ein/on' : 'aus/off'}`,
        `Laden gesperrt/blocked: ${canceled ? 'ja/yes' : 'nein/no'}`,
        `Laden aktiv/active: ${active ? 'ja/yes' : 'nein/no'}`,
        `Verriegelt/locked: ${locked ? 'ja/yes' : 'nein/no'}`,
        `Eingesteckt/plugged: ${plugged ? 'ja/yes' : 'nein/no'}`,
        `Max. Strom/max A: ${buffer.readUInt8(3)}`,
        `Status-Byte: 0x${statusByte.toString(16).padStart(2, '0')}`,
    ].join(' | ');
}

export type EvchargerChargingState =
    | 'plugged_out'
    | 'plugged_in'
    | 'plugged_in_paused'
    | 'plugged_in_charging'
    | 'plugged_in_discharging';

export function deriveEvchargerChargingState(state: WallboxLiveState): EvchargerChargingState {
    if (!state.plugged) {
        return 'plugged_out';
    }
    if (state.chargingCanceled) {
        return 'plugged_in_paused';
    }
    if (state.powerW < -50) {
        return 'plugged_in_discharging';
    }
    if (state.chargingActive || state.powerW > 0) {
        return 'plugged_in_charging';
    }
    return 'plugged_in';
}