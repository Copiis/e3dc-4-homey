/**
 * Status-Byte (Index 2) im WB EXTERN_DATA_ALG.
 * Siehe python-e3dc / ioBroker e3dc-rscp für die Bitmasken.
 * 
 * Wird verwendet um Wallbox-Status (Sun-Mode, Plug, Charging) ohne RSCP-Parse zu ermitteln.
 */
export const WB_ALG_STATUS_SUN_MODE = 0x80;
export const WB_ALG_STATUS_CHARGING_CANCELED = 0x40;
export const WB_ALG_STATUS_CHARGING_ACTIVE = 0x20;
export const WB_ALG_STATUS_PLUG_LOCKED = 0x10;
export const WB_ALG_STATUS_PLUGGED = 0x08;

/**
 * Saubere Repräsentation des ALG-Status-Bytes.
 * Verwende diese statt roher Bit-Operationen wo möglich.
 */
export interface WallboxExternAlgStatus {
  sunModeActive: boolean;
  chargingCanceled: boolean;
  chargingActive: boolean;
  plugLocked: boolean;
  plugged: boolean;
}

/**
 * Parst das Status-Byte in ein strukturiertes Objekt.
 */
export function parseAlgStatusByte(statusByte: number): WallboxExternAlgStatus {
  return {
    sunModeActive: (statusByte & WB_ALG_STATUS_SUN_MODE) !== 0,
    chargingCanceled: (statusByte & WB_ALG_STATUS_CHARGING_CANCELED) !== 0,
    chargingActive: (statusByte & WB_ALG_STATUS_CHARGING_ACTIVE) !== 0,
    plugLocked: (statusByte & WB_ALG_STATUS_PLUG_LOCKED) !== 0,
    plugged: (statusByte & WB_ALG_STATUS_PLUGGED) !== 0,
  };
}