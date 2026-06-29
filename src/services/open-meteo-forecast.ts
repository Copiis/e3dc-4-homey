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