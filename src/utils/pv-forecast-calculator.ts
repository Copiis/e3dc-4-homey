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
 * Reine lineare Extrapolation neigt zum Überschießen (Mittagssteigung × Restzeit).
 * Deshalb: Restzeit begrenzen + abnehmende Rate (Taper) zum Abend.
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

  // Für Steilheit: vorzugsweise die letzten ~2 Stunden (weniger Mittags-Bias als 3h)
  const recentWindowStart = nowMs - 2 * 3600 * 1000;
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

  const ratePerHour = Math.max(0, (last.kwh - first.kwh) / deltaHours);

  // Remaining begrenzen (Produktionsrate fällt zum Abend)
  const rawRemaining = (estimatedEndMs - nowMs) / 3600000;
  const remainingHours = Math.max(0.15, Math.min(3.0, rawRemaining));

  // Taper: nicht volle aktuelle Rate über die Restzeit (Überhöhen vermeiden)
  // Bei 3h Rest → ~0.55× Rate, bei 0.5h Rest → ~0.9× Rate
  const taper = 0.5 + 0.45 * Math.min(1, 1.2 / Math.max(remainingHours, 0.3));
  let final = last.kwh + ratePerHour * remainingHours * taper;

  final = Math.max(last.kwh, final);

  return roundKwh(final);
}

export interface AdjustedForecastBlendInput {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar: number;
  correctionFactor: number;
  curveEstimate: number;
  /** Previous published adjusted value (for smooth Insights, no noon crash). */
  previousAdjustedKwh?: number;
  /** Local hour 0–23; blending starts after 12. */
  localHour: number;
}

/**
 * Mischt Kurven-Extrapolation und wettergeführte Schätzung.
 *
 * Problem der alten Logik `min(curve, guided)`:
 * - mittags oft Crash (Kurve noch flach → Unterschätzung)
 * - nachmittags Überschießen (steile Kurve × Restzeit)
 *
 * Strategie:
 * - früh (ab 12) stärker guided/baseline, später mehr Kurve
 * - Floor/Cap + Schrittbegrenzung gegen Insights-Zacken
 */
export function blendAdjustedForecast(input: AdjustedForecastBlendInput): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const expectedSoFar = Math.max(0, input.expectedKwhSoFar);
  const remainingBaseline = Math.max(0, baseline - expectedSoFar);
  const corr = Number.isFinite(input.correctionFactor) ? input.correctionFactor : 1;
  const safeFactor = Math.max(0.7, Math.min(1.3, corr));
  const guided = actual + remainingBaseline * safeFactor;
  const curve = Math.max(actual, input.curveEstimate || actual);

  // 12:00 → 0, ca. 19:00 → 1
  const t = Math.max(0, Math.min(1, (input.localHour - 12) / 7));

  // Früh: guided dominiert (stabil nahe Baseline). Spät: Kurve stärker, aber nicht allein.
  const curveWeight = 0.15 + 0.55 * t; // 0.15 … 0.70
  let blended = guided * (1 - curveWeight) + curve * curveWeight;

  // Spät am Tag: Richtung „Ist + kleiner Rest“ ziehen (Vorhersage wird sowieso trivial)
  if (t > 0.65 && baseline > 0) {
    const doneFrac = Math.min(1, expectedSoFar / baseline);
    const latePull = (t - 0.65) / 0.35; // 0…1
    const conservative = actual + remainingBaseline * Math.min(safeFactor, 1.05);
    blended = blended * (1 - latePull * 0.55) + conservative * (latePull * 0.55);
    // Wenn schon sehr viel vom erwarteten Tag durch ist, enger an actual
    if (doneFrac > 0.85) {
      blended = Math.min(blended, actual + remainingBaseline * 1.05);
    }
  }

  // Floor: kein Absturz unter actual; mittags nicht weit unter Baseline/vorherigem Wert
  let floor = actual;
  if (t < 0.4) {
    const anchor = input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0
      ? input.previousAdjustedKwh
      : baseline;
    floor = Math.max(floor, Math.min(anchor, guided) * 0.94);
  }

  // Cap: begrenztes Überschießen vs. Baseline/Guided
  const overshoot = t < 0.45 ? 1.1 : 1.18;
  const cap = Math.max(
    baseline * overshoot,
    guided * 1.12,
    actual * 1.12,
  );

  let result = Math.min(cap, Math.max(floor, blended));
  result = Math.max(result, actual);

  // Sanfte Schritte (Insights: keine steilen Treppen/Abstürze pro Update-Stunde)
  if (input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0) {
    const prev = input.previousAdjustedKwh;
    const maxStep = Math.max(2.0, prev * 0.1); // ±10 % oder mind. 2 kWh
    result = Math.max(prev - maxStep, Math.min(prev + maxStep, result));
    result = Math.max(result, actual);
  }

  return roundKwh(result);
}