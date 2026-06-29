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

  const adjustedKwh = actualKwh + remainingKwh * correctionFactor;
  return {
    baselineKwh: roundKwh(baselineKwh),
    adjustedKwh: roundKwh(Math.max(actualKwh, adjustedKwh)),
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