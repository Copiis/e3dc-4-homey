import {HourlyIrradiance} from '../services/open-meteo-forecast';

const DEFAULT_PERFORMANCE_RATIO = 0.85;
const CORRECTION_MIN = 0.6;
const CORRECTION_MAX = 1.4;
const MIN_EXPECTED_KWH_FOR_CORRECTION = 0.3;

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
  let remainingKwh = 0;

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
    remainingKwh += partial.adjustedKwh;
  }

  const actualKwh = Math.max(0, actualKwhSoFar);
  let correctionFactor = 1;
  if (expectedKwhSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actualKwh > 0) {
    correctionFactor = actualKwh / expectedKwhSoFar;
    correctionFactor = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, correctionFactor));
  }

  const remainingExpected = Math.max(0, baselineKwh - expectedKwhSoFar);
  const isNearEnd = remainingExpected < MIN_EXPECTED_KWH_FOR_CORRECTION;

  let adjustedKwhValue: number;
  if (isNearEnd) {
    adjustedKwhValue = actualKwh;
  } else if (actualKwh <= expectedKwhSoFar) {
    // Day not yet overtaken the forecast for the elapsed time -> stay at the original baseline
    adjustedKwhValue = baselineKwh;
  } else {
    // Actual production has overtaken the expected so far -> allow adjusted to rise
    adjustedKwhValue = actualKwh + remainingExpected;
  }

  adjustedKwhValue = Math.max(actualKwh, adjustedKwhValue);

  return {
    baselineKwh: roundKwh(baselineKwh),
    adjustedKwh: roundKwh(adjustedKwhValue),
    expectedKwhSoFar: roundKwh(expectedKwhSoFar),
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
  const remainingKwh = sumIrradianceKwh(remainingHours, inputs.installedKwp, inputs.calibrationFactor, pr);
  const actualKwh = Math.max(0, inputs.actualKwhSoFar ?? 0);

  let correctionFactor = 1;
  if (expectedKwhSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actualKwh > 0) {
    correctionFactor = actualKwh / expectedKwhSoFar;
    correctionFactor = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, correctionFactor));
  }

  const remainingExpected = Math.max(0, baselineKwh - expectedKwhSoFar);
  const isNearEnd = remainingExpected < MIN_EXPECTED_KWH_FOR_CORRECTION;

  let adjustedKwhValue: number;
  if (isNearEnd) {
    adjustedKwhValue = actualKwh;
  } else if (actualKwh <= expectedKwhSoFar) {
    // not yet overtaken the forecast for elapsed time -> stay at original baseline
    adjustedKwhValue = baselineKwh;
  } else {
    // actual has overtaken expected so far -> allow the total to rise with actual + remaining (unscaled)
    adjustedKwhValue = actualKwh + remainingKwh;
  }

  adjustedKwhValue = Math.max(actualKwh, adjustedKwhValue);

  return {
    baselineKwh: roundKwh(baselineKwh),
    adjustedKwh: roundKwh(adjustedKwhValue),
    expectedKwhSoFar: roundKwh(expectedKwhSoFar),
    correctionFactor: Math.round(correctionFactor * 1000) / 1000,
  };
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