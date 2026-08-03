import {HourlyIrradiance} from '../services/open-meteo-forecast';

const DEFAULT_PERFORMANCE_RATIO = 0.85;
/**
 * Instant f clamp before EMA.
 * Insights 27.07–03.08: Wetter-Rest oft zu optimistisch → f darf **stärker nach unten**
 * (0,60) und nur leicht über 1 (1,08), sonst klettert A mittags über den Tages-Ist.
 */
const CORRECTION_MIN = 0.60;
const CORRECTION_MAX = 1.08;
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
export const DAY_SCALE_EMA_ALPHA = 0.30;
/**
 * When clearly ahead of weather model / previous A, allow lift over baseline.
 * Insights 02.08.: A→36,5 bei EOD-Ist 30,1 — +10 % war noch zu locker.
 */
const AHEAD_BASELINE_CAP = 1.05;
/**
 * Only allow A above baseline once Ist is close (avoids mid-day climb from
 * temporary “ahead of model” while most of the day is still open).
 */
const ALLOW_ABOVE_BASELINE_FRAC = 0.88;
/** Max step up per normal hourly recompute. */
const MAX_UP_FRAC = 0.03;
const MAX_UP_ABS_KWH = 0.8;
/** Larger step when production overtook the forecast line (re-anticipate up). */
const MAX_UP_FRAC_REANTICIPATE = 0.12;
const MAX_UP_ABS_REANTICIPATE = 2.5;
/** Larger step down when remaining weather cannot catch previous A. */
const MAX_DOWN_FRAC_UNCATCHABLE = 0.30;
const MAX_DOWN_ABS_UNCATCHABLE = 6.0;

/**
 * Hours before production end (sunset / last GTI) during which residual is tapered.
 * Production parabola flattens — no significant yield change expected in this window.
 * Insights 7d: 2 h oft zu spät (A bleibt bis 17 Uhr zu hoch) → 2,5 h.
 */
export const EVENING_FLATTEN_HOURS = 2.5;

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
 * Recent production rate (kWh/h) from monotone history over the last ~2 h.
 * Returns undefined if not enough samples / window.
 */
export function recentProductionRateKwhPerHour(
  history: Array<{ ts: number; kwh: number }> | undefined,
  nowMs: number,
  windowMs = 2 * 3600 * 1000,
): number | undefined {
  if (!history || history.length < 2) {
    return undefined;
  }
  const sorted = [...history].filter(p => p.kwh >= 0).sort((a, b) => a.ts - b.ts);
  if (sorted.length < 2) {
    return undefined;
  }
  const last = sorted[sorted.length - 1];
  const windowStart = nowMs - windowMs;
  let first = sorted[0];
  for (const p of sorted) {
    if (p.ts >= windowStart) {
      first = p;
      break;
    }
    first = p;
  }
  // Prefer a point ~1–2 h back if available
  const targetTs = nowMs - Math.min(windowMs, 2 * 3600 * 1000);
  let best = first;
  for (const p of sorted) {
    if (p.ts <= targetTs) {
      best = p;
    }
  }
  if (last.ts - best.ts < 25 * 60 * 1000) {
    // fall back to oldest in window
    best = first;
  }
  const dtH = (last.ts - best.ts) / 3600000;
  if (dtH < 0.4) {
    return undefined;
  }
  const rate = (last.kwh - best.kwh) / dtH;
  if (!Number.isFinite(rate) || rate < 0) {
    return 0;
  }
  return rate;
}

/**
 * Remaining energy implied by recent production pace.
 * After solar noon the curve declines → integrate a linear fade to ~0 at production end
 * (triangle: avg rate ≈ 0.5·recent in the post-peak window; milder before peak).
 *
 * Insights 02.08. 16:00: Wetter-R noch ~10 kWh, Pace nur ~3–4 kWh Rest → A war 36 vs EOD 30.
 */
export function estimatePaceRemainingKwh(input: {
  recentRateKwhPerHour: number;
  hoursUntilProductionEnd: number;
  localHour: number;
}): number {
  const rate = Math.max(0, input.recentRateKwhPerHour);
  const h = Math.max(0, input.hoursUntilProductionEnd);
  if (h <= 0 || rate <= 0) {
    return 0;
  }
  const hour = input.localHour;
  // Pre-peak: rate may still rise — mild discount only
  // Post-peak (≥14): assume decline toward 0 at production end (triangle-ish)
  // Insights 02.08. 16:00 rate~3.5, 4h left, EOD rest only ~3.5 → shape ~0.25–0.35
  let shape: number;
  if (hour >= 17) {
    shape = 0.30;
  } else if (hour >= 16) {
    shape = 0.35;
  } else if (hour >= 15) {
    shape = 0.42;
  } else if (hour >= 14) {
    shape = 0.55;
  } else if (hour >= 13) {
    shape = 0.70;
  } else {
    shape = 0.90;
  }
  return Math.max(0, rate * h * shape);
}

/**
 * Cap weather residual by pace when pace is clearly lower (optimistic model).
 * When pace is higher, keep weather (don't invent energy from a short spike).
 */
export function capRemainingByPace(
  weatherRemainingKwh: number,
  paceRemainingKwh: number | undefined,
  localHour: number,
): number {
  const weather = Math.max(0, weatherRemainingKwh);
  if (paceRemainingKwh == null || !Number.isFinite(paceRemainingKwh) || localHour < 13) {
    return weather;
  }
  const pace = Math.max(0, paceRemainingKwh);
  // Small headroom for sun recovery; tighter after 15:00 (Insights 7d overshoot)
  const paceCap = pace * (localHour >= 15 ? 1.08 : 1.15) + 0.25;
  // Before 15:00 blend rather than hard min (weather still useful mid-day)
  if (localHour < 15) {
    const w = 0.65; // weight on pace cap
    return Math.min(weather, w * paceCap + (1 - w) * weather);
  }
  return Math.min(weather, paceCap);
}

/**
 * Upper bound for adjusted forecast A when allowed above baseline.
 * - Real ceiling: min(B·cap, Ist + R·f_max) — never the max of both.
 * - Near/past baseline: weather-rest is often overstated → only small residual room.
 * - Within evening flatten of production end: residual room collapses with taper.
 */
export function adjustedSoftCap(input: {
  actualKwh: number;
  baselineKwh: number;
  /** Raw weather remaining (taper applied inside unless remainingEffectiveKwh set). */
  remainingWeatherKwh: number;
  allowAboveBaseline: boolean;
  localHour?: number;
  hoursUntilProductionEnd?: number;
  /**
   * Optional already-effective residual (taper + pace). When set, used for weatherOpt
   * instead of raw×taper (avoids double taper / ignores overstated weather).
   */
  remainingEffectiveKwh?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const hour = input.localHour ?? 12;
  const taper = eveningResidualTaper(input.hoursUntilProductionEnd);
  const remainingEff =
    typeof input.remainingEffectiveKwh === 'number' && Number.isFinite(input.remainingEffectiveKwh)
      ? Math.max(0, input.remainingEffectiveKwh)
      : effectiveRemainingWeatherKwh(Math.max(0, input.remainingWeatherKwh), input.hoursUntilProductionEnd);
  const weatherOpt = actual + remainingEff * CORRECTION_MAX;

  if (!input.allowAboveBaseline || baseline <= 0) {
    return Math.max(baseline, actual);
  }

  // Near or past display baseline: R is often still large while day is almost done
  if (actual >= baseline * 0.92) {
    let residualRoom = hour >= 18 ? 0.8 : hour >= 16 ? 1.4 : hour >= 14 ? 2.2 : 3.0;
    residualRoom *= Math.max(taper, 0.05); // keep tiny room until fully flat
    if (taper <= 0) {
      residualRoom = 0.2;
    }
    return Math.min(weatherOpt, Math.max(actual, baseline) + residualRoom);
  }

  // Mid-day ahead of model but still clearly under baseline
  return Math.min(Math.max(baseline * AHEAD_BASELINE_CAP, actual), weatherOpt);
}

/** Whether A may exceed the display baseline (strict: Ist already near B). */
export function mayExceedBaseline(input: {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar?: number;
  previousAdjustedKwh?: number;
  reanticipate?: 'none' | 'above' | 'below';
}): boolean {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  if (baseline <= 0) {
    return true;
  }
  if (actual >= baseline * ALLOW_ABOVE_BASELINE_FRAC) {
    return true;
  }
  if (input.reanticipate === 'above' && actual >= baseline * 0.80) {
    return true;
  }
  // Overtake alone is not enough if still far below B (mid-day false ahead)
  const overtook =
    input.previousAdjustedKwh != null && actual + 0.05 >= input.previousAdjustedKwh;
  if (overtook && actual >= baseline * 0.80) {
    return true;
  }
  return false;
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
 *   R_eff = min(R_Wetter · eveningTaper, Pace-Rest) · f
 *
 * - Hinter dem Wettermodell: A ≤ Baseline (kein Hochrechnen ins Blaue)
 * - Über Baseline nur wenn Ist schon nahe B (nicht nur „ahead of model“)
 * - Ab eveningFlatten vor Produktionsende: Parabel flacht ab → kaum noch Rest
 * - Pace-Cap: wenn aktuelle Steigung den Wetter-Rest nicht trägt, A runter
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
  /** Recent production rate (kWh/h) for pace residual cap. */
  recentRateKwhPerHour?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const expected = Math.max(0, input.expectedKwhSoFar);
  const remainingRaw = Math.max(0, input.remainingWeatherKwh);
  const hour = input.localHour ?? 12;
  const hoursLeft = input.hoursUntilProductionEnd;
  let remaining = effectiveRemainingWeatherKwh(remainingRaw, hoursLeft);
  const taper = eveningResidualTaper(hoursLeft);
  const baseline = Math.max(0, input.baselineKwh);
  const prev =
    typeof input.previousAdjustedKwh === 'number' && Number.isFinite(input.previousAdjustedKwh)
      ? Math.max(0, input.previousAdjustedKwh)
      : undefined;

  // Pace residual caps optimistic weather rest (mid/late afternoon)
  if (
    typeof input.recentRateKwhPerHour === 'number' &&
    Number.isFinite(input.recentRateKwhPerHour) &&
    hoursLeft != null &&
    Number.isFinite(hoursLeft)
  ) {
    const paceRem = estimatePaceRemainingKwh({
      recentRateKwhPerHour: input.recentRateKwhPerHour,
      hoursUntilProductionEnd: hoursLeft,
      localHour: hour,
    });
    remaining = capRemainingByPace(remaining, paceRem, hour);
  }

  let f = 1;
  if (typeof input.correctionFactor === 'number' && Number.isFinite(input.correctionFactor)) {
    f = input.correctionFactor;
  } else {
    f = computeInstantCorrectionFactor(actual, expected);
  }
  f = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, f));

  // Pure anticipation: today's actual + tapered (pace-capped) rest · performance so far
  let A = actual + remaining * f;
  A = Math.max(A, actual);

  const allowAbove = mayExceedBaseline({
    actualKwh: actual,
    baselineKwh: baseline,
    expectedKwhSoFar: expected,
    previousAdjustedKwh: prev,
  });

  if (baseline > 0) {
    A = Math.min(
      A,
      adjustedSoftCap({
        actualKwh: actual,
        baselineKwh: baseline,
        remainingWeatherKwh: remainingRaw,
        remainingEffectiveKwh: remaining,
        allowAboveBaseline: allowAbove,
        localHour: hour,
        hoursUntilProductionEnd: hoursLeft,
      }),
    );
  }

  // Production parabola flat: glue near actual
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
   * Within last eveningFlatten hours residual is tapered (parabola flattens).
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
  /** Recent kWh/h from production history — caps optimistic weather residual. */
  recentRateKwhPerHour?: number;
}

/**
 * Nachberechnete Tagesprognose — antizipiert Tagesende:
 *   A = E_ist + R_eff · f_smooth
 *   R_eff = min(R · eveningTaper, Pace-Rest)
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
  let remainingWeather = effectiveRemainingWeatherKwh(
    remainingRaw,
    input.hoursUntilProductionEnd,
  );
  const hoursLeft = input.hoursUntilProductionEnd;
  if (
    typeof input.recentRateKwhPerHour === 'number' &&
    Number.isFinite(input.recentRateKwhPerHour) &&
    hoursLeft != null
  ) {
    const paceRem = estimatePaceRemainingKwh({
      recentRateKwhPerHour: input.recentRateKwhPerHour,
      hoursUntilProductionEnd: hoursLeft,
      localHour: input.localHour,
    });
    remainingWeather = capRemainingByPace(remainingWeather, paceRem, input.localHour);
  }
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
    recentRateKwhPerHour: input.recentRateKwhPerHour,
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
        ? Math.max(3.5, prev * 0.18)
        : Math.max(1.8, prev * 0.10);

    if (taper <= 0.25) {
      maxUp = 0.15; // parabola flat — no significant upward moves
      maxDown = Math.max(maxDown, 2.5);
    } else if (reanticipate === 'above') {
      maxUp = Math.max(MAX_UP_ABS_REANTICIPATE, prev * MAX_UP_FRAC_REANTICIPATE, remainingWeather * 0.45);
    } else if (reanticipate === 'below') {
      maxDown = Math.max(MAX_DOWN_ABS_UNCATCHABLE, prev * MAX_DOWN_FRAC_UNCATCHABLE);
    }

    // Pace clearly below previous residual → allow faster drop
    if (
      typeof input.recentRateKwhPerHour === 'number' &&
      hoursLeft != null &&
      input.localHour >= 14
    ) {
      const paceEnd =
        actual +
        estimatePaceRemainingKwh({
          recentRateKwhPerHour: input.recentRateKwhPerHour,
          hoursUntilProductionEnd: hoursLeft,
          localHour: input.localHour,
        });
      if (prev > paceEnd + 1.5) {
        maxDown = Math.max(maxDown, prev - paceEnd);
      }
    }

    result = Math.max(prev - maxDown, Math.min(prev + maxUp, result));
    result = Math.max(result, actual);
  }

  // Caps: only exceed B when Ist is already near B (not mere ahead-of-model)
  const allowAbove = mayExceedBaseline({
    actualKwh: actual,
    baselineKwh: baseline,
    expectedKwhSoFar: expectedSoFar,
    previousAdjustedKwh: input.previousAdjustedKwh,
    reanticipate,
  });
  if (baseline > 0) {
    result = Math.min(
      result,
      adjustedSoftCap({
        actualKwh: actual,
        baselineKwh: baseline,
        remainingWeatherKwh: remainingRaw,
        remainingEffectiveKwh: remainingWeather,
        allowAboveBaseline: allowAbove,
        localHour: input.localHour,
        hoursUntilProductionEnd: input.hoursUntilProductionEnd,
      }),
    );
  }

  // Keep near weather/pace target (allow residual above actual)
  if (!(t < 0.3 && actual < baseline * 0.45 && reanticipate === 'none')) {
    const slack = reanticipate === 'above' && taper > 0.25 ? 1.0 : 0.4;
    result = Math.min(result, Math.max(target, actual) + slack * Math.max(taper, 0.1));
  }

  // Late collapse — evening taper or clock hour
  if (taper <= 0.25 || remainingWeather < 0.35) {
    result = Math.min(result, actual + Math.max(0.2, Math.min(0.8, remainingWeather)));
  } else if (input.localHour >= 19 || remainingWeather < 0.5) {
    result = Math.min(result, actual + Math.max(0.3, Math.min(1.2, remainingWeather)));
  } else if (input.localHour >= 18) {
    result = Math.min(result, actual + Math.max(0.5, Math.min(1.8, remainingWeather)));
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
