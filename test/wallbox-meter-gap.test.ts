import { describe, it } from 'node:test';
import assert from 'node:assert';
import Homey from 'homey';
import { wallboxTotalEnergyKwh } from '../src/utils/energy-meter-integrator';

function meterDevice() {
  const store = new Map<string, unknown>();
  return {
    getStoreValue: (key: string) => store.get(key),
    setStoreValue: (key: string, value: unknown) => {
      store.set(key, value);
      return Promise.resolve();
    },
    log: () => undefined,
    error: () => undefined,
  } as unknown as Homey.Device;
}

describe('wallbox meter gap', () => {
  it('does not book a multi-hour pause as charged energy', () => {
    const device = meterDevice();
    const start = 1_700_000_000_000;
    const first = wallboxTotalEnergyKwh(5_000, 11_000, device, start);
    const later = wallboxTotalEnergyKwh(5_000, 11_000, device, start + 2 * 60 * 60 * 1000);
    assert.strictEqual(first, 5);
    assert.strictEqual(later, 5);
  });

  it('still counts a short pause between samples', () => {
    const device = meterDevice();
    const start = 1_700_000_000_000;
    wallboxTotalEnergyKwh(5_000, 11_000, device, start);
    const later = wallboxTotalEnergyKwh(5_000, 11_000, device, start + 30_000);
    assert.ok(later !== undefined && later > 5);
    assert.ok(later < 5.2);
  });
});
