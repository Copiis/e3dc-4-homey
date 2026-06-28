import Homey from 'homey';
import {formatError, normalizeError} from './src/utils/error-utils';
import {readHomePowerPlantsForHomey} from './src/utils/home-power-plants';

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
    this.registerPlantAutocompleteWidget('power-overview');
    this.registerPlantAutocompleteWidget('live-energy-view');

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

  private registerPlantAutocompleteWidget(widgetId: string): void {
    try {
      // @ts-ignore
      const widget = this.homey.dashboards.getWidget(widgetId);
      // @ts-ignore
      widget.registerSettingAutocompleteListener('plantId', async (query: string) => {
        try {
          const devices = await this.readHomePowerPlants();
          return devices.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
        } catch (e) {
          this.error(`Widget ${widgetId} plantId autocomplete failed: ` + formatError(e));
          return [];
        }
      });
    } catch (e) {
      this.error(`Widget ${widgetId} setup failed: ` + formatError(e));
    }
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

  async readHomePowerPlants(): Promise<HomePowerPlant[]> {
    const devices = await readHomePowerPlantsForHomey(this.homey);
    for (const device of devices) {
      const station = this.homey.drivers.getDriver('home-power-station').getDevices()
        .find(s => String(s.getData().id) === device.id);
      if (station && !station.getAvailable()) {
        this.log(`Widget data: HKW "${device.name}" is unavailable — values may be stale`);
      }
    }
    return devices;
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
