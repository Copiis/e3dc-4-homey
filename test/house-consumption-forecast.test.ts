import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  forecastHouseConsumptionKwh,
  isHighDay,
  isLowDay,
  closedDayHouseKwh,
} from '../src/utils/house-consumption-forecast';

function daysOf(value: number, count: number): number[] {
  return Array.from({length: count}, () => value);
}

describe('house consumption forecast', () => {
  it('drops a low day from the mean and keeps a normal yesterday', () => {
    const days = [...daysOf(11, 13), 4];
    days[3] = 4;
    days[13] = 11;
    const forecast = forecastHouseConsumptionKwh(days);
    assert.ok(forecast != null);
    assert.ok(Math.abs(forecast - 11) < 1e-9);
  });

  it('keeps the raw mean when fewer than 7 days would remain', () => {
    const days = [...daysOf(20, 6), ...daysOf(5, 8)];
    const forecast = forecastHouseConsumptionKwh(days);
    const raw = (6 * 20 + 8 * 5) / 14;
    assert.ok(forecast != null);
    assert.ok(Math.abs(forecast - raw) < 1e-9);
    assert.ok(isLowDay(5, raw));
  });

  it('adds half the gap when only yesterday is high', () => {
    const days = [...daysOf(11, 13), 16];
    const raw = (13 * 11 + 16) / 14;
    const forecast = forecastHouseConsumptionKwh(days);
    assert.ok(forecast != null);
    assert.ok(isHighDay(16, raw));
    assert.ok(Math.abs(forecast - (raw + (16 - raw) / 2)) < 1e-9);
  });

  it('uses all of yesterday when one of the two days before is high too', () => {
    const days = [...daysOf(11, 12), 16, 16];
    assert.strictEqual(forecastHouseConsumptionKwh(days), 16);
  });

  it('does not let a missing yesterday become the day before', () => {
    const days: Array<number | null> = [...daysOf(11, 12), 16, null];
    const forecast = forecastHouseConsumptionKwh(days);
    const raw = (12 * 11 + 16) / 13;
    assert.ok(forecast != null);
    assert.ok(Math.abs(forecast - raw) < 1e-9);
  });

  it('returns null without a single valid day', () => {
    assert.strictEqual(forecastHouseConsumptionKwh([null, null]), null);
  });

  it('treats a day without a wallbox start counter as missing', () => {
    const start = new Date('2026-09-20T22:00:00.000Z');
    const house = closedDayHouseKwh(20000, [{
      stepMs: 3_600_000,
      samples: [{t: Date.parse('2026-09-21T01:00:00.000Z'), v: 300}],
    }], start);
    assert.strictEqual(house, null);
  });

  it('subtracts the wallbox delta of a covered day', () => {
    const start = new Date('2026-10-03T22:00:00.000Z');
    const house = closedDayHouseKwh(20776, [{
      stepMs: 3_600_000,
      samples: [
        {t: Date.parse('2026-10-03T22:00:00.000Z'), v: 350},
        {t: Date.parse('2026-10-04T22:00:00.000Z'), v: 361.5},
      ],
    }], start);
    assert.ok(house != null);
    assert.ok(Math.abs(house - (20.776 - 11.5)) < 1e-9);
  });
});
