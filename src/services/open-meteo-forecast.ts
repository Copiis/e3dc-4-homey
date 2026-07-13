import {formatError} from '../utils/error-utils';

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

    // Format ist z.B. "2026-07-12T21:18" in der angegebenen Zeitzone
    const sunsetDate = new Date(sunsets[0]);
    if (isNaN(sunsetDate.getTime())) {
      return null;
    }
    return sunsetDate.getTime();
  } catch {
    return null;
  }
}