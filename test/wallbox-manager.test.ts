import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WallboxManager } from '../src/managers/wallbox-manager';

describe('WallboxManager', () => {
  it('can be instantiated and checks linked', () => {
    const mockHomey = {
      drivers: {
        getDriver: () => ({ getDevices: () => [] })
      }
    };
    const mockLogger = { log: () => {}, error: () => {} };
    const mockApi = () => ({ readWallboxEmsSettings: () => Promise.resolve({}) } as any);
    const manager = new WallboxManager(mockHomey, 'test-id', mockLogger, mockApi);
    assert.ok(manager);
    assert.strictEqual(manager.hasLinkedWallboxes(), false);
  });
});
