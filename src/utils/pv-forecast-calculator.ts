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
  let correctionFactor = 1;
  if (expectedKwhSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actualKwh > 0) {
    correctionFactor = actualKwh / expectedKwhSoFar;
    correctionFactor = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, correctionFactor));
  }

  // adjusted hier = reiner Wetter-Rest-Landepunkt (ohne Smooth/History)
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

  let correctionFactor = 1;
  if (expectedKwhSoFar >= MIN_EXPECTED_KWH_FOR_CORRECTION && actualKwh > 0) {
    correctionFactor = actualKwh / expectedKwhSoFar;
    correctionFactor = Math.max(CORRECTION_MIN, Math.min(CORRECTION_MAX, correctionFactor));
  }

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

/**
 * Kern der Nachberechnung (valider Weg):
 *   A = E_ist + R_Wetter · f
 * f = E_ist / E_modell,bisher (geclampt); bei wenig Modell-Daten → 1.
 * Immer A ≥ E_ist; Rest → 0 abends ⇒ A → E_ist.
 */
export function computeWeatherRestLandingPoint(input: {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar: number;
  remainingWeatherKwh: number;
  correctionFactor?: number;
}): number {
  const actual = Math.max(0, input.actualKwh);
  const expected = Math.max(0, input.expectedKwhSoFar);
  const remaining = Math.max(0, input.remainingWeatherKwh);
  const baseline = Math.max(0, input.baselineKwh);

  let f = 1;
  if (typeof input.correctionFactor === 'number' && Number.isFinite(input.correctionFactor)) {
    f = input.correctionFactor;
  } else if (expected >= MIN_EXPECTED_KWH_FOR_CORRECTION && actual > 0) {
    f = actual / expected;
  }
  // Enger als die alte 0.6–1.4-Spanne: Overshoot durch zu großes f vermeiden
  f = Math.max(0.7, Math.min(1.2, f));

  let A = actual + remaining * f;
  A = Math.max(A, actual);

  // Nicht klar voraus → nicht über die (eingefrorene) Baseline steigen
  const ahead = expected > 0.5 && actual > expected * 1.03;
  if (baseline > 0) {
    if (!ahead) {
      A = Math.min(A, Math.max(baseline, actual));
    } else {
      // Klar voraus: max. +10 % über Baseline (Notbremse)
      A = Math.min(A, Math.max(actual, baseline * 1.1));
    }
  }

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
  // Max 2.5h Rest mit voller Steigung — danach ist die Kurve oft zu optimistisch
  const remainingHours = Math.max(0.15, Math.min(2.5, rawRemaining));

  // Taper: nicht volle aktuelle Rate über die Restzeit (Überhöhen vermeiden)
  // Bei 2.5h Rest → ~0.45× Rate, bei 0.5h Rest → ~0.85× Rate
  const taper = 0.4 + 0.45 * Math.min(1, 1.0 / Math.max(remainingHours, 0.3));
  let final = last.kwh + ratePerHour * remainingHours * taper;

  final = Math.max(last.kwh, final);

  return roundKwh(final);
}

export interface AdjustedForecastBlendInput {
  actualKwh: number;
  baselineKwh: number;
  expectedKwhSoFar: number;
  correctionFactor: number;
  /**
   * Wetter-Restenergie ab jetzt (kWh) aus aktuellem Open-Meteo.
   * Wenn weggelassen: Fallback `max(0, baseline − expectedSoFar)` (ungenauer).
   */
  remainingWeatherKwh?: number;
  /**
   * @deprecated Kurven-Landepunkt wird nicht mehr als Treiber genutzt
   * (Overshoot-Ursache). Parameter bleibt optional für alte Aufrufer.
   */
  curveEstimate?: number;
  /** Previous published adjusted value (for smooth Insights, no noon crash). */
  previousAdjustedKwh?: number;
  /** Local hour 0–23; blending starts after 12. */
  localHour: number;
}

/**
 * Nachberechnete Tagesprognose (angepasst):
 *   A = E_ist + R_Wetter · f
 *
 * Die frühere Kurven-Extrapolation (Mittagssteigung × Restzeit) entfällt —
 * sie war die Hauptursache für Nachmittags-Überschießen in Insights.
 * Optionaler Schritt-Smoother hält Insights ruhig (nach oben streng begrenzt).
 */
export function blendAdjustedForecast(input: AdjustedForecastBlendInput): number {
  const actual = Math.max(0, input.actualKwh);
  const baseline = Math.max(0, input.baselineKwh);
  const expectedSoFar = Math.max(0, input.expectedKwhSoFar);
  const remainingWeather =
    typeof input.remainingWeatherKwh === 'number' && Number.isFinite(input.remainingWeatherKwh)
      ? Math.max(0, input.remainingWeatherKwh)
      : Math.max(0, baseline - expectedSoFar);

  const target = computeWeatherRestLandingPoint({
    actualKwh: actual,
    baselineKwh: baseline,
    expectedKwhSoFar: expectedSoFar,
    remainingWeatherKwh: remainingWeather,
    correctionFactor: input.correctionFactor,
  });

  let result = target;

  // Früh nach 12:00 + wenig Ist: bei Previous/Baseline ankern (kein Insights-Crash unter Baseline)
  const t = Math.max(0, Math.min(1, (input.localHour - 12) / 7));
  if (t < 0.3 && baseline > 0 && actual < baseline * 0.45) {
    const anchor =
      input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0
        ? input.previousAdjustedKwh
        : baseline;
    // Halte nahe am Anker (Baseline), lasse aber target den Wert nach unten ziehen wenn
    // das Wetter klar weniger Rest meldet — gemischt, kein harter Drop.
    const anchored = Math.min(anchor, baseline);
    result = Math.max(actual, anchored * (1 - t) + target * t);
  }

  result = Math.max(result, actual);

  // Schritte: nach oben streng (kein stündliches Hochklettern), nach unten freier
  if (input.previousAdjustedKwh != null && input.previousAdjustedKwh > 0) {
    const prev = input.previousAdjustedKwh;
    const maxUp = Math.max(0.6, prev * 0.025); // ~2.5 %/h max
    const maxDown = prev > baseline + 0.5
      ? Math.max(4.0, prev * 0.2) // Overshoot schnell abbauen
      : Math.max(2.0, prev * 0.12);
    result = Math.max(prev - maxDown, Math.min(prev + maxUp, result));
    result = Math.max(result, actual);
  }

  // Harte Caps nach Smoothing
  const ahead = expectedSoFar > 0.5 && actual > expectedSoFar * 1.03;
  if (baseline > 0) {
    if (!ahead) {
      result = Math.min(result, Math.max(baseline, actual));
    } else {
      result = Math.min(result, Math.max(actual, baseline * 1.1));
    }
  }
  // Nachmittag/Abend: nicht über den Wetter-Landepunkt davonlaufen
  // (früh nach 12 mit wenig Ist bleibt Anker erlaubt)
  if (!(t < 0.3 && actual < baseline * 0.45)) {
    result = Math.min(result, Math.max(target, actual) + 0.3);
  }
  result = Math.max(result, actual);

  return roundKwh(result);
}