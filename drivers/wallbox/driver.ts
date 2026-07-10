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
    try {
      const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices();
      const devices: unknown[] = [];

      for (let i = 0; i < homePowerStations.length; i++) {
        const rawStation = homePowerStations[i];
        try {
          const station: HomePowerStation = rawStation as unknown as HomePowerStation;
          const stationData = rawStation.getData();
          const stationId = stationData.id;
          const api = await station.getApi();   // note: some implementations return promise
          const wallboxes = await api.readConnectedWallboxes(true, this);
          this.log('Found ' + wallboxes.length + ' wallboxes for station ' + stationId);

          wallboxes.forEach((value: any) => {
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
        } catch (stationErr) {
          this.error('Failed to list wallboxes for one station: ' + formatError(stationErr));
          // continue with other stations
        }
      }
      return devices;
    } catch (e) {
      this.error('onPairListDevices (wallbox) crashed: ' + formatError(e));
      return []; // never let the pair flow die completely
    }
  }
}

module.exports = WallboxDriver;