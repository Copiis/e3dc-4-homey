import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import {PvForecastStoreConfig} from '../../src/model/pv-forecast.config';

class PvForecastDriver extends Homey.Driver {

  async onInit() {
    this.log('PvForecastDriver has been initialized');
  }

  onPair(session: PairSession): Promise<void> {
    session.setHandler('list_devices', async () => this.onPairListDevices());
    return Promise.resolve();
  }

  async onPairListDevices() {
    const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices();
    const devices = [];
    for (const station of homePowerStations) {
      const stationData = station.getData();
      const stationId = String(stationData.id);
      const settings: PvForecastStoreConfig = { stationId };
      devices.push({
        name: station.getName() + ' - ' + this.homey.__('pv-forecast.label'),
        data: {
          id: 'pv-forecast-' + stationId + '-' + Date.now(),
        },
        store: {
          settings,
        },
      });
    }
    return devices;
  }
}

module.exports = PvForecastDriver;