export interface PvForecastStoreConfig {
  stationId: string;
}

export interface PvSegmentConfig {
  kwp: number;
  tilt: number;
  orientation: string;
  openMeteoAzimuth: number;
}

export interface PvForecastSettings {
  segments: PvSegmentConfig[];
  totalKwp: number;
  latitude: number;
  longitude: number;
  calibrationFactor: number;
  performanceRatio: number;
}

export interface PvForecastDayState {
  localDate: string;
  configHash: string;
  baselineKwh: number;
  adjustedKwh?: number;
  actualKwh?: number;
  lastWeatherFetchMs: number;
}

export const PV_SEGMENT_COUNT = 3;