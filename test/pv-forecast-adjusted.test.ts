import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  blendAdjustedForecast,
  estimateDailyProductionLandingPoint,
} from '../src/utils/pv-forecast-calculator';

describe('blendAdjustedForecast', () => {
  it('does not crash below previous/baseline at noon (old min(curve,guided) bug)', () => {
    // Scenario like Insights chart: baseline ~32, actual still low, curve very low
    const result = blendAdjustedForecast({
      actualKwh: 8,
      baselineKwh: 32,
      expectedKwhSoFar: 10,
      correctionFactor: 0.8,
      curveEstimate: 18, // flat morning rate extrapolated
      previousAdjustedKwh: 32, // was showing baseline until 12:00
      localHour: 12,
    });
    // Must not drop to ~18; stay near previous with limited step
    assert.ok(result >= 28, `expected >= 28, got ${result}`);
    assert.ok(result <= 36, `expected <= 36, got ${result}`);
    assert.ok(result >= 8);
  });

  it('limits afternoon overshoot vs baseline', () => {
    const result = blendAdjustedForecast({
      actualKwh: 22,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      correctionFactor: 1.1,
      curveEstimate: 48, // steep midday rate × remaining
      previousAdjustedKwh: 34,
      localHour: 15,
    });
    assert.ok(result < 45, `expected no wild overshoot, got ${result}`);
    assert.ok(result >= 22);
  });

  it('never goes below actual', () => {
    const result = blendAdjustedForecast({
      actualKwh: 30,
      baselineKwh: 32,
      expectedKwhSoFar: 31,
      correctionFactor: 0.97,
      curveEstimate: 28,
      previousAdjustedKwh: 33,
      localHour: 18,
    });
    assert.ok(result >= 30);
  });

  it('converges near actual late in day', () => {
    const result = blendAdjustedForecast({
      actualKwh: 31,
      baselineKwh: 32,
      expectedKwhSoFar: 31.5,
      correctionFactor: 0.98,
      curveEstimate: 40,
      previousAdjustedKwh: 34,
      localHour: 19,
    });
    // late + almost done expected → not far above actual
    assert.ok(result <= 35, `expected near actual late day, got ${result}`);
    assert.ok(result >= 31);
  });
});

describe('estimateDailyProductionLandingPoint taper', () => {
  it('tapers high rates instead of full linear overshoot', () => {
    const now = Date.UTC(2026, 6, 15, 13, 0, 0);
    const history = [
      {ts: now - 2 * 3600 * 1000, kwh: 5},
      {ts: now - 1 * 3600 * 1000, kwh: 12},
      {ts: now, kwh: 19}, // ~7 kWh/h recent
    ];
    const end = now + 4 * 3600 * 1000;
    const landing = estimateDailyProductionLandingPoint(history, now, end);
    // Pure linear 19 + 7*3 = 40; taper should be lower
    assert.ok(landing < 40, `expected tapered < 40, got ${landing}`);
    assert.ok(landing >= 19);
  });
});
