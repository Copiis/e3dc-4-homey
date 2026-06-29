import Homey from 'homey';
import {SummaryConfig} from '../../src/model/summary.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {getTypeName} from '../../src/utils/i18n-utils';
import {I18n} from '../../src/internal-api/i18n';
import {clearTimeout} from 'node:timers';
import {reorderCapabilitiesIfNeeded, SUMMARY_CAPABILITY_ORDER} from '../../src/utils/capability-order';
import {formatError} from '../../src/utils/error-utils';

const SYNC_INTERVAL_SUMMARY = 1000 * 60 * 5; // 5 min
// const SYNC_INTERVAL = 1000 * 20; // 20 sec
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5

class SummaryDevice extends Homey.Device implements I18n{

  private loopId: NodeJS.Timeout |null = null
  private syncErrorCount: number = 0

  async onInit() {
    this.log('SummaryDevice has been initialized');
    try {
      await reorderCapabilitiesIfNeeded(this, SUMMARY_CAPABILITY_ORDER);
    } catch (e) {
      this.error('Summary capability migration failed: ' + formatError(e));
    }

    setTimeout(() => {
      this.autoSync()
    }, 5000)
  }

  private autoSync() {
    this.log('Auto sync ...')
    this.sync()
        .then(() => {
          this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_SUMMARY)
        })
        .catch(reason => {
          this.error('Auto sync failed: ' + formatError(reason))
          this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_SUMMARY)
        })
  }

  async sync() {
    return new Promise((resolve, reject) => {
      const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices()
      const ownConfig: SummaryConfig | undefined = this.getStoreValue('settings')
      if (!ownConfig?.stationId) {
        this.error('Summary device has no store settings — sync skipped')
        this.setUnavailable(this.homey.__('messages.hps-device-not-found')).then()
        resolve(undefined)
        return
      }
      updateCapabilityValue('date_range', getTypeName(ownConfig.type, this), this)
      const stationId = ownConfig.stationId
      const stationToUse = hpsDevices.find(value => {
        const asStation: HomePowerStation = value as unknown as HomePowerStation
        return asStation.getId() === stationId
      })
      if (stationToUse) {
        this.log('Connected station is still available')
        const asStation: HomePowerStation = stationToUse as unknown as HomePowerStation
        const api = asStation.getApi()
        const syncType = ownConfig.type
        api
            .readSummaryData(syncType, true, this, this.homey.clock.getTimezone())
            .then(result => {
              updateCapabilityValue('measure_pv_summary', result.pvDelivery / 1000.0, this)
              updateCapabilityValue('measure_house_consumption_summary', result.houseConsumption / 1000.0, this)
              updateCapabilityValue('measure_battery_in', result.batteryIn / 1000.0, this)
              updateCapabilityValue('measure_battery_out', result.batteryOut / 1000.0, this)
              updateCapabilityValue('measure_grid_in', result.gridIn / 1000.0, this)
              updateCapabilityValue('measure_grid_out', result.gridOut / 1000.0, this)
              updateCapabilityValue('measure_self_consumption', result.selfConsumption * 100, this)
              updateCapabilityValue('measure_autarky', result.selfSufficiency * 100, this)

              this.syncErrorCount = 0
              if (!this.getAvailable()) {
                this.setAvailable().then()
              }

              resolve(undefined)
            })
            .catch(e => {
              this.error('error reading summary data: ' + formatError(e))
              this.syncErrorCount++
              if (this.syncErrorCount >= MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE) {
                this.setUnavailable(this.homey.__('messages.hps-not-available')).then()
              }
              resolve(undefined)
            })

      }
      else {
        this.error('Station with id ' + stationId + ' not found. Sync will fail')
        this.setUnavailable(this.homey.__('messages.hps-device-not-found')).then()
        resolve(undefined)
      }
    })
  }
  async onAdded() {
    this.log('SummaryDevice has been added');
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
    this.log("SummaryDevice settings where changed");
  }
  async onRenamed(name: string) {
    this.log('SummaryDevice was renamed');
  }

  async onDeleted() {
    this.log('SummaryDevice has been deleted');
    if (this.loopId) {
      clearTimeout(this.loopId)
    }
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }



}

module.exports = SummaryDevice;
