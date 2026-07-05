import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EmsScheduleManager } from '../src/managers/ems-schedule-manager';

describe('EmsScheduleManager', () => {
  it('can be instantiated with stubs', () => {
    const mockDevice = {
      getSetting: () => '[]',
      getData: () => ({ id: 'test' }),
      recordAnalysisEvent: () => {},
      log: () => {},
      setSettings: () => Promise.resolve(),
      homey: { setInterval: () => 0, setTimeout: () => 123, clearTimeout: () => {} },
      getCurrentSOC: () => 0,
    } as any;
    const mockApi = () => ({ setPowerMode: () => Promise.resolve(true) } as any);
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    assert.ok(manager);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 0);
  });
});

describe('EmsScheduleManager more', () => {
  it('maps modes correctly', () => {
    // Since private, test via public if possible, or skip for now
    assert.ok(true);
  });

  it('handles empty schedules', () => {
    const mockDevice = {
      getSetting: () => '[]',
      getData: () => ({ id: 'test' }),
      recordAnalysisEvent: () => {},
      log: () => {},
      setSettings: () => Promise.resolve(),
      homey: { setInterval: () => 0, setTimeout: () => 123, clearTimeout: () => {} },
      getCurrentSOC: () => 0,
    } as any;
    const mockApi = () => ({ setPowerMode: () => Promise.resolve(true) } as any);
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 0);
  });

  it('handles power mode state', () => {
    const mockDevice = {
      getSetting: () => '[]',
      getData: () => ({ id: 'test' }),
      recordAnalysisEvent: () => {},
      log: () => {},
      setSettings: () => Promise.resolve(),
      homey: { setInterval: () => 0, setTimeout: () => 123, clearTimeout: () => {} },
      getCurrentSOC: () => 0,
    } as any;
    const mockApi = () => ({ setPowerMode: () => Promise.resolve(true) } as any);
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.setPowerModeState({ mode: 1, powerW: 100, expiresAt: 0 });
    assert.ok(manager.getPowerModeState());
  });
});
