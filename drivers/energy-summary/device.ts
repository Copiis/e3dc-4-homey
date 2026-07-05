import Homey from 'homey';
import {EnergySummaryConfig} from '../../src/model/energy-summary.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {calculatePvSurplusW} from '../../src/utils/pv-surplus';
import {clearTimeout} from 'node:timers';
import {formatError} from '../../src/utils/error-utils';
import {readCapabilityNumber} from '../../src/utils/read-capability-number';

const SYNC_INTERVAL_ENERGY_SUMMARY = 1000 * 20;
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5;

/**
 * EnergySummaryDevice - provides aggregated energy data and summaries for the E3DC system.
 */
class EnergySummaryDevice extends Homey.Device {

  private loopId: NodeJS.Timeout | null = null;
  private syncErrorCount = 0;
  private lastSyncTime = 0;

  async onInit() {
    this.log('EnergySummaryDevice has been initialized');
    // Note: simple polling; could integrate with central LiveDataPoller for HPS consistency
    setTimeout(() => this.autoSync(), 3000);
  }

  private autoSync() {
    const now = Date.now();
    if (now - this.lastSyncTime < 5000) return; // debounce like main poller
    this.lastSyncTime = now;

    this.sync()
      .then(() => {
        this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_ENERGY_SUMMARY);
      })
      .catch(reason => {
        this.error('Auto sync failed: ' + formatError(reason));
        this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_ENERGY_SUMMARY);
      });
  }

  private aggregateWallboxPowerW(stationId: string): number {
    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices();
    let total = 0;
    wallboxDevices.forEach(device => {
      const config: WallboxConfig | undefined = device.getStoreValue('settings');
      if (config?.stationId !== stationId) {
        return;
      }
      total += readCapabilityNumber(device, 'measure_power', 0);
    });
    return total;
  }

  async sync() {
    const ownConfig: EnergySummaryConfig | undefined = this.getStoreValue('settings');
    if (!ownConfig?.stationId) {
      this.error('Energy summary device has no store settings — sync skipped');
      await this.setUnavailable(this.homey.__('messages.hps-device-not-found'));
      return;
    }

    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices();
    const stationToUse = hpsDevices.find(value => {
      const asStation: HomePowerStation = value as unknown as HomePowerStation;
      return asStation.getId() === ownConfig.stationId;
    });

    if (!stationToUse) {
      this.error('Station with id ' + ownConfig.stationId + ' not found');
      await this.setUnavailable(this.homey.__('messages.hps-device-not-found'));
      return;
    }

    if (!stationToUse.getAvailable()) {
      await this.setUnavailable(this.homey.__('messages.hps-not-available'));
      this.syncErrorCount++;
      return;
    }

    try {
      const pvPower = readCapabilityNumber(stationToUse, 'measure_power');
      const houseConsumption = readCapabilityNumber(stationToUse, 'measure_house_consumption');
      const gridDelivery = readCapabilityNumber(stationToUse, 'measure_grid_delivery');
      const batteryPower = readCapabilityNumber(stationToUse, 'measure_battery_delivery');
      const wallboxPower = this.aggregateWallboxPowerW(ownConfig.stationId);
      const pvSurplus = calculatePvSurplusW(pvPower, houseConsumption, batteryPower);

      updateCapabilityValue('measure_power', pvPower, this);
      updateCapabilityValue('measure_house_consumption', houseConsumption, this);
      updateCapabilityValue('measure_grid_delivery', gridDelivery, this);
      updateCapabilityValue('measure_battery_delivery', batteryPower, this);
      updateCapabilityValue('measure_wallbox_consumption', wallboxPower, this);
      updateCapabilityValue('measure_pv_surplus', pvSurplus, this);

      this.syncErrorCount = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
    } catch (e) {
      this.error('Energy summary sync failed: ' + formatError(e));
      this.syncErrorCount++;
      if (this.syncErrorCount >= MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE) {
        await this.setUnavailable(this.homey.__('messages.hps-not-available'));
      }
    }
  }

  async onDeleted() {
    if (this.loopId) {
      clearTimeout(this.loopId);
    }
  }
}

module.exports = EnergySummaryDevice;