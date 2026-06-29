import Homey from 'homey';
import {PV_SEGMENT_COUNT, PvForecastSettings, PvSegmentConfig} from '../model/pv-forecast.config';
import {resolveOpenMeteoAzimuth} from './pv-orientation';

type RawSettings = Record<string, boolean | string | number | undefined | null>;

function readSegment(raw: RawSettings, index: number): PvSegmentConfig {
  const prefix = `segment${index}`;
  const orientation = typeof raw[`${prefix}Orientation`] === 'string'
    ? String(raw[`${prefix}Orientation`])
    : 'S';
  const legacyAzimuth = Number.isFinite(Number(raw[`${prefix}Azimuth`]))
    ? Number(raw[`${prefix}Azimuth`])
    : undefined;
  return {
    kwp: Math.max(0, Number(raw[`${prefix}Kwp`]) || 0),
    tilt: Number.isFinite(Number(raw[`${prefix}Tilt`])) ? Number(raw[`${prefix}Tilt`]) : 30,
    orientation,
    openMeteoAzimuth: resolveOpenMeteoAzimuth(orientation, legacyAzimuth),
  };
}

export function readPvForecastSettings(device: Homey.Device): PvForecastSettings {
  const raw = device.getSettings() as RawSettings;
  const segments: PvSegmentConfig[] = [];

  for (let index = 1; index <= PV_SEGMENT_COUNT; index++) {
    const segment = readSegment(raw, index);
    if (segment.kwp > 0) {
      segments.push(segment);
    }
  }

  return {
    segments,
    totalKwp: segments.reduce((sum, segment) => sum + segment.kwp, 0),
    latitude: Number(raw.latitude) || 0,
    longitude: Number(raw.longitude) || 0,
    calibrationFactor: Number(raw.calibrationFactor) > 0 ? Number(raw.calibrationFactor) : 1,
    performanceRatio: Number(raw.performanceRatio) > 0 ? Number(raw.performanceRatio) : 0.85,
  };
}

export function weatherCacheKey(tilt: number, azimuth: number): string {
  return `${Math.round(tilt * 10) / 10}:${Math.round(azimuth)}`;
}

export function pvForecastConfigHash(settings: PvForecastSettings): string {
  const segmentPart = settings.segments
    .map(segment => `${segment.kwp}:${segment.tilt}:${segment.orientation}`)
    .join('+');
  return [
    segmentPart,
    settings.calibrationFactor,
    settings.performanceRatio,
    settings.latitude,
    settings.longitude,
  ].join(';');
}

export const PV_SEGMENT_SETTING_PREFIXES = Array.from({ length: PV_SEGMENT_COUNT }, (_, i) => {
  const index = i + 1;
  return [`segment${index}Kwp`, `segment${index}Tilt`, `segment${index}Orientation`];
}).flat();