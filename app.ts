import Homey from 'homey';
import {formatError, normalizeError} from './src/utils/error-utils';

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('E3DC home-power-station has been initialized');

    process.on('unhandledRejection', (reason: unknown) => {
      const err = normalizeError(reason);
      this.error('Unhandled promise rejection: ' + formatError(err));
    });
    process.on('uncaughtException', (err: unknown) => {
      this.error('Uncaught exception: ' + formatError(normalizeError(err)));
    });
    try {
      // @ts-ignore
      const powerOverviewWidget = this.homey.dashboards.getWidget('power-overview')
      // @ts-ignore
      powerOverviewWidget.registerSettingAutocompleteListener('plantId', async (query, settings) => {
        try {
          const devices = await this.readHomePowerPlants()
          return devices.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
        } catch (e) {
          this.error('Widget plantId autocomplete failed: ' + formatError(e));
          return [];
        }
      });
    } catch (e) {
      this.error('Widget power-overview setup failed: ' + formatError(e));
    }

    this.postTimelineWelcomeIfNeeded().catch(reason => {
      this.error('Timeline welcome notification failed: ' + formatError(reason));
    });
  }

  private async postTimelineWelcomeIfNeeded(): Promise<void> {
    const currentVersion = this.homey.manifest.version;
    const lastVersion = this.homey.settings.get('timelineWelcomeVersion') as string | undefined;
    if (lastVersion === currentVersion) {
      return;
    }
    const excerpt = this.homey.__('timeline.welcome', { VERSION: currentVersion });
    await this.homey.notifications.createNotification({ excerpt });
    await this.homey.settings.set('timelineWelcomeVersion', currentVersion);
  }

  logFromWidget(widget: string, message: string) {
    this.log('[WIDGET] [' + widget + '] ' + message);

    // const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices()
    // if (homePowerStations.length > 0) {
    //   let persistantLog: LogEntry[] | undefined = undefined
    //   if (homePowerStations[0].hasCapability('debug_log')) {
    //     persistantLog = JSON.parse(homePowerStations[0].getCapabilityValue('debug_log'))
    //   }
    //   else {
    //     persistantLog = []
    //   }
    //   if (persistantLog == undefined) {
    //     persistantLog = []
    //   }
    //   persistantLog.push({ timestamp: new Date(), message: message });
    //
    //   while (persistantLog.length > 30) {
    //     persistantLog.shift();
    //   }
    //   updateCapabilityValue('debug_log', JSON.stringify(persistantLog), homePowerStations[0])
    // }
  }

  private readCapabilityNumber(device: Homey.Device, capability: string, fallback = 0): number {
    if (!device.hasCapability(capability)) {
      return fallback;
    }
    const value = device.getCapabilityValue(capability);
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  }

  async readHomePowerPlants(): Promise<HomePowerPlant[]> {
    const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices()
    const devices: HomePowerPlant[] = []
    for (let i = 0; i < homePowerStations.length; i++) {
      const station = homePowerStations[i];
      const stationData = await station.getData();
      const stationId = stationData.id;
      const name = station.getName()
      devices.push({
        name: name,
        id: stationId,
        powerState: {
          consumption: this.readCapabilityNumber(station, 'measure_house_consumption'),
          pvPower: this.readCapabilityNumber(station, 'measure_power'),
          gridPower: this.readCapabilityNumber(station, 'measure_grid_delivery') * -1,
          batteryPower: this.readCapabilityNumber(station, 'measure_battery_delivery'),
          batteryLevel: this.readCapabilityNumber(station, 'measure_battery'),
          wallboxPower: this.readCapabilityNumber(station, 'measure_wallbox_consumption'),
          wallboxSolarShare: this.readCapabilityNumber(station, 'measure_wallbox_solarshare'),
          externalPowerConnected: station.hasCapability('external_power_delivery_connected')
            ? !!station.getCapabilityValue('external_power_delivery_connected')
            : false,
          externalPower: this.readCapabilityNumber(station, 'measure_external_power_delivery'),
        }
      })
    }
    return devices
  }

  async demoTest(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      resolve('real data')
    })
  }
}

interface HomePowerPlant {
  id: String,
  name: String,
  powerState: PowerStatus
}

interface PowerStatus {
  consumption: number,
  pvPower: number,
  gridPower: number,
  batteryPower: number,
  batteryLevel: number,
  wallboxPower: number,
  wallboxSolarShare: number,
  externalPowerConnected: boolean,
  externalPower: number,
}

interface LogEntry {
  timestamp: Date,
  message: string,
}

module.exports = MyApp;
