import {formatError} from '../utils/error-utils';

/**
 * YYYY-MM-DDTHH:mm[:ss] as wall-clock time in an IANA zone, returned as UTC epoch ms.
 * Open-Meteo timezone=Europe/Berlin strings have no offset. Two offset corrections cover DST.
 * Invalid zone or text yields NaN.
 */
export function parseZonedLocalDateTimeMs(isoLocal: string, timeZone: string): number {
  if (!isoLocal || !timeZone) {
    return NaN;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(isoLocal.trim());
  if (!match) {
    return NaN;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] ? Number(match[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return NaN;
  }
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset1 = zoneOffsetMs(timeZone, utcGuess);
  if (!Number.isFinite(offset1)) {
    return NaN;
  }
  let utc = utcGuess - offset1;
  const offset2 = zoneOffsetMs(timeZone, utc);
  if (!Number.isFinite(offset2)) {
    return NaN;
  }
  if (offset2 !== offset1) {
    utc = utcGuess - offset2;
  }
  return utc;
}

function zoneOffsetMs(timeZone: string, instantMs: number): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(instantMs));
    const pick = (type: string) => Number(parts.find(part => part.type === type)?.value);
    const year = pick('year');
    const month = pick('month');
    const day = pick('day');
    let hour = pick('hour');
    const minute = pick('minute');
    const second = pick('second');
    if ([year, month, day, hour, minute, second].some(value => !Number.isFinite(value))) {
      return NaN;
    }
    if (hour === 24) {
      hour = 0;
    }
    return Date.UTC(year, month - 1, day, hour, minute, second) - instantMs;
  } catch {
    return NaN;
  }
}

export interface HourlyIrradiance {
  time: string;
  globalTiltedIrradianceWm2: number;
}

export interface DailyIrradianceForecast {
  timezone: string;
  hours: HourlyIrradiance[];
}

interface OpenMeteoForecastResponse {
  hourly?: {
    time?: string[];
    global_tilted_irradiance?: Array<number | null>;
  };
  timezone?: string;
}

export async function fetchTodayTiltedIrradianceForecast(
  latitude: number,
  longitude: number,
  tilt: number,
  azimuth: number,
  timezone: string,
): Promise<DailyIrradianceForecast> {
  const params = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    hourly: 'global_tilted_irradiance',
    timezone,
    forecast_days: '1',
    tilt: String(tilt),
    azimuth: String(azimuth),
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo HTTP ${response.status}`);
  }
  let body: OpenMeteoForecastResponse;
  try {
    body = await response.json() as OpenMeteoForecastResponse;
  } catch (e) {
    throw new Error('Open-Meteo invalid JSON: ' + formatError(e));
  }
  const times = body.hourly?.time ?? [];
  const values = body.hourly?.global_tilted_irradiance ?? [];
  const hours: HourlyIrradiance[] = [];
  for (let i = 0; i < times.length; i++) {
    const raw = values[i];
    hours.push({
      time: times[i],
      globalTiltedIrradianceWm2: typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, raw) : 0,
    });
  }
  return {
    timezone: body.timezone ?? timezone,
    hours,
  };
}

interface OpenMeteoDailyResponse {
  daily?: {
    time?: string[];
    sunset?: string[];
  };
  timezone?: string;
}

/**
 * Holt den Sonnenuntergang für den aktuellen Tag (lokal in der Zeitzone).
 * Gibt die Sunset-Zeit als Timestamp zurück (ms seit Epoch) oder null bei Fehler.
 */
export async function fetchSunsetMs(
  latitude: number,
  longitude: number,
  timezone: string,
  nowMs = Date.now()
): Promise<number | null> {
  void nowMs;
  try {
    const params = new URLSearchParams({
      latitude: String(latitude),
      longitude: String(longitude),
      daily: 'sunset',
      timezone,
      forecast_days: '1',
    });

    const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as OpenMeteoDailyResponse;
    const sunsets = body.daily?.sunset ?? [];
    if (sunsets.length === 0 || !sunsets[0]) {
      return null;
    }

    // Format ist z.B. "2026-07-12T21:18" ohne Offset, Wanduhrzeit der angefragten Zone
    const sunsetMs = parseZonedLocalDateTimeMs(sunsets[0], body.timezone ?? timezone);
    if (!Number.isFinite(sunsetMs)) {
      return null;
    }
    return sunsetMs;
  } catch {
    return null;
  }
}