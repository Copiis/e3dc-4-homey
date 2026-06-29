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

class BatterModuleDevice extends Homey.Device implements BatteryModule{

  private readonly energyMeter = new EnergyMeterIntegrator(this)

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
    } catch (e) {
      this.error('Battery module onInit failed: ' + formatError(e));
    }
  }

  async onAdded() {
    this.log('BatterModuleDevice has been added');
  }

  syncLive(rsoc: number, batteryPowerW: number,
      chargingConfiguration: ChargingConfiguration, emergencyPower: EmergencyPowerState) {
    updateCapabilityValue('measure_power', batteryPowerW, this)
    const meter = this.energyMeter.integrateBattery(batteryPowerW)
    updateCapabilityValue('meter_power.charged', meter.chargedKwh, this)
    updateCapabilityValue('measure_battery_charged_total', meter.chargedKwh, this)
    updateCapabilityValue('meter_power.discharged', meter.dischargedKwh, this)
    updateCapabilityValue('measure_battery_discharged_total', meter.dischargedKwh, this)
    updateCapabilityValue('measure_battery', rsoc, this)
    this.updatePowerLimits(chargingConfiguration, emergencyPower)
  }

  sync(batteryData: BatteryData, rsoc: number, capacity: number, batteryPowerW: number,
      chargingConfiguration: ChargingConfiguration, emergencyPower: EmergencyPowerState) {
    this.syncLive(rsoc, batteryPowerW, chargingConfiguration, emergencyPower)
    updateCapabilityValue('device_name', batteryData.name, this)
    updateCapabilityValue('measure_dcbcount', batteryData.dcbs.length, this)
    updateCapabilityValue('measure_capacity', capacity, this)
    updateCapabilityValue('measure_voltage', batteryData.voltage, this)
    let minTemp = 0
    let maxTemp: number = 0
    let sumTemp: number = 0
    let sensorCount = 0
    for (let moduleIndex = 0; moduleIndex < batteryData.dcbs.length; moduleIndex++) {
      for (let tempIndex = 0; tempIndex < batteryData.dcbs[moduleIndex].temperaturesCelsius.length; tempIndex++) {
        const temp = batteryData.dcbs[moduleIndex].temperaturesCelsius[tempIndex]
        if (minTemp == 0 || minTemp > temp) {
          minTemp = temp
        }
        if (maxTemp == 0 || maxTemp < temp) {
          maxTemp = temp
        }
        sumTemp += temp
        sensorCount++
      }
    }
    updateCapabilityValue('measure_temperature', sumTemp / sensorCount, this)
    updateCapabilityValue('measure_temperature_max', maxTemp, this)
    updateCapabilityValue('measure_temperature_min', minTemp, this)
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
