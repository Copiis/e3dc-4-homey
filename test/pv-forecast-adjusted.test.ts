import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  blendAdjustedForecast,
  computeWeatherRestLandingPoint,
  estimateDailyProductionLandingPoint,
} from '../src/utils/pv-forecast-calculator';

describe('computeWeatherRestLandingPoint', () => {
  it('A = actual + remaining * f when behind schedule stays at/below baseline', () => {
    // expected 22, actual 20 → f≈0.91; remaining 10 → A ≈ 20+9.1 = 29.1 < baseline 32
    const result = computeWeatherRestLandingPoint({
      actualKwh: 20,
      baselineKwh: 32,
      expectedKwhSoFar: 22,
      remainingWeatherKwh: 10,
      correctionFactor: 0.91,
    });
    assert.ok(result >= 20);
    assert.ok(result <= 32.1, `no overshoot when behind, got ${result}`);
  });

  it('allows modest overshoot only when clearly ahead', () => {
    // actual 24, expected 20 → ahead; remaining 12 * f(1.2) = 14.4 → 38.4 capped to baseline*1.1
    const result = computeWeatherRestLandingPoint({
      actualKwh: 24,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      remainingWeatherKwh: 12,
      correctionFactor: 1.2,
    });
    assert.ok(result >= 24);
    assert.ok(result <= 32 * 1.1 + 0.05, `cap at +10% baseline, got ${result}`);
  });

  it('converges to actual when remaining weather is 0', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 31,
      baselineKwh: 32,
      expectedKwhSoFar: 32,
      remainingWeatherKwh: 0,
      correctionFactor: 0.97,
    });
    assert.strictEqual(result, 31);
  });

  it('never goes below actual', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 30,
      baselineKwh: 28,
      expectedKwhSoFar: 28,
      remainingWeatherKwh: 0,
      correctionFactor: 1.1,
    });
    assert.ok(result >= 30);
  });
});

describe('blendAdjustedForecast (weather-rest primary)', () => {
  it('does not crash below previous/baseline at noon when little production yet', () => {
    const result = blendAdjustedForecast({
      actualKwh: 8,
      baselineKwh: 32,
      expectedKwhSoFar: 10,
      correctionFactor: 0.8,
      remainingWeatherKwh: 22,
      previousAdjustedKwh: 32,
      localHour: 12,
    });
    // Soft anchor near baseline early afternoon with low actual
    assert.ok(result >= 28, `expected >= 28, got ${result}`);
    assert.ok(result <= 36, `expected <= 36, got ${result}`);
    assert.ok(result >= 8);
  });

  it('limits afternoon overshoot when not ahead of schedule', () => {
    const result = blendAdjustedForecast({
      actualKwh: 20,
      baselineKwh: 32,
      expectedKwhSoFar: 22,
      correctionFactor: 0.91,
      remainingWeatherKwh: 10,
      // old curve would say 48 — must be ignored as driver
      curveEstimate: 48,
      previousAdjustedKwh: 33,
      localHour: 15,
    });
    assert.ok(result <= 32.1, `expected no overshoot when behind, got ${result}`);
    assert.ok(result >= 20);
  });

  it('allows only modest overshoot when clearly ahead', () => {
    const result = blendAdjustedForecast({
      actualKwh: 24,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      correctionFactor: 1.2,
      remainingWeatherKwh: 12,
      curveEstimate: 48,
      previousAdjustedKwh: 34,
      localHour: 15,
    });
    assert.ok(result < 36.5, `expected modest overshoot only, got ${result}`);
    assert.ok(result >= 24);
  });

  it('never goes below actual', () => {
    const result = blendAdjustedForecast({
      actualKwh: 30,
      baselineKwh: 32,
      expectedKwhSoFar: 31,
      correctionFactor: 0.97,
      remainingWeatherKwh: 1,
      previousAdjustedKwh: 33,
      localHour: 18,
    });
    assert.ok(result >= 30);
  });

  it('converges near actual late in day (low remaining)', () => {
    const result = blendAdjustedForecast({
      actualKwh: 31,
      baselineKwh: 32,
      expectedKwhSoFar: 31.5,
      correctionFactor: 0.98,
      remainingWeatherKwh: 0.5,
      curveEstimate: 40,
      previousAdjustedKwh: 34,
      localHour: 19,
    });
    assert.ok(result <= 33.5, `expected near actual late day, got ${result}`);
    assert.ok(result >= 31);
  });

  it('can step down quickly after previous overshoot', () => {
    const result = blendAdjustedForecast({
      actualKwh: 22,
      baselineKwh: 32,
      expectedKwhSoFar: 24,
      correctionFactor: 0.92,
      remainingWeatherKwh: 8,
      previousAdjustedKwh: 40,
      localHour: 16,
    });
    assert.ok(result < 38, `expected downward correction, got ${result}`);
    assert.ok(result <= 32.1, `expected not above baseline when behind, got ${result}`);
  });

  it('does not climb hour-by-hour via curve when previous is already high', () => {
    // Simulates afternoon stair-steps: each hour maxUp was adding ~1.5 kWh
    let prev = 32.5;
    for (let hour = 13; hour <= 17; hour++) {
      prev = blendAdjustedForecast({
        actualKwh: 18 + (hour - 12) * 2,
        baselineKwh: 32.5,
        expectedKwhSoFar: 20 + (hour - 12) * 2,
        correctionFactor: 0.95,
        remainingWeatherKwh: Math.max(0, 12 - (hour - 12) * 2),
        curveEstimate: 50,
        previousAdjustedKwh: prev,
        localHour: hour,
      });
    }
    assert.ok(prev <= 33.0, `stayed near baseline, got final ${prev}`);
  });
});

describe('estimateDailyProductionLandingPoint taper (legacy helper)', () => {
  it('tapers high rates instead of full linear overshoot', () => {
    const now = Date.UTC(2026, 6, 15, 13, 0, 0);
    const history = [
      {ts: now - 2 * 3600 * 1000, kwh: 5},
      {ts: now - 1 * 3600 * 1000, kwh: 12},
      {ts: now, kwh: 19},
    ];
    const end = now + 4 * 3600 * 1000;
    const landing = estimateDailyProductionLandingPoint(history, now, end);
    assert.ok(landing < 36, `expected tapered < 36, got ${landing}`);
    assert.ok(landing >= 19);
  });
});
