import {HourlyIrradiance} from '../services/open-meteo-forecast';

const DEFAULT_PERFORMANCE_RATIO = 0.85;
/** Instant f clamp before EMA (from analysis: morning explosions). */
const CORRECTION_MIN = 0.85;
const CORRECTION_MAX = 1.10;
const MIN_EXPECTED_KWH_FOR_CORRECTION = 3.0;
/** Need enough model energy before trusting actual/expected. */
const MIN_ACTUAL_KWH_FOR_CORRECTION = 1.0;

/**
 * Default scale applied to morning-frozen weather baseline.
 * Insights 31d: median B/E ≈ 1.22 → scale ≈ 0.82–0.85.
 * Overridden by learned dayScale when available.
 */
export const DEFAULT_BASELINE_DAY_SCALE = 0.85;
export const DAY_SCALE_MIN = 0.6;
export const DAY_SCALE_MAX = 1.1;
export const DAY_SCALE_EMA_ALPHA = 0.25;
/**
 * When clearly ahead of weather model / previous A, allow lift over baseline.
 * Insights 25.07.: A hit 37.7 while B≈31.6 / end Ist≈32.9 — 1.20 was too loose
 * and softCap used max(B·cap, Ist+R·f) which is not a real ceiling.
 */
const AHEAD_BASELINE_CAP = 1.10;
/** Max step up per normal hourly recompute. */
const MAX_UP_FRAC = 0.03;
const MAX_UP_ABS_KWH = 0.8;
/** Larger step when production overtook the forecast line (re-anticipate up). */
const MAX_UP_FRAC_REANTICIPATE = 0.12;
const MAX_UP_ABS_REANTICIPATE = 3.0;
/** Larger step down when remaining weather cannot catch previous A. */
const MAX_DOWN_FRAC_UNCATCHABLE = 0.25;
const MAX_DOWN_ABS_UNCATCHABLE = 5.0;

/**
 * Hours before production end (sunset / last GTI) during which residual is tapered.
 * Production parabola flattens — no significant yield change expected in this window.
 */
export const EVENING_FLATTEN_HOURS = 2;

/**
 * Scale factor for remaining weather energy as the daily curve flattens.
 * Full credit until 2 h before end; then (h/2)² → 0 at end (parabolic taper).
 */
export function eveningResidualTaper(hoursUntilEnd: number | undefined): number {
  if (hoursUntilEnd == null || !Number.isFinite(hoursUntilEnd)) {
    return 1;
  }
  if (hoursUntilEnd >= EVENING_FLATTEN_HOURS) {
    return 1;
  }
  if (hoursUntilEnd <= 0) {
    return 0;
  }
  const x = hoursUntilEnd / EVENING_FLATTEN_HOURS;
  return x * x;
}

/** Weather rest after evening parabola taper. */
export function effectiveRemainingWeatherKwh(
  remainingWeatherKwh: number,
  hoursUntilProductionEnd?: number,
): number {
  return Math.max(0, remainingWeatherKwh) * eveningResidualTaper(hoursUntilProductionEnd);
}

/**
 * Upper bound for adjusted forecast A when allowed above baseline.
 * - Real ceiling: min(B·cap, Ist + R·f_max) — never the max of both.
 * - Near/past baseline: weather-rest is often overstated → only small residual room.
 * - Within 2 h of production end: residual room collapses with evening taper.
 */
export function adjustedSoftCap(input: {
  actualKwh: number;
  baselineKwh: number;
  remainingWeatherKwh: number;
  allowAboveBaseline: boolean;
  localHour?: number;
  hoursUntilProductionEnd?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const remaining = Math.max(0, input.remainingWeatherKwh);
  const hour = input.localHour ?? 12;
  const taper = eveningResidualTaper(input.hoursUntilProductionEnd);
  const weatherOpt = actual + remaining * CORRECTION_MAX * taper;

  if (!input.allowAboveBaseline || baseline <= 0) {
    return Math.max(baseline, actual);
  }

  // Near or past display baseline: R is often still large while day is almost done
  if (actual >= baseline * 0.92) {
    let residualRoom = hour >= 18 ? 1.2 : hour >= 16 ? 2.0 : hour >= 14 ? 3.0 : 4.0;
    residualRoom *= Math.max(taper, 0.05); // keep tiny room until fully flat
    if (taper <= 0) {
      residualRoom = 0.2;
    }
    return Math.min(weatherOpt, Math.max(actual, baseline) + residualRoom);
  }

  // Mid-day ahead of model but still clearly under baseline
  return Math.min(Math.max(baseline * AHEAD_BASELINE_CAP, actual), weatherOpt);
}

export interface PvForecastInputs {
  hours: HourlyIrradiance[];
  installedKwp: number;
  calibrationFactor: number;
  performanceRatio?: number;
  nowMs?: number;
  actualKwhSoFar?: number;
}

export interface PvForecastResult {
  baselineKwh: number;
  adjustedKwh: number;
  expectedKwhSoFar: number;
  /** Wetter-Restenergie ab „jetzt“ (kWh), gleiche Formel wie Baseline. */
  remainingWeatherKwh: number;
  correctionFactor: number;
}

function performanceRatio(value?: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1) {
    return value;
  }
  return DEFAULT_PERFORMANCE_RATIO;
}

function hourTimestampMs(isoLocalHour: string): number {
  return new Date(isoLocalHour).getTime();
}

export function irradianceHourToKwh(
  irradianceWm2: number,
  installedKwp: number,
  calibrationFactor: number,
  pr = DEFAULT_PERFORMANCE_RATIO,
): number {
  const safeKwp = Math.max(0, installedKwp);
  const safeCal = Math.max(0.1, Math.min(2, calibrationFactor));
  return (Math.max(0, irradianceWm2) / 1000) * safeKwp * safeCal * pr;
}

export function sumIrradianceKwh(
  hours: HourlyIrradiance[],
  installedKwp: number,
  calibrationFactor: number,
  pr = DEFAULT_PERFORMANCE_RATIO,
): number {
  return hours.reduce(
    (sum, hour) => sum + irradianceHourToKwh(hour.globalTiltedIrradianceWm2, installedKwp, calibrationFactor, pr),
    0,
  );
}

function filterHoursUpTo(hours: HourlyIrradiance[], endMs: number): HourlyIrradiance[] {
  return hours.filter(hour => hourTimestampMs(hour.time) <= endMs);
}

function filterHoursAfter(hours: HourlyIrradiance[], startMs: number): HourlyIrradiance[] {
  return hours.filter(hour => hourTimestampMs(hour.time) > startMs);
}

export interface PvForecastSegmentInput {
  hours: HourlyIrradiance[];
  installedKwp: number;
}

export function calculateMultiSegmentPvForecast(
  segments: PvForecastSegmentInput[],
  calibrationFactor: number,
  performanceRatio: number | undefined,
  nowMs: number,
  actualKwhSoFar: number,
): PvForecastResult {
  let baselineKwh = 0;
  let expectedKwhSoFar = 0;
  let remainingWeatherKwh = 0;

  for (const segment of segments) {
    const partial = calculatePvForecast({
      hours: segment.hours,
      installedKwp: segment.installedKwp,
      calibrationFactor,
      performanceRatio,
      nowMs,
      actualKwhSoFar: 0,
    });
    baselineKwh += partial.baselineKwh;
    expectedKwhSoFar += partial.expectedKwhSoFar;
    remainingWeatherKwh += partial.remainingWeatherKwh;
  }

  const actualKwh = Math.max(0, actualKwhSoFar);
  const correctionFactor = computeInstantCorrectionFactor(actualKwh, expectedKwhSoFar);

  const adjustedKwhValue = computeWeatherRestLandingPoint({
    actualKwh,
    baselineKwh,
    expectedKwhSoFar,
    remainingWeatherKwh,
    correctionFactor,
  });

  return {
    baselineKwh: roundKwh(baselineKwh),
    adjustedKwh: roundKwh(adjustedKwhValue),
    expectedKwhSoFar: roundKwh(expectedKwhSoFar),
    remainingWeatherKwh: roundKwh(remainingWeatherKwh),
    correctionFactor: Math.round(correctionFactor * 1000) / 1000,
  };
}

export function calculatePvForecast(inputs: PvForecastInputs): PvForecastResult {
  const nowMs = inputs.nowMs ?? Date.now();
  const pr = performanceRatio(inputs.performanceRatio);
  const baselineKwh = sumIrradianceKwh(inputs.hours, inputs.installedKwp, inputs.calibrationFactor, pr);
  const elapsedHours = filterHoursUpTo(inputs.hours, nowMs);
  const remainingHours = filterHoursAfter(inputs.hours, nowMs);
  const expectedKwhSoFar = sumIrradianceKwh(elapsedHours, inputs.installedKwp, inputs.calibrationFactor, pr);
  const remainingWeatherKwh = sumIrradianceKwh(remainingHours, inputs.installedKwp, inputs.calibrationFactor, pr);
  const actualKwh = Math.max(0, inputs.actualKwhSoFar ?? 0);

  const correctionFactor = computeInstantCorrectionFactor(actualKwh, expectedKwhSoFar);

  const adjustedKwhValue = computeWeatherRestLandingPoint({
    actualKwh,
    baselineKwh,
    expectedKwhSoFar,
    remainingWeatherKwh,
    correctionFactor,
  });

  return {
    baselineKwh: roundKwh(baselineKwh),
    adjustedKwh: roundKwh(adjustedKwhValue),
    expectedKwhSoFar: roundKwh(expectedKwhSoFar),
    remainingWeatherKwh: roundKwh(remainingWeatherKwh),
    correctionFactor: Math.round(correctionFactor * 1000) / 1000,
  };
}

/** Instant f = actual/expected with tight clamps; 1 if not enough data. */
export function computeInstantCorrectionFactor(actualKwh: number, expectedKwhSoFar: number): number {
  const actual = Math.max(0, actualKwh);
  const expected = Math.max(0, expectedKwhSoFar);
  if (expected < MIN_EXPECTED_KWH_FOR_CORRECTION || actual < MIN_ACTUAL_KWH_FOR_CORRECTION) {
    return 1;
  }
  return Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, actual / expected));
}

/** EMA of correction factor (α default 0.25). */
export function smoothCorrectionFactor(
  instantF: number,
  previousEma: number | undefined,
  alpha = DAY_SCALE_EMA_ALPHA,
): number {
  const f = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, instantF));
  if (previousEma == null || !Number.isFinite(previousEma)) {
    return f;
  }
  const a = Math.max(0.05, Math.min(0.6, alpha));
  const smoothed = a * f + (1 - a) * previousEma;
  return Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, smoothed));
}

/** Effective (display) baseline = morning-frozen weather baseline × day scale. */
export function applyBaselineDayScale(rawBaselineKwh: number, dayScale?: number): number {
  const scale =
    typeof dayScale === 'number' && Number.isFinite(dayScale)
      ? Math.max(DAY_SCALE_MIN, Math.min(DAY_SCALE_MAX, dayScale))
      : DEFAULT_BASELINE_DAY_SCALE;
  return roundKwh(Math.max(0, rawBaselineKwh) * scale);
}

/**
 * Update learned day scale from end-of-day ratio actual/baselineRaw.
 * Returns new EMA scale for the next day.
 */
export function updateDayScaleFromOutcome(
  previousScale: number | undefined,
  baselineRawKwh: number,
  actualDayKwh: number,
  alpha = DAY_SCALE_EMA_ALPHA,
): number {
  const prev =
    typeof previousScale === 'number' && Number.isFinite(previousScale)
      ? Math.max(DAY_SCALE_MIN, Math.min(DAY_SCALE_MAX, previousScale))
      : DEFAULT_BASELINE_DAY_SCALE;
  if (baselineRawKwh < 5 || actualDayKwh < 3) {
    return prev;
  }
  const ratio = actualDayKwh / baselineRawKwh;
  const sample = Math.max(DAY_SCALE_MIN, Math.min(DAY_SCALE_MAX, ratio));
  const a = Math.max(0.05, Math.min(0.5, alpha));
  return Math.round((a * sample + (1 - a) * prev) * 1000) / 1000;
}

/**
 * Monotone cumulative production: never decrease within a day.
 * Protects history / Insights against summary glitches.
 */
export function monotoneActualKwh(previous: number | undefined, raw: number): number {
  const r = Math.max(0, raw);
  if (previous == null || !Number.isFinite(previous)) {
    return roundKwh(r);
  }
  return roundKwh(Math.max(previous, r));
}

/**
 * Kern der Nachberechnung (Antizipation Tagesende):
 *   A = E_ist + R_eff · f
 *   R_eff = R_Wetter · eveningTaper (ab 2 h vor Produktionsende → 0)
 *
 * - Hinter dem Wettermodell: A ≤ Baseline (kein Hochrechnen ins Blaue)
 * - Voraus / Ist überholt A_prev: A darf über Baseline steigen (Rest · f bleibt drin)
 * - Ab 2 h vor Sonnenuntergang/Produktionsende: Parabel flacht ab → kaum noch Rest
 */
export function computeWeatherRestLandingPoint(input: {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar: number;
  remainingWeatherKwh: number;
  correctionFactor?: number;
  localHour?: number;
  /** Hours until last meaningful PV production (sunset / GTI end). */
  hoursUntilProductionEnd?: number;
  /** Previous displayed A — used to detect overtake. */
  previousAdjustedKwh?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const expected = Math.max(0, input.expectedKwhSoFar);
  const remainingRaw = Math.max(0, input.remainingWeatherKwh);
  const remaining = effectiveRemainingWeatherKwh(remainingRaw, input.hoursUntilProductionEnd);
  const taper = eveningResidualTaper(input.hoursUntilProductionEnd);
  const baseline = Math.max(0, input.baselineKwh);
  const hour = input.localHour ?? 12;
  const prev =
    typeof input.previousAdjustedKwh === 'number' && Number.isFinite(input.previousAdjustedKwh)
      ? Math.max(0, input.previousAdjustedKwh)
      : undefined;

  let f = 1;
  if (typeof input.correctionFactor === 'number' && Number.isFinite(input.correctionFactor)) {
    f = input.correctionFactor;
  } else {
    f = computeInstantCorrectionFactor(actual, expected);
  }
  f = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, f));

  // Pure anticipation: today's actual + tapered weather rest · performance so far
  let A = actual + remaining * f;
  A = Math.max(A, actual);

  const aheadOfModel =
    expected >= MIN_EXPECTED_KWH_FOR_CORRECTION && actual > expected * 1.05;
  const overtookPrevious = prev != null && actual + 0.05 >= prev && remaining > 0.2;
  const overBaseline = baseline > 0 && actual >= baseline * 0.98;
  const allowAbove = aheadOfModel || overtookPrevious || overBaseline;

  if (baseline > 0) {
    A = Math.min(
      A,
      adjustedSoftCap({
        actualKwh: actual,
        baselineKwh: baseline,
        remainingWeatherKwh: remainingRaw,
        allowAboveBaseline: allowAbove,
        localHour: hour,
        hoursUntilProductionEnd: input.hoursUntilProductionEnd,
      }),
    );
  }

  // Production parabola flat (≤2 h to end): glue near actual
  if (taper <= 0.25 || remaining < 0.35) {
    A = Math.min(A, actual + Math.max(0.2, Math.min(0.8, remaining * f)));
  } else if (hour >= 19 || remaining < 0.5) {
    A = Math.min(A, actual + Math.max(0.3, Math.min(1.2, remaining * f)));
  } else if (hour >= 18) {
    A = Math.min(A, actual + Math.max(0.5, Math.min(2.0, remaining * f)));
  } else if (hour >= 17 && remaining < 2) {
    A = Math.min(A, actual + Math.max(remaining * f, Math.min(2.5, remaining * CORRECTION_MAX)));
  }

  A = Math.max(A, actual);
  return roundKwh(A);
}

export type ReanticipateReason = 'none' | 'above' | 'below';

/**
 * Whether to force a new end-of-day projection before the next hourly tick.
 * - above: production reached/overtook A → re-anticipate higher (keep residual)
 * - below: even optimistic rest cannot reach previous A → re-anticipate lower
 */
export function shouldReanticipateAdjusted(input: {
  actualKwh: number;
  previousAdjustedKwh: number;
  remainingWeatherKwh: number;
  hoursUntilProductionEnd?: number;
}): ReanticipateReason {
  const actual = Math.max(0, input.actualKwh);
  const prev = Math.max(0, input.previousAdjustedKwh);
  const rem = effectiveRemainingWeatherKwh(
    input.remainingWeatherKwh,
    input.hoursUntilProductionEnd,
  );

  if (prev <= 0) {
    return 'none';
  }

  // Flat evening: no upward re-anticipation (curve already finished)
  const taper = eveningResidualTaper(input.hoursUntilProductionEnd);
  if (taper <= 0.15) {
    if (prev > actual + 0.3) {
      return 'below'; // pull A down toward actual
    }
    return 'none';
  }

  // Overtake forecast line with meaningful rest → project new higher end
  if (actual + 0.05 >= prev && rem > 0.3) {
    return 'above';
  }

  // Uncatchable: optimistic remaining cannot reach previous A
  const optimisticEnd = actual + rem * CORRECTION_MAX;
  if (prev > actual + 0.8 && optimisticEnd < prev - 0.5) {
    return 'below';
  }

  return 'none';
}

export function roundKwh(value: number): number {
  return Math.round(value * 10) / 10;
}

export function localDateString(timezone: string, nowMs = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(nowMs));
}

/** Lokale Stunde (0-23) für die 12-Uhr-Regel */
export function getLocalHour(timezone: string, nowMs = Date.now()): number {
  return parseInt(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    }).format(new Date(nowMs)),
    10
  );
}

/** Geschätztes Ende der PV-Produktion anhand der Forecast-Stunden */
export function estimateProductionEndMs(hours: HourlyIrradiance[], nowMs: number): number {
  if (!hours || hours.length === 0) {
    return nowMs + 4 * 3600 * 1000;
  }
  for (let i = hours.length - 1; i >= 0; i--) {
    if ((hours[i].globalTiltedIrradianceWm2 || 0) > 15) {
      const candidate = hourTimestampMs(hours[i].time) + 30 * 60 * 1000;
      return Math.min(candidate, nowMs + 5 * 3600 * 1000);
    }
  }
  return Math.min(nowMs + 3.5 * 3600 * 1000, nowMs + 5 * 3600 * 1000);
}

/**
 * Legacy curve landing (not used as driver). Kept for tests / diagnostics.
 */
export function estimateDailyProductionLandingPoint(
  history: Array<{ ts: number; kwh: number }>,
  nowMs: number,
  estimatedEndMs: number
): number {
  if (!history || history.length < 2) {
    return history?.[history.length - 1]?.kwh ?? 0;
  }

  const sorted = [...history]
    .sort((a, b) => a.ts - b.ts)
    .filter(p => p.kwh >= 0);

  const recentWindowStart = nowMs - 2 * 3600 * 1000;
  let points = sorted.filter(p => p.ts >= recentWindowStart);

  if (points.length < 2) {
    points = sorted.slice(-8);
  }
  if (points.length < 2) {
    return sorted[sorted.length - 1].kwh;
  }

  const first = points[0];
  const last = points[points.length - 1];
  const deltaHours = (last.ts - first.ts) / 3600000;

  if (deltaHours < 0.15) {
    return last.kwh;
  }

  const ratePerHour = Math.max(0, (last.kwh - first.kwh) / deltaHours);
  const rawRemaining = (estimatedEndMs - nowMs) / 3600000;
  const remainingHours = Math.max(0.15, Math.min(2.5, rawRemaining));
  const taper = 0.4 + 0.45 * Math.min(1, 1.0 / Math.max(remainingHours, 0.3));
  let final = last.kwh + ratePerHour * remainingHours * taper;
  final = Math.max(last.kwh, final);

  return roundKwh(final);
}

export interface AdjustedForecastBlendInput {
  actualKwh: number;
  /** Effective (scaled, frozen) baseline. */
  baselineKwh: number;
  expectedKwhSoFar: number;
  correctionFactor: number;
  remainingWeatherKwh?: number;
  /** @deprecated ignored as driver */
  curveEstimate?: number;
  previousAdjustedKwh?: number;
  localHour: number;
  /**
   * Hours until last meaningful PV (from irradiance series / sunset).
   * Within last 2 h residual is tapered (parabola flattens).
   */
  hoursUntilProductionEnd?: number;
  /** Previous EMA of f (returned usage: pass smoothed into correctionFactor). */
  previousCorrectionEma?: number;
  /**
   * Force re-anticipation: larger step limits.
   * - above: production overtook A
   * - below: uncatchable under A
   */
  reanticipate?: ReanticipateReason;
}

/**
 * Nachberechnete Tagesprognose — antizipiert Tagesende:
 *   A = E_ist + R_eff · f_smooth
 *   R_eff = R · eveningTaper (2 h vor Ende → 0)
 * Re-Antizipation wenn Ist die Linie überholt oder uneinholbar darunter bleibt.
 */
export function blendAdjustedForecast(input: AdjustedForecastBlendInput): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const expectedSoFar = Math.max(0, input.expectedKwhSoFar);
  const remainingRaw =
    typeof input.remainingWeatherKwh === 'number' && Number.isFinite(input.remainingWeatherKwh)
      ? Math.max(0, input.remainingWeatherKwh)
      : Math.max(0, baseline - expectedSoFar);
  const remainingWeather = effectiveRemainingWeatherKwh(
    remainingRaw,
    input.hoursUntilProductionEnd,
  );
  const taper = eveningResidualTaper(input.hoursUntilProductionEnd);
  const reanticipate = input.reanticipate ?? 'none';

  const instantF = computeInstantCorrectionFactor(actual, expectedSoFar);
  // When overtaking A, weight instant f more so residual scales up quickly
  const fSmooth =
    reanticipate === 'above'
      ? smoothCorrectionFactor(instantF, input.previousCorrectionEma ?? input.correctionFactor, 0.45)
      : smoothCorrectionFactor(instantF, input.previousCorrectionEma ?? input.correctionFactor);

  const target = computeWeatherRestLandingPoint({
    actualKwh: actual,
    baselineKwh: baseline,
    expectedKwhSoFar: expectedSoFar,
    remainingWeatherKwh: remainingRaw,
    correctionFactor: fSmooth,
    localHour: input.localHour,
    hoursUntilProductionEnd: input.hoursUntilProductionEnd,
    previousAdjustedKwh: input.previousAdjustedKwh,
  });

  let result = target;

  // Early afternoon + little actual: soft anchor at baseline (no crash under B)
  const t = Math.max(0, Math.min(1, (input.localHour - 12) / 7));
  if (t < 0.3 && baseline > 0 && actual < baseline * 0.45 && reanticipate === 'none') {
    const anchor =
      input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0
        ? Math.min(input.previousAdjustedKwh, baseline)
        : baseline;
    result = Math.max(actual, anchor * (1 - t) + target * t);
  }

  result = Math.max(result, actual);

  // Step limits — looser when re-anticipating (above/below); no up-steps in flat evening
  if (input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0) {
    const prev = input.previousAdjustedKwh;
    let maxUp = Math.max(MAX_UP_ABS_KWH, prev * MAX_UP_FRAC);
    let maxDown =
      prev > baseline + 0.3
        ? Math.max(3.0, prev * 0.15)
        : Math.max(1.5, prev * 0.08);

    if (taper <= 0.25) {
      maxUp = 0.15; // parabola flat — no significant upward moves
      maxDown = Math.max(maxDown, 2.0);
    } else if (reanticipate === 'above') {
      maxUp = Math.max(MAX_UP_ABS_REANTICIPATE, prev * MAX_UP_FRAC_REANTICIPATE, remainingWeather * 0.5);
    } else if (reanticipate === 'below') {
      maxDown = Math.max(MAX_DOWN_ABS_UNCATCHABLE, prev * MAX_DOWN_FRAC_UNCATCHABLE);
    }

    result = Math.max(prev - maxDown, Math.min(prev + maxUp, result));
    result = Math.max(result, actual);
  }

  // Caps: behind → ≤ baseline; ahead/overtake → real soft ceiling (min, not max)
  const ahead =
    expectedSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actual > expectedSoFar * 1.05;
  const overtook =
    input.previousAdjustedKwh != null && actual + 0.05 >= input.previousAdjustedKwh;
  const allowAbove =
    ahead || overtook || reanticipate === 'above' || actual >= baseline * 0.98;
  if (baseline > 0) {
    result = Math.min(
      result,
      adjustedSoftCap({
        actualKwh: actual,
        baselineKwh: baseline,
        remainingWeatherKwh: remainingRaw,
        allowAboveBaseline: allowAbove,
        localHour: input.localHour,
        hoursUntilProductionEnd: input.hoursUntilProductionEnd,
      }),
    );
  }

  // Keep near weather target (allow residual above actual)
  if (!(t < 0.3 && actual < baseline * 0.45 && reanticipate === 'none')) {
    const slack = reanticipate === 'above' && taper > 0.25 ? 1.5 : 0.5;
    result = Math.min(result, Math.max(target, actual) + slack * Math.max(taper, 0.1));
  }

  // Late collapse — evening taper or clock hour
  if (taper <= 0.25 || remainingWeather < 0.35) {
    result = Math.min(result, actual + Math.max(0.2, Math.min(0.8, remainingWeather)));
  } else if (input.localHour >= 19 || remainingWeather < 0.5) {
    result = Math.min(result, actual + Math.max(0.3, Math.min(1.2, remainingWeather)));
  } else if (input.localHour >= 18) {
    result = Math.min(result, actual + Math.max(0.5, Math.min(2.0, remainingWeather)));
  }

  result = Math.max(result, actual);
  return roundKwh(result);
}

/** Expose smoothed f for day-state persistence. */
export function nextCorrectionEma(
  actualKwh: number,
  expectedKwhSoFar: number,
  previousEma: number | undefined,
): number {
  return smoothCorrectionFactor(
    computeInstantCorrectionFactor(actualKwh, expectedKwhSoFar),
    previousEma,
  );
}
