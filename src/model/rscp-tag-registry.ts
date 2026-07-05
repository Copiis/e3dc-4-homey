/**
 * Central registry for RSCP tags that are not (yet) in easy-rscp or need extra helpers.
 * This addresses the "hardcoded tag lists" feedback.
 *
 * Prefer using easy-rscp constants where possible.
 * Add new ones here with source comments.
 */

import * as EmsPowerMode from './ems-power-mode-tags';
import * as EmsWallboxBattery from './ems-wallbox-battery-tags';
import * as WbExtra from './wb-extra-tags';

export const RscpTagRegistry = {
  // EMS Power Mode
  ...EmsPowerMode,

  // EMS Wallbox / Battery specific
  ...EmsWallboxBattery,

  // Extra WB / EMS GUI tags
  ...WbExtra,
} as const;

export type RscpTagName = keyof typeof RscpTagRegistry;

/**
 * Get tag value by name (for dynamic use).
 */
export function getRscpTag(name: RscpTagName): string {
  return RscpTagRegistry[name];
}
