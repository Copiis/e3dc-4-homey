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

  // Die nachberechnete Prognose (Kurven-Schätzung) wird ab 12 Uhr mittags
  // (nur noch, nicht mehr bei >=3 kWh Ist) im Device anhand der Insights-Produktionskurve berechnet.
  // Hier liefern wir als adjusted immer die reine Baseline.
  const adjustedKwhValue = baselineKwh;

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

  // Kurvenbasierte Schätzung der Endsumme (nachberechnete Prognose)
  // erfolgt im Device — aber nur ab 12:00 mittags (im 1h-Intervall).
  // Hier: reine Baseline zurückgeben.
  const adjustedKwhValue = baselineKwh;

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

/** Geschätztes Ende der PV-Produktion anhand der Forecast-Stunden (letzte relevante Einstrahlung)
 * Konservativer gemacht, um Overshooting der angepassten Prognose zu vermeiden:
 * - Niedrigerer Schwellwert
 * - Kürzerer Puffer
 * - Harte Obergrenze für Remaining (max 5h)
 */
export function estimateProductionEndMs(hours: HourlyIrradiance[], nowMs: number): number {
  if (!hours || hours.length === 0) {
    return nowMs + 4 * 3600 * 1000;
  }
  // Letzte Stunde mit spürbarer Einstrahlung (produziert noch)
  // Niedrigerer Schwellwert + kürzerer Puffer, damit das Ende nicht zu optimistisch ist.
  for (let i = hours.length - 1; i >= 0; i--) {
    if ((hours[i].globalTiltedIrradianceWm2 || 0) > 15) {
      const candidate = hourTimestampMs(hours[i].time) + 30 * 60 * 1000;
      // Nie mehr als ~5 Stunden in die Zukunft projizieren
      return Math.min(candidate, nowMs + 5 * 3600 * 1000);
    }
  }
  return Math.min(nowMs + 3.5 * 3600 * 1000, nowMs + 5 * 3600 * 1000);
}

/**
 * Schätzt den Landepunkt (finale kWh der Tagesproduktion) anhand
 * der Produktionskurve der letzten Stunden + geschätztem Ende.
 *
 * Wichtig: Im aufrufenden Code wird das Ergebnis zusätzlich gegen eine
 * "forecast-guided" Schätzung geclamped, weil reine lineare Extrapolation
 * bei unsicherem Produktionsende leicht überschießt.
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

  // Für Steilheit/Flachheit: vorzugsweise die Kurve der letzten ~3 Stunden verwenden
  const recentWindowStart = nowMs - 3 * 3600 * 1000;
  let points = sorted.filter(p => p.ts >= recentWindowStart);

  if (points.length < 2) {
    points = sorted.slice(-8); // Fallback: letzte ~40min bei 5min-Intervallen
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

  const ratePerHour = (last.kwh - first.kwh) / deltaHours; // Steigung der Kurve

  // Wichtig: Remaining stark begrenzen. Auch wenn estimateProductionEndMs zu spät liegt,
  // extrapolieren wir nicht linear über viele Stunden (Produktionsrate fällt zum Abend hin).
  const rawRemaining = (estimatedEndMs - nowMs) / 3600000;
  const remainingHours = Math.max(0.2, Math.min(3.5, rawRemaining));

  let final = last.kwh + ratePerHour * remainingHours;

  // Nie unter aktuellen Wert fallen
  final = Math.max(last.kwh, final);

  return roundKwh(final);
}