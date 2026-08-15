import {describe, it} from 'node:test';
import assert from 'node:assert';
import {
  adjustedSoftCap,
  applyBaselineDayScale,
  blendAdjustedForecast,
  capRemainingByPace,
  computeInstantCorrectionFactor,
  computeWeatherRestLandingPoint,
  DEFAULT_BASELINE_DAY_SCALE,
  effectiveRemainingWeatherKwh,
  eveningResidualTaper,
  estimateDailyProductionLandingPoint,
  estimatePaceRemainingKwh,
  EVENING_FLATTEN_HOURS,
  mayExceedBaseline,
  monotoneActualKwh,
  nextCorrectionEma,
  recentProductionRateKwhPerHour,
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

  it('allows lift over baseline only when Ist is near B (not mere ahead-of-model)', () => {
    // actual 24 / B 32 = 0.75 — mayExceedBaseline false → A capped at B
    const mid = computeWeatherRestLandingPoint({
      actualKwh: 24,
      baselineKwh: 32,
      expectedKwhSoFar: 20,
      remainingWeatherKwh: 12,
      correctionFactor: 1.08,
      localHour: 15,
    });
    assert.ok(mid >= 24);
    assert.ok(mid <= 32.1, `mid-day far under B must not exceed B, got ${mid}`);

    // Ist still under B (Insights 14.08. 17 h: 29 vs B 32) — no lift over B
    const near = computeWeatherRestLandingPoint({
      actualKwh: 29,
      baselineKwh: 32,
      expectedKwhSoFar: 25,
      remainingWeatherKwh: 8,
      correctionFactor: 1.08,
      localHour: 16,
    });
    assert.ok(near >= 29);
    assert.ok(near <= 32.1, `under B must stay at/below B, got ${near}`);

    // Ist already at B → small residual above B is ok
    const atB = computeWeatherRestLandingPoint({
      actualKwh: 32.1,
      baselineKwh: 32,
      expectedKwhSoFar: 30,
      remainingWeatherKwh: 3,
      correctionFactor: 1.05,
      localHour: 17,
    });
    assert.ok(atB >= 32.1);
    assert.ok(atB <= 32 * 1.05 + 0.2, `at/over B may lift slightly, got ${atB}`);
  });

  it('does not explode when near baseline with inflated remaining (Insights 25.07.)', () => {
    // 18:10 local: B≈31.6, Ist≈31.4, A was 37.7 with R still large
    const result = computeWeatherRestLandingPoint({
      actualKwh: 31.4,
      baselineKwh: 31.6,
      expectedKwhSoFar: 30,
      remainingWeatherKwh: 6,
      correctionFactor: 1.1,
      localHour: 18,
      previousAdjustedKwh: 35,
    });
    assert.ok(result >= 31.4);
    assert.ok(result <= 33.0, `no +6 kWh overshoot near end, got ${result}`);
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

  it('clamps f to 0.60–1.08', () => {
    assert.ok(computeInstantCorrectionFactor(20, 10) <= 1.08);
    assert.ok(computeInstantCorrectionFactor(5, 12) >= 0.60);
    assert.ok(computeInstantCorrectionFactor(5, 12) < 0.85, 'behind model may go below old 0.85 floor');
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
    assert.ok(e >= 0.60 && e <= 1.08);
  });

  it('pace residual is below optimistic weather mid-afternoon', () => {
    // Insights 02.08. ~16:00: rate ~3.5 kWh/h, ~4 h left → pace rest ~5, not 12
    const pace = estimatePaceRemainingKwh({
      recentRateKwhPerHour: 3.5,
      hoursUntilProductionEnd: 4,
      localHour: 16,
    });
    assert.ok(pace < 6, `pace rest should be modest, got ${pace}`);
    assert.ok(pace > 3, `pace rest should not collapse, got ${pace}`);
    const capped = capRemainingByPace(12, pace, 16);
    assert.ok(capped < 12, `must cap weather residual, got ${capped}`);
    assert.ok(capped <= pace * 1.08 + 0.4);
  });

  it('mayExceedBaseline requires Ist at or above B', () => {
    assert.strictEqual(
      mayExceedBaseline({ actualKwh: 20, baselineKwh: 32, expectedKwhSoFar: 18 }),
      false,
    );
    assert.strictEqual(
      mayExceedBaseline({ actualKwh: 29, baselineKwh: 32, expectedKwhSoFar: 28 }),
      false,
    );
    assert.strictEqual(
      mayExceedBaseline({ actualKwh: 32.0, baselineKwh: 32, expectedKwhSoFar: 30 }),
      true,
    );
  });

  it('recentProductionRateKwhPerHour from history', () => {
    const now = Date.now();
    const rate = recentProductionRateKwhPerHour(
      [
        { ts: now - 2 * 3600 * 1000, kwh: 20 },
        { ts: now - 3600 * 1000, kwh: 24 },
        { ts: now, kwh: 28 },
      ],
      now,
    );
    assert.ok(rate != null && rate > 3.5 && rate < 4.5, `expected ~4 kWh/h, got ${rate}`);
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

  it('caps evening overshoot when actual near baseline (Insights 25.07. CSV)', () => {
    // Peak A was 37.7 vs B 31.6 / end Ist 32.9 — softCap used max() so B·1.2 never bound
    const result = blendAdjustedForecast({
      actualKwh: 31.4,
      baselineKwh: 31.6,
      expectedKwhSoFar: 30,
      correctionFactor: 1.08,
      remainingWeatherKwh: 6,
      previousAdjustedKwh: 36,
      localHour: 18,
      reanticipate: 'above',
      hoursUntilProductionEnd: 1.5,
    });
    assert.ok(result >= 31.4);
    assert.ok(result <= 33.5, `evening A must not sit +6 over B, got ${result}`);
  });

  it('does not bump A above B at 17h when Ist is still under B (Insights 14.08.)', () => {
    // 14.08.: A held 32 until 16h, then 17h jumped to 32.93 (Ist 29.05, B 32),
    // EOD Ist 30.90 — daily downward correction after a late lift.
    const result = blendAdjustedForecast({
      actualKwh: 29.05,
      baselineKwh: 32,
      expectedKwhSoFar: 28,
      correctionFactor: 1.04,
      remainingWeatherKwh: 5,
      previousAdjustedKwh: 32,
      localHour: 17,
      hoursUntilProductionEnd: 3.5,
      recentRateKwhPerHour: 2.5,
    });
    assert.ok(result >= 29.05);
    assert.ok(result <= 32.15, `must not lift over B before Ist reaches B, got ${result}`);
  });

  it('pace cap pulls mid-afternoon A down (Insights 02.08. pattern)', () => {
    // B=33.2, Ist=26.6 @16h, weather R still large (~10), rate ~3.5 kWh/h, ~4h left
    // Old A climbed to 36.5; EOD Ist was 30.1 — must stay nearer 30–32
    const result = blendAdjustedForecast({
      actualKwh: 26.6,
      baselineKwh: 33.2,
      expectedKwhSoFar: 28,
      correctionFactor: 0.95,
      remainingWeatherKwh: 10,
      previousAdjustedKwh: 34.6,
      localHour: 16,
      hoursUntilProductionEnd: 4,
      recentRateKwhPerHour: 3.5,
      reanticipate: 'below',
    });
    assert.ok(result >= 26.6);
    assert.ok(result <= 33.3, `must not climb above B with weak pace, got ${result}`);
    assert.ok(result <= 32.0, `pace should keep A near realistic EOD, got ${result}`);
  });
});

describe('adjustedSoftCap', () => {
  it('uses min of ceilings not max', () => {
    const cap = adjustedSoftCap({
      actualKwh: 31.4,
      baselineKwh: 31.6,
      remainingWeatherKwh: 6,
      allowAboveBaseline: true,
      localHour: 18,
    });
    // residual room 1.2 at hour>=18 → ~32.8, not 37.7
    assert.ok(cap <= 33.0, `got ${cap}`);
    assert.ok(cap >= 31.4);
  });

  it('still allows mid-day lift under baseline when ahead of model', () => {
    const cap = adjustedSoftCap({
      actualKwh: 24,
      baselineKwh: 32,
      remainingWeatherKwh: 12,
      allowAboveBaseline: true,
      localHour: 15,
    });
    assert.ok(cap > 32, `got ${cap}`);
    assert.ok(cap <= 32 * 1.05 + 0.05, `ahead cap +5%, got ${cap}`);
  });

  it('collapses residual within evening flatten of production end', () => {
    const cap = adjustedSoftCap({
      actualKwh: 31.4,
      baselineKwh: 31.6,
      remainingWeatherKwh: 6,
      allowAboveBaseline: true,
      localHour: 19,
      hoursUntilProductionEnd: 0.5,
    });
    assert.ok(cap <= 32.0, `flat evening softCap, got ${cap}`);
  });
});

describe('eveningResidualTaper (parabola flattens before production end)', () => {
  it('is full until flatten window starts', () => {
    assert.strictEqual(eveningResidualTaper(EVENING_FLATTEN_HOURS), 1);
    assert.strictEqual(eveningResidualTaper(EVENING_FLATTEN_HOURS + 0.5), 1);
    assert.strictEqual(eveningResidualTaper(undefined), 1);
  });

  it('is parabolic inside the window', () => {
    // EVENING_FLATTEN_HOURS = 2.5 → taper(h) = (h/2.5)²
    const half = EVENING_FLATTEN_HOURS / 2;
    assert.ok(Math.abs(eveningResidualTaper(half) - 0.25) < 1e-9);
    assert.ok(Math.abs(eveningResidualTaper(EVENING_FLATTEN_HOURS * 0.2) - 0.04) < 1e-9);
    assert.strictEqual(eveningResidualTaper(0), 0);
    assert.strictEqual(eveningResidualTaper(-1), 0);
  });

  it('scales remaining weather', () => {
    const half = EVENING_FLATTEN_HOURS / 2;
    assert.strictEqual(effectiveRemainingWeatherKwh(8, half), 2);
    assert.strictEqual(effectiveRemainingWeatherKwh(8, 0), 0);
  });

  it('blend does not re-anticipate up when end is within 1 h', () => {
    const result = blendAdjustedForecast({
      actualKwh: 31.5,
      baselineKwh: 31.6,
      expectedKwhSoFar: 30,
      correctionFactor: 1.1,
      remainingWeatherKwh: 6,
      previousAdjustedKwh: 34,
      localHour: 20,
      hoursUntilProductionEnd: 0.8,
      reanticipate: 'above',
    });
    assert.ok(result <= 32.5, `must glue near actual near sunset, got ${result}`);
    assert.ok(result >= 31.5);
  });

  it('shouldReanticipate pulls down when taper nearly zero and A high', () => {
    const reason = shouldReanticipateAdjusted({
      actualKwh: 32,
      previousAdjustedKwh: 36,
      remainingWeatherKwh: 5,
      hoursUntilProductionEnd: 0.2,
    });
    assert.strictEqual(reason, 'below');
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
