import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  DiagnosticManager,
  DETAILED_DIAGNOSTICS_MAX_MS,
  DETAILED_DIAGNOSTICS_ENABLED_AT_KEY,
  DETAILED_DIAGNOSTICS_AFTER_EXPORT_MS,
} from '../src/managers/diagnostic-manager';

function createMockDevice(overrides: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = {};
  const settings: Record<string, unknown> = { detailedDiagnostics: false };
  let timeoutCb: (() => void) | null = null;
  let timeoutDelay = 0;

  const device = {
    getSetting: (key: string) => settings[key],
    setSettings: async (patch: Record<string, unknown>) => {
      Object.assign(settings, patch);
    },
    getStoreValue: (key: string) => store[key],
    setStoreValue: async (key: string, value: unknown) => {
      store[key] = value;
    },
    getName: () => 'test',
    getId: () => 'id',
    getAvailable: () => true,
    syncErrorCount: 0,
    homey: {
      manifest: { version: '1.0' },
      setTimeout: (cb: () => void, delay: number) => {
        timeoutCb = cb;
        timeoutDelay = delay;
        return 1 as unknown as NodeJS.Timeout;
      },
    },
    log: () => {},
    error: () => {},
    _store: store,
    _settings: settings,
    _fireTimeout: () => {
      if (timeoutCb) {
        const cb = timeoutCb;
        timeoutCb = null;
        cb();
      }
    },
    _lastTimeoutDelay: () => timeoutDelay,
    ...overrides,
  };
  return device as any;
}

describe('DiagnosticManager', () => {
  it('can be instantiated', () => {
    const manager = new DiagnosticManager(createMockDevice(), 'key');
    assert.ok(manager);
  });

  it('handles record sync success/failure', () => {
    const manager = new DiagnosticManager(createMockDevice(), 'key');
    manager.recordSyncSuccess({
      pvDelivery: 100,
      houseConsumption: 0,
      gridDelivery: 0,
      batteryChargingLevel: 0.5,
      firmwareVersion: '1.0',
      wallboxPowerState: [],
    } as any);
    manager.recordSyncFailure('test error');
    assert.ok(true);
  });

  it('on enable stores timestamp and schedules 60 min auto-off', () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    const manager = new DiagnosticManager(device, 'key');
    const before = Date.now();
    manager.onDetailedDiagnosticsSettingChanged(true);
    const enabledAt = device._store[DETAILED_DIAGNOSTICS_ENABLED_AT_KEY] as number;
    assert.ok(enabledAt >= before && enabledAt <= Date.now() + 50);
    assert.ok(
      Math.abs(device._lastTimeoutDelay() - DETAILED_DIAGNOSTICS_MAX_MS) < 50,
      `expected ~${DETAILED_DIAGNOSTICS_MAX_MS}, got ${device._lastTimeoutDelay()}`,
    );
  });

  it('resume with expired deadline disables immediately', async () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    device._store[DETAILED_DIAGNOSTICS_ENABLED_AT_KEY] = Date.now() - DETAILED_DIAGNOSTICS_MAX_MS - 1000;
    const manager = new DiagnosticManager(device, 'key');
    manager.resumeDetailedDiagnosticsAutoOff();
    // setSettings is async; wait a tick
    await Promise.resolve();
    assert.strictEqual(device._settings.detailedDiagnostics, false);
  });

  it('resume without deadline (legacy stuck ON) disables immediately', async () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    // no store timestamp
    const manager = new DiagnosticManager(device, 'key');
    manager.resumeDetailedDiagnosticsAutoOff();
    await Promise.resolve();
    assert.strictEqual(device._settings.detailedDiagnostics, false);
  });

  it('resume with remaining time reschedules remaining delay', () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    const remaining = 15 * 60 * 1000;
    device._store[DETAILED_DIAGNOSTICS_ENABLED_AT_KEY] = Date.now() - (DETAILED_DIAGNOSTICS_MAX_MS - remaining);
    const manager = new DiagnosticManager(device, 'key');
    manager.resumeDetailedDiagnosticsAutoOff();
    assert.ok(
      Math.abs(device._lastTimeoutDelay() - remaining) < 2000,
      `expected ~${remaining}, got ${device._lastTimeoutDelay()}`,
    );
    assert.strictEqual(device._settings.detailedDiagnostics, true);
  });

  it('after-export shortens to 10 min without exceeding 60 min cap', () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    device._store[DETAILED_DIAGNOSTICS_ENABLED_AT_KEY] = Date.now();
    const manager = new DiagnosticManager(device, 'key');
    manager.scheduleAutoOffAfterExport();
    assert.ok(
      Math.abs(device._lastTimeoutDelay() - DETAILED_DIAGNOSTICS_AFTER_EXPORT_MS) < 100,
      `expected ~${DETAILED_DIAGNOSTICS_AFTER_EXPORT_MS}, got ${device._lastTimeoutDelay()}`,
    );
  });

  it('timer callback disables detailedDiagnostics', async () => {
    const device = createMockDevice();
    device._settings.detailedDiagnostics = true;
    const manager = new DiagnosticManager(device, 'key');
    manager.onDetailedDiagnosticsSettingChanged(true);
    device._fireTimeout();
    await Promise.resolve();
    assert.strictEqual(device._settings.detailedDiagnostics, false);
  });
});
