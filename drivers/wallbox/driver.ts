import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';

class WallboxDriver extends Homey.Driver {

  async onInit() {
    this.log('WallboxDriver has been initialized');

    // === DANN-Karten (Actions) ===
    this.homey.flow.getActionCard('wallbox_set_max_current')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxMaxCurrent(device.getStoreValue('settings').id, args.current);
        this.log(`Wallbox Max Current auf ${args.current} A gesetzt`);
      });

    this.homey.flow.getActionCard('wallbox_toggle_suspended')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.toggleWallboxSuspended(device.getStoreValue('settings').id);
      });

    this.homey.flow.getActionCard('wallbox_set_sun_mode')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxSunMode(device.getStoreValue('settings').id, args.enabled);
      });

    this.homey.flow.getActionCard('wallbox_set_phases')
      .registerRunListener(async (args) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxPhases(device.getStoreValue('settings').id, parseInt(args.phases));
      });

    // === UND-Karten (Conditions) – werden meist automatisch über Capabilities abgefragt, bei Bedarf hier erweitern ===
    // === WENN-Karten (Triggers) – werden über emit in der Device-Sync-Methode ausgelöst (siehe unten) ===
  }

  private async getApiForDevice(device: any) {
    const stationId = device.getStoreValue('settings').stationId;
    const hpsDriver = this.homey.drivers.getDriver('home-power-station');
    const hpsDevice = hpsDriver.getDevices().find((d: any) => d.getData().id === stationId);
    return hpsDevice.getApi();
  }

  // ... restlicher Code (onPair etc.) bleibt unverändert
}

module.exports = WallboxDriver;
