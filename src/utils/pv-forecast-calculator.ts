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
/** Ahead of schedule: allow only tiny lift over effective baseline. */
const AHEAD_BASELINE_CAP = 1.05;
/** Max step up per hourly recompute (~1 % or 0.3 kWh). */
const MAX_UP_FRAC = 0.01;
const MAX_UP_ABS_KWH = 0.3;

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
 * Kern der Nachberechnung:
 *   A = E_ist + R_Wetter · f
 * Caps: A ≤ baseline (effektiv), Ahead nur +5 %; abends stark an Ist anbinden.
 */
export function computeWeatherRestLandingPoint(input: {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar: number;
  remainingWeatherKwh: number;
  correctionFactor?: number;
  localHour?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const expected = Math.max(0, input.expectedKwhSoFar);
  const remaining = Math.max(0, input.remainingWeatherKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const hour = input.localHour ?? 12;

  let f = 1;
  if (typeof input.correctionFactor === 'number' && Number.isFinite(input.correctionFactor)) {
    f = input.correctionFactor;
  } else {
    f = computeInstantCorrectionFactor(actual, expected);
  }
  f = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, f));

  let A = actual + remaining * f;
  A = Math.max(A, actual);

  const ahead = expected >= MIN_EXPECTED_KWH_FOR_CORRECTION && actual > expected * 1.05;
  if (baseline > 0) {
    if (!ahead) {
      // Default: never above effective baseline
      A = Math.min(A, Math.max(baseline, actual));
    } else {
      A = Math.min(A, Math.max(actual, baseline * AHEAD_BASELINE_CAP));
    }
  }

  // Evening: collapse toward actual + tiny residual
  if (hour >= 16) {
    const eveningCap = actual + Math.min(remaining * f, Math.max(1.0, baseline * 0.05));
    A = Math.min(A, Math.max(actual, eveningCap));
  }
  if (hour >= 19) {
    A = Math.min(A, actual + Math.max(0.3, Math.min(1.0, remaining * 0.3)));
  }

  A = Math.max(A, actual);
  return roundKwh(A);
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
  /** Previous EMA of f (returned usage: pass smoothed into correctionFactor). */
  previousCorrectionEma?: number;
}

/**
 * Nachberechnete Tagesprognose:
 *   A = E_ist + R_Wetter · f_smooth
 * mit Hard-Cap an Baseline und strengen Aufwärts-Schritten.
 */
export function blendAdjustedForecast(input: AdjustedForecastBlendInput): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const expectedSoFar = Math.max(0, input.expectedKwhSoFar);
  const remainingWeather =
    typeof input.remainingWeatherKwh === 'number' && Number.isFinite(input.remainingWeatherKwh)
      ? Math.max(0, input.remainingWeatherKwh)
      : Math.max(0, baseline - expectedSoFar);

  const instantF = computeInstantCorrectionFactor(actual, expectedSoFar);
  const fSmooth = smoothCorrectionFactor(instantF, input.previousCorrectionEma ?? input.correctionFactor);

  const target = computeWeatherRestLandingPoint({
    actualKwh: actual,
    baselineKwh: baseline,
    expectedKwhSoFar: expectedSoFar,
    remainingWeatherKwh: remainingWeather,
    correctionFactor: fSmooth,
    localHour: input.localHour,
  });

  let result = target;

  // Early afternoon + little actual: soft anchor at baseline (no crash under B)
  const t = Math.max(0, Math.min(1, (input.localHour - 12) / 7));
  if (t < 0.3 && baseline > 0 && actual < baseline * 0.45) {
    const anchor =
      input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0
        ? Math.min(input.previousAdjustedKwh, baseline)
        : baseline;
    result = Math.max(actual, anchor * (1 - t) + target * t);
  }

  result = Math.max(result, actual);

  // Strict step limits (Insights stair-step prevention)
  if (input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0) {
    const prev = input.previousAdjustedKwh;
    const maxUp = Math.max(MAX_UP_ABS_KWH, prev * MAX_UP_FRAC);
    // Down: free enough to leave overshoot quickly
    const maxDown = prev > baseline + 0.3
      ? Math.max(3.0, prev * 0.15)
      : Math.max(1.5, prev * 0.08);
    result = Math.max(prev - maxDown, Math.min(prev + maxUp, result));
    result = Math.max(result, actual);
  }

  // Hard caps after smoothing — never above effective baseline unless slightly ahead
  const ahead = expectedSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actual > expectedSoFar * 1.05;
  if (baseline > 0) {
    if (!ahead) {
      result = Math.min(result, Math.max(baseline, actual));
    } else {
      result = Math.min(result, Math.max(actual, baseline * AHEAD_BASELINE_CAP));
    }
  }

  // Stay near weather target
  if (!(t < 0.3 && actual < baseline * 0.45)) {
    result = Math.min(result, Math.max(target, actual) + 0.2);
  }

  // Evening hard bind
  if (input.localHour >= 16) {
    result = Math.min(result, Math.max(actual, target));
  }
  if (input.localHour >= 19) {
    result = Math.min(result, actual + 0.8);
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
