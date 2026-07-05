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
      return undefined;
    },
    applyChargingAllowed: () => Promise.resolve({ ok: true, skipped: false }),
    applySunMode: () => Promise.resolve({ ok: true, skipped: false }),
    setCurrentLimit: () => Promise.resolve(true),
    applyLadeplanTileVisibility: () => Promise.resolve(),
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
    // Access private for test via any (acceptable in test)
    const parsed = (handler as any).parseSchedules(schedulesJson);
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
    // Simulate triggered
    (handler as any).triggeredWallboxSchedules.set('p1', 'allow');
    await handler.handleManualDeletion({ schedules: '[]' });
    assert.ok(deleted);
  });

  it('detects hasActivePlan correctly', () => {
    const mockDevice = createMockDevice();
    const handler = new WallboxScheduleHandler(mockDevice);
    assert.strictEqual(handler.hasActivePlan(), false);
    (handler as any).triggeredWallboxSchedules.set('p1', 'allow');
    assert.strictEqual(handler.hasActivePlan(), true);
  });

  it('handles untilFull logic stub (SOC case)', async () => {
    const mockDevice = createMockDevice({
      getCapabilityValue: (key: string) => key === 'measure_vehicle_soc' ? 96 : 0,
    });
    const handler = new WallboxScheduleHandler(mockDevice);
    (handler as any).triggeredWallboxSchedules.set('p-until', 'allow');
    await (handler as any).handleUntilFull([{ id: 'p-until', start: '08:00', action: 'allow', untilFull: true, untilVehicleSoc: 95 }], Date.now());
    assert.strictEqual((handler as any).triggeredWallboxSchedules.size, 0);
  });
});
