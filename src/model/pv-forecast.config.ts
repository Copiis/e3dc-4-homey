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
  /**
   * Morning-frozen **weather** baseline (raw Open-Meteo model, unscaled).
   * Displayed baseline = raw × dayScale (see baselineDisplayKwh / learnedDayScale).
   */
  baselineKwh: number;
  /** Effective baseline shown in Insights (scaled). */
  baselineDisplayKwh?: number;
  adjustedKwh?: number;
  /** Monotone cumulative PV today (kWh). */
  actualKwh?: number;
  lastWeatherFetchMs: number;
  /** Timestamp of last adjusted estimate (only after 12:00, 1h interval) */
  lastAdjustedEstimateMs?: number;
  /** Historical production points (monotone kWh) */
  productionHistory?: Array<{ ts: number; kwh: number }>;
  /** EMA of correction factor f for the day */
  correctionEma?: number;
  /**
   * Learned scale B_display = B_raw × scale from recent day-end outcomes.
   * Persisted across days via device store (also mirrored here for the day).
   */
  dayScale?: number;
  /** End-of-day scale learning already applied for this localDate */
  dayScaleLearned?: boolean;
}

export const PV_SEGMENT_COUNT = 3;