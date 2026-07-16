import Homey from 'homey';
import {buildPowerStateFromStation} from './plant-power-cache';
type HomeyApi = Homey.App['homey'];

export interface HomePowerPlant {
  id: string;
  name: string;
  powerState: PowerStatus;
}

export interface PowerStatus {
  consumption: number;
  pvPower: number;
  gridPower: number;
  batteryPower: number;
  batteryLevel: number;
  wallboxPower: number;
  wallboxSolarShare: number;
  /** Vehicle SOC (%) from linked wallbox tile (RSCP or Homey-car fallback). */
  wallboxVehicleSoc?: number;
  /**
   * PV day yield in kWh (today), when available from a linked
   * HKW-Statistik (TODAY) or PV-forecast device.
   */
  pvTodayKwh?: number;
  /**
   * Grid import today in kWh (Netzbezug), from Statistik (TODAY) or grid-meter device.
   */
  gridImportTodayKwh?: number;
  /**
   * Grid export today in kWh (Netzeinspeisung), from Statistik (TODAY) or grid-meter device.
   */
  gridExportTodayKwh?: number;
  hasWallbox: boolean;
  hasBattery: boolean;
  chargeTime: string;
  externalPowerConnected: boolean;
  externalPower: number;
}

export async function readHomePowerPlantsForHomey(homey: HomeyApi): Promise<HomePowerPlant[]> {
  const homePowerStations = homey.drivers.getDriver('home-power-station').getDevices();
  const devices: HomePowerPlant[] = [];
  for (const station of homePowerStations) {
    await station.ready();
    const stationData = station.getData();
    const stationId = String(stationData.id);
    const name = station.getName();
    const powerState = buildPowerStateFromStation(station, homey, stationId);
    devices.push({
      name,
      id: stationId,
      powerState,
    });
  }
  return devices;
}