import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';
import {EnergySummaryConfig} from '../../src/model/energy-summary.config';

class EnergySummaryDriver extends Homey.Driver {

  async onInit() {
    this.log('EnergySummaryDriver has been initialized');
  }

  onPair(session: PairSession): Promise<void> {
    session.setHandler('list_devices', async () => this.onPairListDevices());
    return Promise.resolve();
  }

  async onPairListDevices() {
    const homePowerStations = this.homey.drivers.getDriver('home-power-station').getDevices();
    const devices = [];
    for (let i = 0; i < homePowerStations.length; i++) {
      const station = homePowerStations[i];
      const stationData = await station.getData();
      const stationId = stationData.id;
      const settings: EnergySummaryConfig = { stationId };
      devices.push({
        name: station.getName() + ' - ' + this.homey.__('energy-summary.live-label'),
        data: {
          id: 'energy-summary-' + stationId + '-' + Date.now(),
        },
        store: {
          settings,
        },
      });
    }
    return devices;
  }
}

module.exports = EnergySummaryDriver;