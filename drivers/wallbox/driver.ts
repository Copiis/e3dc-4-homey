import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';

class WallboxDriver extends Homey.Driver {

  async onInit() {
    this.log('WallboxDriver has been initialized');

    // === DANN-Karten (Actions) ===
    this.homey.flow.getActionCard('wallbox_set_max_current')
      .registerRunListener(async (args: any) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxMaxCurrent(device.getStoreValue('settings').id, args.current);
        this.log(`✅ Wallbox Max Current auf ${args.current} A gesetzt`);
      });

    this.homey.flow.getActionCard('wallbox_toggle_suspended')
      .registerRunListener(async (args: any) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.toggleWallboxSuspended(device.getStoreValue('settings').id);
        this.log(`✅ Wallbox suspended toggled`);
      });

    this.homey.flow.getActionCard('wallbox_set_sun_mode')
      .registerRunListener(async (args: any) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxSunMode(device.getStoreValue('settings').id, args.enabled);
        this.log(`✅ Wallbox Sun-Mode auf ${args.enabled} gesetzt`);
      });

    this.homey.flow.getActionCard('wallbox_set_phases')
      .registerRunListener(async (args: any) => {
        const device = args.device as any;
        const api = await this.getApiForDevice(device);
        await api.setWallboxPhases(device.getStoreValue('settings').id, parseInt(args.phases));
        this.log(`✅ Wallbox Phasen auf ${args.phases} gesetzt`);
      });

    this.log('✅ Alle Wallbox Flow-Actions registriert');
  }

  private async getApiForDevice(device: any) {
    const stationId = device.getStoreValue('settings').stationId;
    const hpsDriver = this.homey.drivers.getDriver('home-power-station');
    const hpsDevice = hpsDriver.getDevices().find((d: any) => d.getData().id === stationId);
    if (!hpsDevice) throw new Error('Home Power Station Device nicht gefunden');
    return hpsDevice.getApi();
  }

  onPair(session: PairSession): Promise<void> {
    session.setHandler("list_devices", async () => {
      return await this.onPairListDevices();
    });
    return new Promise<void>(async (resolve) => resolve());
  }

  async onPairListDevices(): Promise<any[]> {
    // ... dein bestehender Code (unverändert) ...
    const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices()
    return new Promise(async (resolve) => {
      let devices: any[] = []
      for(let i = 0; i < homePowerStations.length; i++) {
        const rawStation = homePowerStations[i]
        let station: HomePowerStation = rawStation as unknown as HomePowerStation;
        const stationData = rawStation.getData()
        const stationId = stationData.id;
        const api = station.getApi()
        const wallboxes = await api.readConnectedWallboxes(true, this)
        this.log('Found ' + wallboxes.length + ' wallboxes')
        wallboxes.forEach(value => {
          const settings: WallboxConfig = {
            id: value.id,
            stationId: stationId,
          }
          devices.push({
            name: rawStation.getName() + ' - ' + value.name,
            data: {
              id: 'wb-' + stationId + '-' + Date.now()
            },
            store: {
              settings: settings
            }
          })
        })
      }
      resolve(devices)
    })
  }
}

module.exports = WallboxDriver;
