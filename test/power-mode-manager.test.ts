import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PowerModeManager } from '../src/managers/power-mode-manager';

describe('PowerModeManager', () => {
  it('can be instantiated', () => {
    const mockDevice = {
      getCurrentSOC: () => 0,
      homey: { setTimeout: () => 0 },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;
    const mockApi = () => ({ setPowerMode: () => Promise.resolve(true) } as any);
    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);
    assert.ok(manager);
    assert.strictEqual(manager.getPowerModeState(), null);
  });

  it('sets and gets state', () => {
    const mockDevice = {
      getCurrentSOC: () => 0,
      homey: { setTimeout: () => 0 },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;
    const mockApi = () => ({ setPowerMode: () => Promise.resolve(true) } as any);
    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);
    manager.setPowerModeState({ mode: 1, powerW: 100, expiresAt: 0 });
    assert.ok(manager.getPowerModeState());
  });
});
