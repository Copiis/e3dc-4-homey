import Homey, {SimpleClass} from 'homey';
import {BatteryData} from '../../src/model/battery-data';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {BatteryModule} from '../../src/model/battery-module';
import {ChargingConfiguration, EmergencyPowerState} from 'easy-rscp';
import {EnergyMeterIntegrator} from '../../src/utils/energy-meter-integrator';
import {
  BATTERY_MODULE_ORDER_VERSION,
  BATTERY_MODULE_ORDER_VERSION_KEY,
  migrateBatteryModuleTile,
} from '../../src/utils/capability-order';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import {formatError} from '../../src/utils/error-utils';

/**
 * BatterModuleDevice
 *
 * Repräsentiert ein einzelnes Batterie-Modul (DCB) des E3DC Hauskraftwerks.
 *
 * Verantwortlichkeiten:
 * - Live-Sync von SoC, Temperatur, Spannung, Kapazität pro Modul
 * - Akkumulation von geladener/entladener Energie über EnergyMeterIntegrator
 * - Capability-Migration und Tile-Optimierung (hide/reorder)
 * - Power-Limits und Emergency-Power-Handling
 *
 * Wird vom CapabilityManager des Haupt-HKW synchronisiert.
 * Folgt demselben Schönheitsstandard wie HKW und Wallbox.
 */
class BatterModuleDevice extends Homey.Device implements BatteryModule{

  private readonly energyMeter = new EnergyMeterIntegrator(this)
  /** Last full RSCP battery readout — used to estimate module power (V×I). */
  private lastBatteryData: BatteryData | null = null
  private refreshTimer: NodeJS.Timeout | null = null

  /**
   * Initialisiert das Batterie-Modul-Gerät.
   * Stellt Capabilities sicher und migriert Tile-Order wenn nötig.
   */
  async onInit() {
    this.log('BatterModuleDevice has been initialized');
    try {
      await ensureCapabilities(this, [
        'meter_power.charged',
        'meter_power.discharged',
        'measure_battery_charged_total',
        'measure_battery_discharged_total',
      ]);
      await migrateBatteryModuleTile(this);
      const storedOrderVersion = this.getStoreValue(BATTERY_MODULE_ORDER_VERSION_KEY) as number | undefined;
      if (storedOrderVersion !== BATTERY_MODULE_ORDER_VERSION) {
        await this.setStoreValue(BATTERY_MODULE_ORDER_VERSION_KEY, BATTERY_MODULE_ORDER_VERSION);
        this.log(`Capability order version set to v${BATTERY_MODULE_ORDER_VERSION}`);
      }

      // Trigger initial population of capacity (and dcb/voltage/temp info) on the tile.
      // getBatteryCapacity on the linked HPS now also distributes to battery modules.
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = null;
        this.triggerBatteryDataRefresh().catch(() => {});
      }, 2500);
    } catch (e) {
      this.error('Battery module onInit failed: ' + formatError(e));
    }
  }

  private async triggerBatteryDataRefresh(): Promise<void> {
    try {
      const hpsDriver = this.homey.drivers.getDriver('home-power-station');
      const hpsDevices = hpsDriver.getDevices();
      const myConfig = this.getStoreValue('settings') as { stationId?: string } | undefined;
      if (!myConfig?.stationId) return;

      for (const hps of hpsDevices) {
        const hpsDevice = hps as Homey.Device & {
          getData?: () => { id?: string };
          getId?: () => string;
          getBatteryCapacity?: () => Promise<number>;
        };
        const hpsData = hpsDevice.getData?.() || {};
        const hpsId = hpsDevice.getId?.() || hpsData.id;
        if (hpsId == myConfig.stationId) {
          if (typeof hpsDevice.getBatteryCapacity === 'function') {
            await hpsDevice.getBatteryCapacity().catch(() => {});
          }
          break;
        }
      }
    } catch (e) {
      this.error('triggerBatteryDataRefresh: ' + formatError(e));
    }
  }

  async onAdded() {
    this.log('BatterModuleDevice has been added');
  }

  /**
   * Estimate this module's power from last RSCP DCB currents and pack voltage.
   * Falls back to station-total power when no DCB data is available yet.
   * Sign follows station `batteryPowerW` (E3DC: charge > 0, discharge < 0).
   */
  private resolveModulePowerW(stationBatteryPowerW: number): number {
    const data = this.lastBatteryData;
    if (!data || !data.dcbs?.length || !Number.isFinite(data.voltage) || data.voltage === 0) {
      return stationBatteryPowerW;
    }
    const currentSumA = data.dcbs.reduce((sum, dcb) => sum + (Number(dcb.currentA) || 0), 0);
    if (!Number.isFinite(currentSumA) || currentSumA === 0) {
      // Idle / no current tags: show 0 on module tile rather than system total (P3 clarity)
      if (Math.abs(stationBatteryPowerW) < 50) {
        return 0;
      }
      return stationBatteryPowerW;
    }
    const magnitudeW = Math.abs(data.voltage * currentSumA);
    const sign = stationBatteryPowerW < 0 ? -1 : stationBatteryPowerW > 0 ? 1 : (currentSumA < 0 ? -1 : 1);
    return Math.round(sign * magnitudeW);
  }

  /**
   * Live-Update für das Modul (wird vom CapabilityManager aufgerufen).
   *
   * `stationBatteryPowerW` is the station total (for sign / fallback).
   * Displayed `measure_power` prefers V×I from this module's last DCB readout.
   */
  syncLive(rsoc: number, stationBatteryPowerW: number,
      chargingConfiguration: ChargingConfiguration, emergencyPower: EmergencyPowerState) {
    const powerW = this.resolveModulePowerW(stationBatteryPowerW)
    updateCapabilityValue('measure_power', powerW, this, { force: true })
    const meter = this.energyMeter.integrateBattery(powerW)
    updateCapabilityValue('meter_power.charged', meter.chargedKwh, this)
    updateCapabilityValue('measure_battery_charged_total', meter.chargedKwh, this)
    updateCapabilityValue('meter_power.discharged', meter.dischargedKwh, this)
    updateCapabilityValue('measure_battery_discharged_total', meter.dischargedKwh, this)
    updateCapabilityValue('measure_battery', rsoc, this)
    this.updatePowerLimits(chargingConfiguration, emergencyPower)
  }

  sync(batteryData: BatteryData, rsoc: number, capacity: number, batteryPowerW: number,
      chargingConfiguration: ChargingConfiguration, emergencyPower: EmergencyPowerState) {
    this.updateBatteryInfo(batteryData, capacity)
    this.syncLive(rsoc, batteryPowerW, chargingConfiguration, emergencyPower)
  }

  /**
   * Update fields that come from the full battery specification + monitoring readout (RSCP).
   * These are relatively static or slower changing: name, module count, usable capacity,
   * voltage and per-DCB temperatures.
   *
   * Dynamic values (SoC, power, limits) are updated via syncLive on every poll.
   */
  updateBatteryInfo(batteryData: BatteryData, capacityKwh: number) {
    this.lastBatteryData = batteryData
    updateCapabilityValue('device_name', batteryData.name, this)
    updateCapabilityValue('measure_dcbcount', batteryData.dcbs.length, this)
    updateCapabilityValue('measure_capacity', capacityKwh, this)
    updateCapabilityValue('measure_voltage', batteryData.voltage, this)

    let minTemp = Infinity
    let maxTemp = -Infinity
    let sumTemp = 0
    let sensorCount = 0
    for (let moduleIndex = 0; moduleIndex < batteryData.dcbs.length; moduleIndex++) {
      for (let tempIndex = 0; tempIndex < batteryData.dcbs[moduleIndex].temperaturesCelsius.length; tempIndex++) {
        const temp = batteryData.dcbs[moduleIndex].temperaturesCelsius[tempIndex]
        if (temp < minTemp) {
          minTemp = temp
        }
        if (temp > maxTemp) {
          maxTemp = temp
        }
        sumTemp += temp
        sensorCount++
      }
    }
    if (sensorCount > 0) {
      updateCapabilityValue('measure_temperature', sumTemp / sensorCount, this)
      updateCapabilityValue('measure_temperature_max', maxTemp, this)
      updateCapabilityValue('measure_temperature_min', minTemp, this)
    }
  }

  private updatePowerLimits(chargingConfiguration: ChargingConfiguration, emergencyPower: EmergencyPowerState) {
    let maxChargingPower = chargingConfiguration.maxPossibleChargingPower
    let maxDischargingPower = chargingConfiguration.maxPossibleDischargingPower
    if (chargingConfiguration.currentLimitations.chargingLimitationsEnabled) {
      maxChargingPower = chargingConfiguration.currentLimitations.maxCurrentChargingPower
      maxDischargingPower = chargingConfiguration.currentLimitations.maxCurrentDischargingPower
    }

    updateCapabilityValue('measure_max_charging_power', maxChargingPower, this)
    updateCapabilityValue('measure_max_discharging_power', maxDischargingPower, this)
    updateCapabilityValue('measure_emergency_power_reserve', emergencyPower.reserveWh, this)
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("BatterModuleDevice settings where changed");
  }

  async onRenamed(name: string) {
    this.log('BatterModuleDevice was renamed');
  }

  async onDeleted() {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.log('BatterModuleDevice has been deleted');
  }

  asSimple(): SimpleClass {
    return this;
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }



}

module.exports = BatterModuleDevice;
