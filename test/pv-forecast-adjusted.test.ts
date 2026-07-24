import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  applyBaselineDayScale,
  blendAdjustedForecast,
  computeInstantCorrectionFactor,
  computeWeatherRestLandingPoint,
  DEFAULT_BASELINE_DAY_SCALE,
  estimateDailyProductionLandingPoint,
  monotoneActualKwh,
  nextCorrectionEma,
  shouldReanticipateAdjusted,
  smoothCorrectionFactor,
  updateDayScaleFromOutcome,
} from '../src/utils/pv-forecast-calculator';

describe('computeWeatherRestLandingPoint', () => {
  it('A = actual + remaining * f when behind stays at/below baseline', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 20,
      baselineKwh: 32,
      expectedKwhSoFar: 22,
      remainingWeatherKwh: 10,
      correctionFactor: 0.91,
      localHour: 15,
    });
    assert.ok(result >= 20);
    assert.ok(result <= 32.1, `no overshoot when behind, got ${result}`);
  });

  it('allows lift over baseline when clearly ahead (re-anticipate residual)', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 24,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      remainingWeatherKwh: 12,
      correctionFactor: 1.1,
      localHour: 15,
    });
    // A ≈ 24 + 12*1.1 = 37.2, soft-capped near baseline*1.2 or actual+R*fmax
    assert.ok(result >= 24);
    assert.ok(result > 32, `should re-anticipate above baseline when ahead, got ${result}`);
    assert.ok(result <= 24 + 12 * 1.1 + 0.2, `not wild overshoot, got ${result}`);
  });

  it('when actual overtook previous A, keeps residual above actual', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 22,
      baselineKwh: 19.5,
      expectedKwhSoFar: 18,
      remainingWeatherKwh: 4,
      correctionFactor: 1.05,
      localHour: 16,
      previousAdjustedKwh: 19.5,
    });
    // Must not glue to 22 — anticipate 22 + 4*f
    assert.ok(result > 22.5, `re-anticipate residual after overtake, got ${result}`);
    assert.ok(result >= 22);
  });

  it('converges to actual when remaining weather is 0', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 31,
      baselineKwh: 32,
      expectedKwhSoFar: 32,
      remainingWeatherKwh: 0,
      correctionFactor: 0.97,
      localHour: 18,
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
      localHour: 17,
    });
    assert.ok(result >= 30);
  });

  it('evening hour binds near actual when residual small path', () => {
    const result = computeWeatherRestLandingPoint({
      actualKwh: 22,
      baselineKwh: 32,
      expectedKwhSoFar: 24,
      remainingWeatherKwh: 6,
      correctionFactor: 1.0,
      localHour: 19,
    });
    assert.ok(result <= 23.5, `expected tight evening bind, got ${result}`);
    assert.ok(result >= 22);
  });
});

describe('shouldReanticipateAdjusted', () => {
  it('detects overtake when actual reaches previous A with residual left', () => {
    assert.strictEqual(
      shouldReanticipateAdjusted({
        actualKwh: 19.5,
        previousAdjustedKwh: 19.5,
        remainingWeatherKwh: 4,
      }),
      'above',
    );
  });

  it('detects uncatchable below previous A', () => {
    assert.strictEqual(
      shouldReanticipateAdjusted({
        actualKwh: 10,
        previousAdjustedKwh: 30,
        remainingWeatherKwh: 5, // optimistic 10+5.5=15.5 << 30
      }),
      'below',
    );
  });

  it('holds when still on track under A with enough residual', () => {
    assert.strictEqual(
      shouldReanticipateAdjusted({
        actualKwh: 12,
        previousAdjustedKwh: 20,
        remainingWeatherKwh: 12,
      }),
      'none',
    );
  });
});

describe('correction / scale helpers', () => {
  it('refuses huge morning f (needs min expected+actual)', () => {
    const f = computeInstantCorrectionFactor(7, 2);
    assert.strictEqual(f, 1, 'too little model energy → f=1');
  });

  it('clamps f to 0.85–1.10', () => {
    assert.ok(computeInstantCorrectionFactor(20, 10) <= 1.10);
    assert.ok(computeInstantCorrectionFactor(8, 12) >= 0.85);
  });

  it('EMA smooths spikes', () => {
    const s = smoothCorrectionFactor(1.1, 0.9, 0.25);
    assert.ok(s > 0.9 && s < 1.1);
  });

  it('default day scale ~0.85', () => {
    assert.strictEqual(applyBaselineDayScale(40), roundLike(40 * DEFAULT_BASELINE_DAY_SCALE));
  });

  it('learns day scale from outcomes', () => {
    // raw B=40, actual=32 → ratio 0.8
    const next = updateDayScaleFromOutcome(0.85, 40, 32);
    assert.ok(next < 0.85 && next > 0.78, `got ${next}`);
  });

  it('monotone actual never decreases', () => {
    assert.strictEqual(monotoneActualKwh(20, 18), 20);
    assert.strictEqual(monotoneActualKwh(20, 22), 22);
  });

  it('nextCorrectionEma advances', () => {
    const e = nextCorrectionEma(20, 18, 1.0);
    assert.ok(e >= 0.85 && e <= 1.1);
  });
});

function roundLike(n: number): number {
  return Math.round(n * 10) / 10;
}

describe('blendAdjustedForecast (weather-rest + hard caps)', () => {
  it('does not crash below previous/baseline at noon when little production yet', () => {
    const result = blendAdjustedForecast({
      actualKwh: 8,
      baselineKwh: 32,
      expectedKwhSoFar: 10,
      correctionFactor: 0.9,
      remainingWeatherKwh: 22,
      previousAdjustedKwh: 32,
      localHour: 12,
    });
    assert.ok(result >= 28, `expected >= 28, got ${result}`);
    assert.ok(result <= 33, `expected <= 33, got ${result}`);
    assert.ok(result >= 8);
  });

  it('never exceeds baseline when not ahead', () => {
    const result = blendAdjustedForecast({
      actualKwh: 20,
      baselineKwh: 32,
      expectedKwhSoFar: 22,
      correctionFactor: 0.91,
      remainingWeatherKwh: 10,
      curveEstimate: 48,
      previousAdjustedKwh: 32,
      localHour: 15,
    });
    assert.ok(result <= 32.1, `expected no overshoot when behind, got ${result}`);
    assert.ok(result >= 20);
  });

  it('re-anticipates above previous A when production overtakes (Insights pattern)', () => {
    // 15:00-ish: B=19.5, A was 19.5, actual reaches 19.5 with rest still left
    const result = blendAdjustedForecast({
      actualKwh: 19.5,
      baselineKwh: 19.5,
      expectedKwhSoFar: 16,
      correctionFactor: 1.1,
      remainingWeatherKwh: 5,
      previousAdjustedKwh: 19.5,
      localHour: 15,
      reanticipate: 'above',
    });
    assert.ok(result > 19.5, `must lift above overtaken line, got ${result}`);
    assert.ok(result >= 19.5 + 1.0, `must keep residual, got ${result}`);
  });

  it('re-anticipates down when uncatchable under previous A', () => {
    const result = blendAdjustedForecast({
      actualKwh: 10,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      correctionFactor: 0.85,
      remainingWeatherKwh: 4,
      previousAdjustedKwh: 30,
      localHour: 16,
      reanticipate: 'below',
    });
    // optimistic end ≈ 10+4.4 = 14.4 — should drop well below 30
    assert.ok(result < 26, `expected clear downward re-anticipate, got ${result}`);
    assert.ok(result >= 10);
  });

  it('never goes below actual', () => {
    const result = blendAdjustedForecast({
      actualKwh: 30,
      baselineKwh: 32,
      expectedKwhSoFar: 31,
      correctionFactor: 0.97,
      remainingWeatherKwh: 1,
      previousAdjustedKwh: 32,
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
      remainingWeatherKwh: 0.5,
      curveEstimate: 40,
      previousAdjustedKwh: 32,
      localHour: 19,
    });
    assert.ok(result <= 32.0, `expected near actual late day, got ${result}`);
    assert.ok(result >= 31);
  });

  it('steps down after previous overshoot without staying high', () => {
    const result = blendAdjustedForecast({
      actualKwh: 22,
      baselineKwh: 32,
      expectedKwhSoFar: 24,
      correctionFactor: 0.92,
      remainingWeatherKwh: 8,
      previousAdjustedKwh: 40,
      localHour: 16,
      reanticipate: 'below',
    });
    assert.ok(result < 38, `expected downward correction, got ${result}`);
  });

  it('when behind model stays at/below baseline across afternoon hours', () => {
    let prev = 32.0;
    for (let hour = 13; hour <= 15; hour++) {
      // actual slightly under expected → behind
      prev = blendAdjustedForecast({
        actualKwh: 14 + (hour - 12) * 1.5,
        baselineKwh: 32.0,
        expectedKwhSoFar: 18 + (hour - 12) * 2,
        correctionFactor: 0.9,
        remainingWeatherKwh: Math.max(0, 14 - (hour - 12) * 2),
        previousAdjustedKwh: prev,
        localHour: hour,
      });
    }
    assert.ok(prev <= 32.1, `stayed at/below baseline while behind, got final ${prev}`);
  });

  it('rejects morning-style explosion (high remaining * f with low expected)', () => {
    // Even if caller passes inflated f, clamps + baseline cap keep A sane
    const result = blendAdjustedForecast({
      actualKwh: 7,
      baselineKwh: 30, // already scaled display baseline
      expectedKwhSoFar: 2,
      correctionFactor: 1.1,
      remainingWeatherKwh: 28,
      previousAdjustedKwh: 30,
      localHour: 13,
    });
    assert.ok(result <= 30.1, `must not explode above baseline, got ${result}`);
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
