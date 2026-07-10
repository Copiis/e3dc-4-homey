import Homey from 'homey';
import {formatError} from './error-utils';

/** Tile order — must match drivers/battery-module/driver.compose.json (visible grid first) */
export const BATTERY_MODULE_CAPABILITY_ORDER = [
  'measure_power',
  'measure_battery',
  'measure_emergency_power_reserve',
  'measure_max_charging_power',
  'measure_max_discharging_power',
  'measure_battery_charged_total',
  'measure_battery_discharged_total',
  'measure_capacity',
  'measure_temperature',
  'measure_temperature_min',
  'measure_temperature_max',
  'measure_voltage',
  'measure_dcbcount',
  'meter_power.charged',
  'meter_power.discharged',
  'device_name',
] as const;

export const BATTERY_MODULE_ORDER_VERSION = 8;

const BATTERY_MODULE_ENERGY_CONFIG = {
  homeBattery: true,
  meterPowerImportedCapability: 'meter_power.charged',
  meterPowerExportedCapability: 'meter_power.discharged',
} as const;

type DeviceWithEnergy = Homey.Device & {
  setEnergy?(config: Record<string, unknown>): Promise<void>;
};
export const BATTERY_MODULE_ORDER_VERSION_KEY = 'batteryModuleCapabilityOrderVersion';

/** Capabilities kept for sync/Flows/Insights but hidden from the sensor tile */
export const BATTERY_MODULE_TILE_HIDDEN_CAPABILITIES = [
  'measure_temperature',
  'measure_temperature_min',
  'measure_temperature_max',
  'measure_voltage',
  'measure_dcbcount',
  'meter_power.charged',
  'meter_power.discharged',
  'device_name',
] as const;

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
  'measure_wallbox_solarshare',
  'measure_vehicle_soc',
  'wallbox_plugged',
  'measure_wallbox_max_current',
  'measure_wallbox_phases',
  'meter_power',
  'wallbox_charging',
  'wallbox_sun_mode',
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
  force = false,
): Promise<void> {
  const current = device.getCapabilities();
  const ordered = desiredOrder.filter(cap => current.includes(cap));
  const trailing = current.filter(cap => !desiredOrder.includes(cap));
  const target = [...ordered, ...trailing];

  if (!force && sameOrder(current, target)) {
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

function batteryCapabilityTarget(device: Homey.Device): string[] {
  const current = device.getCapabilities();
  const ordered = BATTERY_MODULE_CAPABILITY_ORDER.filter(cap => current.includes(cap));
  const trailing = current.filter(cap => !BATTERY_MODULE_CAPABILITY_ORDER.includes(cap as typeof BATTERY_MODULE_CAPABILITY_ORDER[number]));
  return [...ordered, ...trailing];
}

function batteryOrderMatches(device: Homey.Device): boolean {
  return sameOrder(device.getCapabilities(), batteryCapabilityTarget(device));
}

/**
 * Full capability rebuild for Batteriemonitor. Homey blocks removing meter_power.*
 * while energy import/export is bound — strip bindings first, then remove + re-add all.
 */
export async function migrateBatteryModuleTile(device: Homey.Device): Promise<void> {
  const target = [...BATTERY_MODULE_CAPABILITY_ORDER];
  if (batteryOrderMatches(device)) {
    await applyBatteryModuleTileVisibility(device);
    return;
  }

  const current = device.getCapabilities();
  const values: Record<string, unknown> = {};
  for (const cap of current) {
    values[cap] = device.getCapabilityValue(cap);
  }

  device.log(`Battery tile migrate start (was: ${current.join(', ')})`);

  const deviceWithEnergy = device as DeviceWithEnergy;
  if (deviceWithEnergy.setEnergy) {
    try {
      await deviceWithEnergy.setEnergy({homeBattery: true});
    } catch (error) {
      device.error(`setEnergy strip failed: ${formatError(error)}`);
    }
  }

  for (let i = current.length - 1; i >= 0; i--) {
    const cap = current[i];
    if (!device.hasCapability(cap)) {
      continue;
    }
    try {
      await device.removeCapability(cap);
    } catch (error) {
      device.error(`Remove ${cap} failed: ${formatError(error)}`);
    }
  }

  for (const cap of target) {
    try {
      if (!device.hasCapability(cap)) {
        await device.addCapability(cap);
      }
      const value = values[cap];
      if (value !== undefined && value !== null) {
        await device.setCapabilityValue(cap, value);
      }
    } catch (error) {
      device.error(`Add ${cap} failed: ${formatError(error)}`);
    }
  }

  if (deviceWithEnergy.setEnergy) {
    try {
      await deviceWithEnergy.setEnergy({...BATTERY_MODULE_ENERGY_CONFIG});
    } catch (error) {
      device.error(`setEnergy restore failed: ${formatError(error)}`);
    }
  }

  await applyBatteryModuleTileVisibility(device);

  const after = device.getCapabilities();
  device.log(`Battery tile migrate done (now: ${after.join(', ')})`);
  if (!batteryOrderMatches(device)) {
    device.error(`Battery tile order still wrong after migrate: ${after.join(', ')}`);
  }
}

const BATTERY_MODULE_TILE_UI_COMPONENTS: Record<string, string> = {
  measure_battery: 'battery',
};

export async function applyBatteryModuleTileVisibility(device: Homey.Device): Promise<void> {
  const hidden = new Set<string>(BATTERY_MODULE_TILE_HIDDEN_CAPABILITIES);
  for (const capabilityId of BATTERY_MODULE_CAPABILITY_ORDER) {
    if (!device.hasCapability(capabilityId)) {
      continue;
    }
    try {
      if (hidden.has(capabilityId)) {
        await device.setCapabilityOptions(capabilityId, { uiComponent: null });
      } else {
        const uiComponent = BATTERY_MODULE_TILE_UI_COMPONENTS[capabilityId] ?? 'sensor';
        await device.setCapabilityOptions(capabilityId, { uiComponent });
      }
    } catch (error) {
      device.error(`Failed to set tile visibility for ${capabilityId}: ${formatError(error)}`);
    }
  }
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