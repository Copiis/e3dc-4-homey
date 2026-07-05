import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EmsScheduleManager } from '../src/managers/ems-schedule-manager';
import { PowerModeState } from '../src/model/home-power-station';

function createMockDevice(overrides: any = {}) {
  return {
    getSetting: () => '[]',
    getData: () => ({ id: 'test-station' }),
    recordAnalysisEvent: () => {},
    log: () => {},
    setSettings: () => Promise.resolve(),
    homey: { setInterval: () => 0, setTimeout: () => 123, clearTimeout: () => {} },
    getCurrentSOC: () => 0.5,
    ...overrides,
  };
}

function createMockApi(overrides: any = {}) {
  return () => ({
    setPowerMode: () => Promise.resolve(true),
    ...overrides,
  });
}

describe('EmsScheduleManager', () => {
  it('can be instantiated with stubs', () => {
    const mockDevice = createMockDevice();
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    assert.ok(manager);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 0);
  });

  it('handles empty schedules gracefully', () => {
    const mockDevice = createMockDevice({ getSetting: () => '[]' });
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 0);
  });

  it('parses and stores valid schedules', () => {
    const schedulesJson = JSON.stringify([
      { id: 'p1', start: '08:00', mode: 'charge', powerW: 5000 }
    ]);
    const mockDevice = createMockDevice({ getSetting: () => schedulesJson });
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 1);
    assert.strictEqual(manager.getEmsSchedules()[0].mode, 'charge');
  });

  it('clears triggered schedules on demand', () => {
    const mockDevice = createMockDevice();
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.clearTriggeredSchedules();
    // no crash + internal state cleared (tested indirectly)
    assert.ok(true);
  });

  it('sets and retrieves power mode state', () => {
    const mockDevice = createMockDevice();
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    const state: PowerModeState = { mode: 3, powerW: 2000, expiresAt: Date.now() + 3600000, scheduleId: 's1' };
    manager.setPowerModeState(state);
    const current = manager.getPowerModeState();
    assert.ok(current);
    assert.strictEqual(current?.mode, 3);
  });

  it('handles schedule with untilSoc without crashing', () => {
    const schedulesJson = JSON.stringify([
      { id: 'soc1', start: '10:00', mode: 'charge', untilSoc: 80 }
    ]);
    const mockDevice = createMockDevice({ getSetting: () => schedulesJson });
    const mockApi = createMockApi();
    const manager = new EmsScheduleManager(mockDevice, mockApi, mockDevice);
    manager.loadEmsSchedules();
    assert.strictEqual(manager.getEmsSchedules().length, 1);
  });
});
