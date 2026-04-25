import Homey from 'homey';
import PairSession from 'homey/lib/PairSession';

class WallboxDriver extends Homey.Driver {

  async onInit() {
    this.log('✅ WallboxDriver has been initialized (TEST MODE)');
  }

  onPair(session: PairSession): Promise<void> {
    session.setHandler("list_devices", async () => {
      this.log('🔍 Dummy-Pairing: E3DC Wallbox wird angezeigt');
      return [{
        name: 'E3DC Wallbox',
        data: { id: 'test-wallbox-12345' },
        store: { settings: { id: 1, stationId: 1 } }
      }];
    });
    return new Promise<void>(async (resolve) => resolve());
  }
}

module.exports = WallboxDriver;