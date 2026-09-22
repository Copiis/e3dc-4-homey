import { describe, it } from 'node:test';
import assert from 'node:assert';
import { listHomePowerPlantIds } from '../src/utils/home-power-plants';

describe('listHomePowerPlantIds', () => {
  it('returns id and name without waiting for station.ready', () => {
    let readyCalled = false;
    const homey = {
      drivers: {
        getDriver: () => ({
          getDevices: () => [{
            ready: async () => { readyCalled = true; },
            getData: () => ({ id: 'rscp-device-1' }),
            getName: () => 'E3DC',
          }],
        }),
      },
    } as any;
    const plants = listHomePowerPlantIds(homey);
    assert.deepStrictEqual(plants, [{ id: 'rscp-device-1', name: 'E3DC' }]);
    assert.strictEqual(readyCalled, false);
  });

  it('returns empty list when the HKW driver is missing', () => {
    const homey = {
      drivers: {
        getDriver: () => { throw new Error('unknown driver'); },
      },
    } as any;
    assert.deepStrictEqual(listHomePowerPlantIds(homey), []);
  });
});
