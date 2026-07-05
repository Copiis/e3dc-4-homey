import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveUsableCapacityWh, formatSohPercent } from '../src/utils/battery-capacity';
import { BatteryData } from '../src/model/battery-data';

function makeBattery(overrides: Partial<BatteryData> = {}): BatteryData {
  return {
    capacity: 10000,
    asoc: 0,
    asocRaw: undefined,
    usableCapacityWh: undefined,
    reserveMaxWh: undefined,
    dcbFullChargeWh: undefined,
    ...overrides,
  } as BatteryData;
}

describe('battery-capacity', () => {
  it('resolveUsableCapacityWh prefers usableCapacityWh', () => {
    const b = makeBattery({ usableCapacityWh: 8500 });
    assert.strictEqual(resolveUsableCapacityWh(b), 8500);
  });

  it('falls back to specified capacity', () => {
    const b = makeBattery({ capacity: 12000 });
    assert.strictEqual(resolveUsableCapacityWh(b), 12000);
  });

  it('formatSohPercent calculates correctly', () => {
    assert.strictEqual(formatSohPercent(8000, 10000), '80.0');
    assert.strictEqual(formatSohPercent(0, 10000), '—');
  });
});
