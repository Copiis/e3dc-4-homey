import Homey from 'homey';
import {LiveData} from '../model/live-data';
import {SummaryConfig, SummaryType} from '../model/summary.config';
import {PowerStatus} from './home-power-plants';
import {readCapabilityNumber} from './read-capability-number';

type HomeyApi = Homey.App['homey'];

const cache = new Map<string, PowerStatus>();

export function setPlantPowerState(stationId: string, powerState: PowerStatus): void {
  cache.set(stationId, powerState);
}

export function getPlantPowerState(stationId: string): PowerStatus | undefined {
  return cache.get(stationId);
}

function safeGetDevices(homey: HomeyApi, driverId: string): Homey.Device[] {
  try {
    return homey.drivers.getDriver(driverId).getDevices();
  } catch {
    return [];
  }
}

function readFiniteCapability(device: Homey.Device, capability: string): number | undefined {
  if (!device.hasCapability(capability)) {
    return undefined;
  }
  const value = readCapabilityNumber(device, capability, Number.NaN);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Day counters (kWh today) from linked devices.
 * Prefer HKW-Statistik (TODAY); fall back to PV-forecast / grid-meter.
 */
function readDayKwhForStation(homey: HomeyApi, stationId: string): {
  pvTodayKwh?: number;
  gridImportTodayKwh?: number;
  gridExportTodayKwh?: number;
} {
  const stationKey = String(stationId);
  let pvTodayKwh: number | undefined;
  let gridImportTodayKwh: number | undefined;
  let gridExportTodayKwh: number | undefined;

  for (const device of safeGetDevices(homey, 'summary')) {
    const config = device.getStoreValue('settings') as SummaryConfig | undefined;
    if (String(config?.stationId) !== stationKey) {
      continue;
    }
    if (config?.type !== SummaryType.TODAY) {
      continue;
    }
    if (pvTodayKwh === undefined) {
      pvTodayKwh = readFiniteCapability(device, 'measure_pv_summary');
    }
    // measure_grid_out = Netzbezug, measure_grid_in = Netzeinspeisung (heute)
    if (gridImportTodayKwh === undefined) {
      gridImportTodayKwh = readFiniteCapability(device, 'measure_grid_out');
    }
    if (gridExportTodayKwh === undefined) {
      gridExportTodayKwh = readFiniteCapability(device, 'measure_grid_in');
    }
  }

  if (pvTodayKwh === undefined) {
    for (const device of safeGetDevices(homey, 'pv-forecast')) {
      const config = device.getStoreValue('settings') as { stationId?: string } | undefined;
      if (String(config?.stationId) !== stationKey) {
        continue;
      }
      pvTodayKwh = readFiniteCapability(device, 'measure_pv_actual_today');
      if (pvTodayKwh !== undefined) {
        break;
      }
    }
  }

  if (gridImportTodayKwh === undefined || gridExportTodayKwh === undefined) {
    for (const device of safeGetDevices(homey, 'grid-meter')) {
      const config = device.getStoreValue('settings') as { stationId?: string } | undefined;
      if (String(config?.stationId) !== stationKey) {
        continue;
      }
      if (gridImportTodayKwh === undefined) {
        gridImportTodayKwh = readFiniteCapability(device, 'measure_grid_out');
      }
      if (gridExportTodayKwh === undefined) {
        gridExportTodayKwh = readFiniteCapability(device, 'measure_grid_in');
      }
      if (gridImportTodayKwh !== undefined && gridExportTodayKwh !== undefined) {
        break;
      }
    }
  }

  return { pvTodayKwh, gridImportTodayKwh, gridExportTodayKwh };
}

function aggregateWallboxPowerForStation(homey: HomeyApi, stationId: string): {
  powerW: number;
  solarShareW: number;
  vehicleSoc?: number;
  hasWallbox: boolean;
} {
  let powerW = 0;
  let solarShareW = 0;
  let vehicleSoc: number | undefined;
  let hasWallbox = false;
  const wallboxDevices = safeGetDevices(homey, 'wallbox');
  wallboxDevices.forEach((device: Homey.Device) => {
    const config = device.getStoreValue('settings') as { stationId?: string } | undefined;
    if (String(config?.stationId) !== stationId) {
      return;
    }
    hasWallbox = true;
    powerW += readCapabilityNumber(device, 'measure_power');
    solarShareW += readCapabilityNumber(device, 'measure_wallbox_solarshare');
    // Prefer first plausible vehicle SOC (>0) among linked wallboxes
    if (vehicleSoc === undefined || vehicleSoc <= 0) {
      const soc = readCapabilityNumber(device, 'measure_vehicle_soc');
      if (typeof soc === 'number' && !Number.isNaN(soc) && soc > 0 && soc <= 100) {
        vehicleSoc = Math.round(soc);
      }
    }
  });
  return { powerW, solarShareW, vehicleSoc, hasWallbox };
}

export function buildPowerStateFromLiveData(
  result: LiveData,
  wallboxPower: number,
  wallboxSolarShare: number,
  hasWallbox: boolean = true,
  wallboxVehicleSoc?: number,
  pvTodayKwh?: number,
): PowerStatus {
  const batteryLevel = result.batteryChargingLevel * 100;
  const hasBattery = batteryLevel != null && !isNaN(batteryLevel);

  return {
    consumption: result.houseConsumption,
    pvPower: result.pvDelivery,
    gridPower: result.gridDelivery * -1,
    batteryPower: result.batteryDelivery,
    batteryLevel,
    wallboxPower,
    wallboxSolarShare,
    wallboxVehicleSoc: wallboxVehicleSoc !== undefined && wallboxVehicleSoc > 0
      ? Math.round(wallboxVehicleSoc)
      : undefined,
    pvTodayKwh,
    hasWallbox,
    hasBattery,
    chargeTime: '',
    externalPowerConnected: result.externalPowerConnected,
    externalPower: result.externalPowerDelivery,
  };
}

export function buildPowerStateFromStation(station: Homey.Device, homey: HomeyApi, stationId: string): PowerStatus {
  const wallbox = aggregateWallboxPowerForStation(homey, stationId);

  const batteryLevel = readCapabilityNumber(station, 'measure_battery');
  const hasBattery = batteryLevel != null && !isNaN(batteryLevel);
  const batteryPower = readCapabilityNumber(station, 'measure_battery_delivery');
  const dayKwh = readDayKwhForStation(homey, stationId);

  return {
    consumption: readCapabilityNumber(station, 'measure_house_consumption'),
    pvPower: readCapabilityNumber(station, 'measure_power'),
    gridPower: readCapabilityNumber(station, 'measure_grid_delivery') * -1,
    batteryPower,
    batteryLevel,
    wallboxPower: wallbox.powerW,
    wallboxSolarShare: wallbox.solarShareW,
    wallboxVehicleSoc: wallbox.vehicleSoc,
    pvTodayKwh: dayKwh.pvTodayKwh,
    gridImportTodayKwh: dayKwh.gridImportTodayKwh,
    gridExportTodayKwh: dayKwh.gridExportTodayKwh,
    hasWallbox: wallbox.hasWallbox,
    hasBattery,
    chargeTime: (station.getCapabilityValue('charge_time') as string) || '',
    externalPowerConnected: station.hasCapability('external_power_delivery_connected')
      ? !!station.getCapabilityValue('external_power_delivery_connected')
      : false,
    externalPower: readCapabilityNumber(station, 'measure_external_power_delivery'),
  };
}

export function publishPlantPowerStateFromStation(station: Homey.Device): void {
  const stationId = String(station.getData().id);
  const powerState = buildPowerStateFromStation(station, station.homey, stationId);
  setPlantPowerState(stationId, powerState);
}