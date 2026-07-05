/**
 * Central registry for RSCP tags that are not (yet) in easy-rscp or need extra helpers.
 * This addresses the "hardcoded tag lists" feedback.
 *
 * Prefer using easy-rscp constants where possible.
 * Add new ones here with source comments.
 * 
 * All values are hex strings as used in easy-rscp.
 */
export const RscpTagRegistry = {
  // EMS Power Mode (from ems-power-mode-tags, now inlined for cleanup)
  /** Set Power Request */
  EMS_REQ_SET_POWER: '01000030',
  EMS_SET_POWER: '01800030',
  EMS_REQ_SET_POWER_MODE: '01000031',
  EMS_REQ_SET_POWER_VALUE: '01000032',

  // EMS Wallbox / Battery specific (inlined)
  EMS_REQ_SET_WB_DISCHARGE_BAT_UNTIL: '0100027C',
  EMS_SET_WB_DISCHARGE_BAT_UNTIL: '0180027C',
  EMS_REQ_GET_WB_DISCHARGE_BAT_UNTIL: '0100027D',
  EMS_GET_WB_DISCHARGE_BAT_UNTIL: '0180027D',
  EMS_REQ_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT: '0100027A',
  EMS_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT: '0180027A',
  EMS_REQ_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT: '0100027B',
  EMS_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT: '0180027B',

  // Extra WB / EMS GUI tags (inlined)
  EMS_REQ_GET_RUNSCREENVALUES: '01000284',
  EMS_GET_RUNSCREENVALUES: '01800284',
  WB_REQ_GET_CHARGE_PLAN_TEXT: '0E0F0003',
  WB_GET_CHARGE_PLAN_TEXT: '0E8F0003',
} as const;

export type RscpTagName = keyof typeof RscpTagRegistry;

/**
 * Get tag value by name (for dynamic use).
 */
export function getRscpTag(name: RscpTagName): string {
  return RscpTagRegistry[name];
}
