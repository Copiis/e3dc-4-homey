/** Status byte (index 2) in WB EXTERN_DATA_ALG – see python-e3dc / ioBroker e3dc-rscp. */
export const WB_ALG_STATUS_SUN_MODE = 0x80;
export const WB_ALG_STATUS_CHARGING_CANCELED = 0x40;
export const WB_ALG_STATUS_CHARGING_ACTIVE = 0x20;
export const WB_ALG_STATUS_PLUG_LOCKED = 0x10;
export const WB_ALG_STATUS_PLUGGED = 0x08;

/**
 * WallboxExternAlgStatus - cleaner representation of the magic byte.
 * Use this instead of raw bit operations where possible.
 */
export interface WallboxExternAlgStatus {
  sunModeActive: boolean;
  chargingCanceled: boolean;
  chargingActive: boolean;
  plugLocked: boolean;
  plugged: boolean;
}

export function parseAlgStatusByte(statusByte: number): WallboxExternAlgStatus {
  return {
    sunModeActive: (statusByte & WB_ALG_STATUS_SUN_MODE) !== 0,
    chargingCanceled: (statusByte & WB_ALG_STATUS_CHARGING_CANCELED) !== 0,
    chargingActive: (statusByte & WB_ALG_STATUS_CHARGING_ACTIVE) !== 0,
    plugLocked: (statusByte & WB_ALG_STATUS_PLUG_LOCKED) !== 0,
    plugged: (statusByte & WB_ALG_STATUS_PLUGGED) !== 0,
  };
}