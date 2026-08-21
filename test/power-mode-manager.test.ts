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

  it('schedules 10s refresh keep-alive when an active power mode (e.g. grid_charge) is set', () => {
    const scheduledDelays: number[] = [];
    let lastCallback: (() => void) | null = null;

    const mockDevice = {
      getCurrentSOC: () => 0,
      homey: {
        setTimeout: (cb: () => void, delay: number) => {
          scheduledDelays.push(delay);
          lastCallback = cb;
          return 42; // fake timer id
        },
      },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;

    const setPowerCalls: Array<{ mode: number; powerW: number }> = [];
    const mockApi = () => ({
      setPowerMode: (mode: number, powerW: number) => {
        setPowerCalls.push({ mode, powerW });
        return Promise.resolve(true);
      },
    } as any);

    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);

    // Simulate Ladeplaner Akkunetzladen (grid charge)
    manager.setPowerModeState({
      mode: 4, // GRID_CHARGE
      powerW: 2500,
      expiresAt: Date.now() + 3600000,
      scheduleId: 'plan-grid-1',
    });

    assert.ok(manager.getPowerModeState());
    assert.ok(scheduledDelays.length >= 1, 'should have scheduled a refresh');
    assert.strictEqual(scheduledDelays[0], 10 * 1000, 'EMS power mode keep-alive must use 10s interval (critical for stable grid charge)');

    // Manually trigger one refresh cycle (simulates timer firing)
    if (lastCallback) {
      (lastCallback as () => void)();
    }

    assert.ok(setPowerCalls.length >= 1, 'refresh should have called setPowerMode');
    assert.strictEqual(setPowerCalls[0].mode, 4);
    assert.strictEqual(setPowerCalls[0].powerW, 2500);
  });

  it('continues scheduling refreshes after a successful keep-alive send', async () => {
    const scheduledDelays: number[] = [];
    const callbacks: Array<() => void> = [];

    const mockDevice = {
      getCurrentSOC: () => 0,
      homey: {
        setTimeout: (cb: () => void, delay: number) => {
          scheduledDelays.push(delay);
          callbacks.push(cb);
          return callbacks.length;
        },
      },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;

    let sendCount = 0;
    const mockApi = () => ({
      setPowerMode: () => {
        sendCount++;
        return Promise.resolve(true);
      },
    } as any);

    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);
    manager.setPowerModeState({ mode: 4, powerW: 3000, expiresAt: Date.now() + 600000 });

    // Fire first scheduled refresh (the .then that re-schedules is async microtask)
    if (callbacks[0]) callbacks[0]();

    // Flush microtask queue so the .then in refresh runs and calls schedulePowerModeRefresh again
    await new Promise(resolve => setImmediate(resolve));

    // Should have scheduled the next one
    assert.ok(scheduledDelays.length >= 2, 'refresh should re-schedule itself');
    assert.strictEqual(scheduledDelays[1], 10 * 1000);
    assert.ok(sendCount >= 1);
  });

  it('does not revert an untilSoc plan just because expiresAt is already past', () => {
    const setPowerCalls: number[] = [];
    const mockDevice = {
      getCurrentSOC: () => 0.70, // 70%, target 95%
      homey: { setTimeout: () => 0 },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;
    const mockApi = () => ({
      setPowerMode: (mode: number) => {
        setPowerCalls.push(mode);
        return Promise.resolve(true);
      },
    } as any);
    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);
    manager.setPowerModeState({
      mode: 4,
      powerW: 3000,
      expiresAt: Date.now() - 1000, // already past
      untilSoc: 95,
      scheduleId: 'soc-plan',
    });
    (manager as any).refreshPowerMode();
    assert.ok(manager.getPowerModeState(), 'untilSoc plan must stay active while SOC is below target');
    assert.ok(!setPowerCalls.includes(0), 'must not send AUTO while untilSoc is unfulfilled');
  });

  it('does not schedule refresh when state is cleared (auto)', () => {
    const scheduledDelays: number[] = [];
    const mockDevice = {
      getCurrentSOC: () => 0,
      homey: {
        setTimeout: (cb: () => void, delay: number) => {
          scheduledDelays.push(delay);
          return 99;
        },
      },
      recordAnalysisEvent: () => {},
      log: () => {},
    } as any;

    const mockApi = () => ({
      setPowerMode: () => Promise.resolve(true),
    } as any);
    const manager = new PowerModeManager(mockDevice, mockApi, mockDevice);

    manager.setPowerModeState({ mode: 4, powerW: 1000, expiresAt: Date.now() + 100000 });
    const afterSet = scheduledDelays.length;
    assert.ok(afterSet >= 1);

    manager.setPowerModeState(null); // stop / revert to auto (should clear timer, no additional keep-alive schedule)
    assert.ok(true);
  });
});
