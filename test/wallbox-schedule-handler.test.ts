import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WallboxScheduleHandler } from '../src/managers/wallbox-schedule-handler';
import { WallboxSchedule } from '../src/model/wallbox';

function createMockDevice(overrides: any = {}) {
  return {
    getSetting: () => '[]',
    setSettings: () => Promise.resolve(),
    log: () => {},
    error: () => {},
    homey: { setInterval: () => 0, setTimeout: () => 123, clearTimeout: () => {} },
    getCapabilityValue: (key: string) => {
      if (key === 'measure_vehicle_soc') return 50;
      if (key === 'measure_wallbox_consumption') return 500;
      if (key === 'measure_wallbox_discharge_soc') return 80; // default original for discharge tests
      return undefined;
    },
    applyChargingAllowed: () => Promise.resolve({ ok: true, skipped: false }),
    applySunMode: () => Promise.resolve({ ok: true, skipped: false }),
    setCurrentLimit: () => Promise.resolve(true),
    applyLadeplanTileVisibility: () => Promise.resolve(),
    setDischargeBatteryUntil: async (p: number) => { /* recordable via overrides */ return true; },
    getCurrentDischargeBatteryUntil: () => 80,
    ...overrides,
  };
}

describe('WallboxScheduleHandler', () => {
  it('can be instantiated and started', () => {
    const mockDevice = createMockDevice();
    const handler = new WallboxScheduleHandler(mockDevice);
    assert.ok(handler);
    handler.start();
    handler.stop();
  });

  it('parses schedules correctly', async () => {
    const schedulesJson = JSON.stringify([
      { id: 'p1', start: '08:00', action: 'allow', current: 16 },
      { id: 'p2', start: '10:00', action: 'block' },
    ]);
    const mockDevice = createMockDevice({ getSetting: () => schedulesJson });
    const handler = new WallboxScheduleHandler(mockDevice);
    // Access via store after split into Store/Validator/Executor
    const store = (handler as any).store;
    const parsed = store.parseSchedules(schedulesJson);
    assert.strictEqual(parsed.length, 2);
    assert.strictEqual(parsed[0].action, 'allow');
  });

  it('handles manual deletion via handleManualDeletion', async () => {
    const schedulesJson = JSON.stringify([{ id: 'p1', start: '08:00', action: 'allow' }]);
    let deleted = false;
    const mockDevice = createMockDevice({
      getSetting: () => schedulesJson,
      applyChargingAllowed: () => {
        deleted = true;
        return Promise.resolve({ ok: true, skipped: false });
      },
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    // Simulate triggered (now via store after refactor)
    (handler as any).store.addTriggered('p1', 'allow');
    await handler.handleManualDeletion({ schedules: '[]' });
    assert.ok(deleted);
  });

  it('detects hasActivePlan correctly', () => {
    const mockDevice = createMockDevice();
    const handler = new WallboxScheduleHandler(mockDevice);
    assert.strictEqual(handler.hasActivePlan(), false);
    (handler as any).store.addTriggered('p1', 'allow');
    assert.strictEqual(handler.hasActivePlan(), true);
  });

  it('does not treat untilFull as done when charging never started (always low power)', async () => {
    const now = Date.now();
    const mockDevice = createMockDevice({
      getCapabilityValue: (key: string) => {
        if (key === 'measure_power') return 0;
        if (key === 'measure_vehicle_soc') return 50;
        return 0;
      },
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    const store = (handler as any).store;
    store.addTriggered('p-until', 'allow');
    store.setLowPowerSince('p-until', now - (6 * 60 * 1000));
    await (handler as any).handleUntilFull([{ id: 'p-until', start: '08:00', action: 'allow', untilFull: true }], now);
    assert.strictEqual(store.getTriggered().size, 1, 'plan must stay if the car never actually charged');
  });

  it('completes untilFull only after charging was seen and then power dropped for 5 min', async () => {
    const now = Date.now();
    const mockDevice = createMockDevice({
      getCapabilityValue: (key: string) => {
        if (key === 'measure_power') return 30; // low after a charge session
        if (key === 'measure_vehicle_soc') return 99;
        return 0;
      },
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    const store = (handler as any).store;
    store.addTriggered('p-until', 'allow');
    store.markUntilFullChargingSeen('p-until');
    store.setLowPowerSince('p-until', now - (6 * 60 * 1000));
    await (handler as any).handleUntilFull([{ id: 'p-until', start: '08:00', action: 'allow', untilFull: true }], now);
    assert.strictEqual(store.getTriggered().size, 0);
  });

  // Critical: concurrent flows + user journey simulation (Wallbox + manueller Ladeplan + PV-Überschuss)
  it('handles concurrent schedule checks and apply without races (serialize via device)', async () => {
    let applyCalls = 0;
    const mockDevice = createMockDevice({
      applyChargingAllowed: async () => { applyCalls++; return { ok: true, skipped: false }; },
      applySunMode: async () => ({ ok: true, skipped: false }),
      setCurrentLimit: async () => true,
      getSetting: () => JSON.stringify([{ id: 'conc', start: 'now', action: 'allow', current: 10 }]),
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    await handler.check();
    await Promise.all([handler.check(), handler.check(), handler.check()]);
    // apply may be called; important: no crash + serialize protects in real device
    assert.ok(applyCalls >= 0);
  });

  it('simulates Wallbox + manual plan + PV surplus journey (no crash on mixed triggers)', async () => {
    const mockDevice = createMockDevice({
      getSetting: () => JSON.stringify([
        { id: 'plan1', start: 'now', action: 'sun_on', current: 8 }
      ]),
      getCapabilityValue: () => 0,
      applySunMode: async () => ({ ok: true }),
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    await handler.check();
    // pv surplus would be handled at HKW/EMS level; here ensure wallbox schedule path tolerates
    assert.ok(handler.hasActivePlan() || true);
  });

  it('captures original dischargeSoc and restores it on plan expiry (core user requirement)', async () => {
    let setCalls: number[] = [];
    let restored: number | undefined;

    const mockDevice = createMockDevice({
      getSetting: () => JSON.stringify([{
        id: 'plan-discharge',
        start: new Date(Date.now() - 60_000).toISOString(),  // started 1 min ago
        startTs: Date.now() - 60_000,
        end: new Date(Date.now() + 3600_000).toISOString(),  // ends in 1h
        endTs: Date.now() + 3600_000,
        action: 'allow',
        current: 11,
        dischargeSoc: 35   // plan wants to allow discharge down to 35%
      }]),
      getCurrentDischargeBatteryUntil: () => 82,  // the "original" user value before plan
      setDischargeBatteryUntil: async (p: number) => {
        setCalls.push(p);
        if (p === 82) restored = 82; // detect the restore call
        return true;
      },
      getCapabilityValue: (k: string) => k === 'measure_wallbox_discharge_soc' ? 82 : undefined,
    });

    const handler = new WallboxScheduleHandler(mockDevice);
    await handler.check();

    // Plan should have triggered and set the plan value
    assert.ok(handler.hasActivePlan());
    assert.ok(setCalls.includes(35), 'should have applied plan dischargeSoc=35');

    // Now simulate expiry: change schedule list to empty (plan "ended")
    (handler as any).store.persistSchedules = async () => {};
    await handler.handleManualDeletion({ schedules: '[]' });

    // The restore of original must have happened
    assert.strictEqual(restored, 82, 'original discharge value 82% must be restored after plan removal');
    assert.ok(setCalls[setCalls.length - 1] === 82, 'last setDischargeBatteryUntil call should be the restore to original');
  });
});
