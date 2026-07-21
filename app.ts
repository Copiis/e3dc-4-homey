import Homey from 'homey';
import {formatError, normalizeError} from './src/utils/error-utils';
import {readHomePowerPlantsForHomey} from './src/utils/home-power-plants';
import {installNetSocketSafety, isBenignNetworkError} from './src/net-socket-safety';

// So früh wie möglich: TCP connect ohne error-Listener → sonst Homey-Crash-Mail
// (EHOSTUNREACH / HKW offline, Stack: TCPConnectWrap.afterConnect).
installNetSocketSafety();

class MyApp extends Homey.App {

  /**
   * onInit is called when the app is initialized.
   */
  async onInit() {
    this.log('E3DC home-power-station has been initialized');

    process.on('unhandledRejection', (reason: unknown) => {
      const err = normalizeError(reason);
      if (isBenignNetworkError(err)) {
        this.log('Network rejection (HKW offline/unreachable): ' + formatError(err));
        return;
      }
      this.error('Unhandled promise rejection: ' + formatError(err));
    });
    process.on('uncaughtException', (err: unknown) => {
      const e = normalizeError(err);
      if (isBenignNetworkError(e)) {
        // Sollte durch Socket-Patch selten greifen; falls doch: nicht eskalieren.
        this.log('Network exception (HKW offline/unreachable): ' + formatError(e));
        return;
      }
      this.error('Uncaught exception: ' + formatError(e));
    });
    this.registerPlantAutocompleteWidget('e3dc-hkw');
    this.registerPlantAutocompleteWidget('wallbox');
    this.registerPlantAutocompleteWidget('hkw-ladeplaner');
    this.registerPlantAutocompleteWidget('wallbox-ladeplaner');
    this.registerPlantAutocompleteWidget('power-overview');
    this.registerPlantAutocompleteWidget('live-energy-view');
  }

  private registerPlantAutocompleteWidget(widgetId: string): void {
    try {
      // Dashboard widgets API is not fully typed in current Homey SDK.
      // Safe cast after runtime check in try/catch.
      const dashboards = (this.homey as any).dashboards;
      const widget = dashboards.getWidget(widgetId);
      widget.registerSettingAutocompleteListener('plantId', async (query: string) => {
        try {
          const devices = await this.readHomePowerPlants();
          return devices
            .filter((item) => item.name.toLowerCase().includes((query || '').toLowerCase()))
            .map((item) => ({ id: item.id, name: item.name }));
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
    // Auch als diagnostic record, damit es im Diagnosebericht auftaucht (nur wenn detaillierte Diagnose aktiviert)
    try {
      const hpsDriver = this.homey.drivers.getDriver('home-power-station');
      const devices = hpsDriver.getDevices();
      if (devices.length > 0) {
        const dev = devices[0] as any;
        if (typeof dev.isDetailedDiagnosticsEnabled === 'function' ? dev.isDetailedDiagnosticsEnabled() : true) {
          dev.diagnostic.recordAnalysis('info', `[WIDGET ${widget}] ${message}`);
        }
      }
    } catch (e) {
      // ignore
    }

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
