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
  /** Timestamp of last curve-based adjusted estimate (only after 12:00 / Mittag, 1h Intervall) */
  lastAdjustedEstimateMs?: number;
  /** Historical production points for curve analysis (ts + cumulative kWh today) */
  productionHistory?: Array<{ ts: number; kwh: number }>;
}

export const PV_SEGMENT_COUNT = 3;