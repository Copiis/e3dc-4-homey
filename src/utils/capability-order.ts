import Homey from 'homey';
import {formatError} from './error-utils';

/** Tile order for HKW-Statistiken — must match drivers/summary/driver.compose.json */
export const SUMMARY_CAPABILITY_ORDER = [
  'measure_pv_summary',
  'measure_house_consumption_summary',
  'measure_grid_out',
  'measure_grid_in',
  'measure_battery_in',
  'measure_battery_out',
  'measure_self_consumption',
  'measure_autarky',
  'date_range',
] as const;

/** Tile order for Wallbox — must match drivers/wallbox/driver.compose.json */
export const WALLBOX_CAPABILITY_ORDER = [
  'measure_power',
  'wallbox_plugged',
  'wallbox_charging',
  'wallbox_sun_mode',
  'measure_wallbox_solarshare',
  'measure_wallbox_max_current',
  'measure_wallbox_phases',
  'meter_power',
  'wallbox_plug_locked',
  'wallbox_schuko',
  'wallbox_priority_battery_first',
  'measure_wallbox_discharge_soc',
  'wallbox_battery_discharge_sun',
  'wallbox_battery_discharge_mix',
] as const;

/** Capabilities kept for Flows/Insights but hidden from the device tile */
export const WALLBOX_TILE_HIDDEN_CAPABILITIES = [
  'wallbox_plug_locked',
  'wallbox_schuko',
  'wallbox_priority_battery_first',
  'measure_wallbox_discharge_soc',
  'wallbox_battery_discharge_sun',
  'wallbox_battery_discharge_mix',
] as const;

/** Tile order for Netz — must match drivers/grid-meter/driver.compose.json */
export const GRID_METER_CAPABILITY_ORDER = [
  'measure_power',
  'measure_grid_out',
  'measure_grid_in',
  'meter_power.imported',
  'meter_power.exported',
] as const;

/** Tile order for HKW — must match drivers/home-power-station/driver.compose.json */
export const HKW_CAPABILITY_ORDER = [
  'measure_power',
  'measure_house_consumption',
  'measure_grid_delivery',
  'measure_battery_delivery',
  'measure_battery',
  'charge_time',
  'meter_power',
  'diagnostic_report',
  'firmware_version',
] as const;

function sameOrder(current: string[], target: string[]): boolean {
  if (current.length !== target.length) {
    return false;
  }
  return current.every((cap, index) => cap === target[index]);
}

/**
 * Reorders capabilities on an existing device. Compose order applies only at pairing;
 * remove + re-add is the supported workaround until Homey offers setCapabilityOrder().
 */
export async function reorderCapabilitiesIfNeeded(
  device: Homey.Device,
  desiredOrder: readonly string[],
): Promise<void> {
  const current = device.getCapabilities();
  const ordered = desiredOrder.filter(cap => current.includes(cap));
  const trailing = current.filter(cap => !desiredOrder.includes(cap));
  const target = [...ordered, ...trailing];

  if (sameOrder(current, target)) {
    return;
  }

  const values: Record<string, unknown> = {};
  for (const cap of current) {
    values[cap] = device.getCapabilityValue(cap);
  }

  for (let i = current.length - 1; i >= 0; i--) {
    const cap = current[i];
    if (!device.hasCapability(cap)) {
      continue;
    }
    try {
      await device.removeCapability(cap);
    } catch (error) {
      device.error(`Failed to remove capability ${cap} during reorder: ${formatError(error)}`);
      return;
    }
  }

  for (const cap of target) {
    try {
      await device.addCapability(cap);
      const value = values[cap];
      if (value !== undefined && value !== null) {
        await device.setCapabilityValue(cap, value);
      }
    } catch (error) {
      device.error(`Failed to re-add capability ${cap} during reorder: ${formatError(error)}`);
      return;
    }
  }

  device.log(`Capabilities reordered: ${target.join(', ')}`);
}

export async function hideCapabilitiesFromTile(
  device: Homey.Device,
  capabilityIds: readonly string[],
): Promise<void> {
  for (const capabilityId of capabilityIds) {
    if (!device.hasCapability(capabilityId)) {
      continue;
    }
    try {
      await device.setCapabilityOptions(capabilityId, { uiComponent: null });
    } catch (error) {
      device.error(`Failed to hide ${capabilityId} from tile: ${formatError(error)}`);
    }
  }
}