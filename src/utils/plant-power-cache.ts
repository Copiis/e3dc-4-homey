import Homey from 'homey';
import {LiveData} from '../model/live-data';
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
  const wallboxDevices = homey.drivers.getDriver('wallbox').getDevices();
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

  return {
    consumption: readCapabilityNumber(station, 'measure_house_consumption'),
    pvPower: readCapabilityNumber(station, 'measure_power'),
    gridPower: readCapabilityNumber(station, 'measure_grid_delivery') * -1,
    batteryPower,
    batteryLevel,
    wallboxPower: wallbox.powerW,
    wallboxSolarShare: wallbox.solarShareW,
    wallboxVehicleSoc: wallbox.vehicleSoc,
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