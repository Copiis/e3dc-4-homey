import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {formatError} from '../../src/utils/error-utils';

class WallboxDriver extends Homey.Driver {

  async onInit() {
    this.log('WallboxDriver has been initialized');
  }

  onPair(session: PairSession): Promise<void> {
    session.setHandler('list_devices', async () => this.onPairListDevices());
    return Promise.resolve();
  }

  async onPairListDevices(): Promise<any[]> {
    const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices();
    const devices: any[] = [];
    for (let i = 0; i < homePowerStations.length; i++) {
      const rawStation = homePowerStations[i];
      const station: HomePowerStation = rawStation as unknown as HomePowerStation;
      const stationData = rawStation.getData();
      const stationId = stationData.id;
      const api = station.getApi();
      const wallboxes = await api.readConnectedWallboxes(true, this);
      this.log('Found ' + wallboxes.length + ' wallboxes');
      wallboxes.forEach(value => {
        const wbId = value.id;
        const settings: WallboxConfig = {
          id: wbId,
          stationId: stationId,
        };
        devices.push({
          name: rawStation.getName() + ' - ' + value.name,
          data: {
            id: 'wb-' + stationId + '-' + wbId,
          },
          store: {
            settings: settings,
          },
        });
      });
    }
    return devices;
  }
}

module.exports = WallboxDriver;