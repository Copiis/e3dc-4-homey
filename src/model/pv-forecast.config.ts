export interface PvForecastStoreConfig {
  stationId: string;
}

export interface PvForecastSettings {
  installedKwp: number;
  latitude: number;
  longitude: number;
  azimuth: number;
  tilt: number;
  calibrationFactor: number;
  performanceRatio: number;
}

export interface PvForecastDayState {
  localDate: string;
  baselineKwh: number;
  lastWeatherFetchMs: number;
}