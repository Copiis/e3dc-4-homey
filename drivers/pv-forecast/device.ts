import Homey from 'homey';
import {clearTimeout} from 'node:timers';
import {HomePowerStation} from '../../src/model/home-power-station';
import {
  PvForecastDayState,
  PvForecastSettings,
  PvForecastStoreConfig,
} from '../../src/model/pv-forecast.config';
import {SummaryType} from '../../src/model/summary.config';
import {DailyIrradianceForecast, fetchTodayTiltedIrradianceForecast} from '../../src/services/open-meteo-forecast';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {formatError} from '../../src/utils/error-utils';
import {calculatePvForecast, localDateString, roundKwh} from '../../src/utils/pv-forecast-calculator';

const SYNC_INTERVAL_MS = 1000 * 60 * 5;
const WEATHER_REFRESH_MS = 1000 * 60 * 60;
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5;

const STORE_DAY_STATE_KEY = 'pvForecastDayState';
const STORE_WEATHER_KEY = 'pvForecastWeather';

class PvForecastDevice extends Homey.Device {

  private loopId: NodeJS.Timeout | null = null;
  private syncErrorCount = 0;
  private cachedWeather: DailyIrradianceForecast | null = null;

  async onInit() {
    this.log('PvForecastDevice has been initialized');
    this.cachedWeather = this.getStoreValue(STORE_WEATHER_KEY) ?? null;
    setTimeout(() => this.autoSync(), 4000);
  }

  async onSettings() {
    this.homey.setTimeout(() => this.sync().catch(() => undefined), 1000);
  }

  private autoSync() {
    this.sync()
      .then(() => {
        this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_MS);
      })
      .catch(reason => {
        this.error('Auto sync failed: ' + formatError(reason));
        this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL_MS);
      });
  }

  private resolveLinkedStation(): HomePowerStation | null {
    const ownConfig: PvForecastStoreConfig | undefined = this.getStoreValue('settings');
    if (!ownConfig?.stationId) {
      return null;
    }
    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices();
    const station = hpsDevices.find(value => {
      const asStation = value as unknown as HomePowerStation;
      return asStation.getId() === ownConfig.stationId;
    });
    return station ? station as unknown as HomePowerStation : null;
  }

  private readSettings(): PvForecastSettings {
    const settings = this.getSettings() as Partial<PvForecastSettings>;
    return {
      installedKwp: Number(settings.installedKwp) > 0 ? Number(settings.installedKwp) : 10,
      latitude: Number(settings.latitude) || 0,
      longitude: Number(settings.longitude) || 0,
      azimuth: Number.isFinite(Number(settings.azimuth)) ? Number(settings.azimuth) : 180,
      tilt: Number.isFinite(Number(settings.tilt)) ? Number(settings.tilt) : 30,
      calibrationFactor: Number(settings.calibrationFactor) > 0 ? Number(settings.calibrationFactor) : 1,
      performanceRatio: Number(settings.performanceRatio) > 0 ? Number(settings.performanceRatio) : 0.85,
    };
  }

  private async resolveCoordinates(settings: PvForecastSettings): Promise<{ latitude: number; longitude: number } | null> {
    if (settings.latitude !== 0 && settings.longitude !== 0) {
      return { latitude: settings.latitude, longitude: settings.longitude };
    }
    try {
      const latitude = this.homey.geolocation.getLatitude();
      const longitude = this.homey.geolocation.getLongitude();
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
        return { latitude, longitude };
      }
    } catch (e) {
      this.log('Homey geolocation unavailable: ' + formatError(e));
    }
    return null;
  }

  private loadDayState(localDate: string): PvForecastDayState | undefined {
    const state = this.getStoreValue(STORE_DAY_STATE_KEY) as PvForecastDayState | undefined;
    if (state?.localDate === localDate) {
      return state;
    }
    return undefined;
  }

  private saveDayState(state: PvForecastDayState): void {
    this.setStoreValue(STORE_DAY_STATE_KEY, state).catch(reason => {
      this.error('Failed to store pv forecast day state: ' + formatError(reason));
    });
  }

  private shouldRefreshWeather(dayState: PvForecastDayState | undefined, nowMs: number): boolean {
    if (!dayState) {
      return true;
    }
    return nowMs - dayState.lastWeatherFetchMs > WEATHER_REFRESH_MS;
  }

  private async fetchWeatherIfNeeded(
    settings: PvForecastSettings,
    timezone: string,
    dayState: PvForecastDayState | undefined,
    nowMs: number,
  ): Promise<DailyIrradianceForecast | null> {
    if (this.cachedWeather && !this.shouldRefreshWeather(dayState, nowMs)) {
      return this.cachedWeather;
    }
    const coords = await this.resolveCoordinates(settings);
    if (!coords) {
      throw new Error(this.homey.__('pv-forecast.errors.missing-location'));
    }
    const forecast = await fetchTodayTiltedIrradianceForecast(
      coords.latitude,
      coords.longitude,
      settings.tilt,
      settings.azimuth,
      timezone,
    );
    this.cachedWeather = forecast;
    await this.setStoreValue(STORE_WEATHER_KEY, forecast);
    return forecast;
  }

  private async readActualPvTodayKwh(station: HomePowerStation, timezone: string): Promise<number> {
    const result = await station.getApi().readSummaryData(SummaryType.TODAY, true, this, timezone);
    return roundKwh(Math.max(0, result.pvDelivery) / 1000);
  }

  async sync() {
    const ownConfig: PvForecastStoreConfig | undefined = this.getStoreValue('settings');
    if (!ownConfig?.stationId) {
      this.error('PV forecast device has no store settings — sync skipped');
      await this.setUnavailable(this.homey.__('messages.hps-device-not-found'));
      return;
    }

    const station = this.resolveLinkedStation();
    if (!station) {
      this.error('Station with id ' + ownConfig.stationId + ' not found');
      await this.setUnavailable(this.homey.__('messages.hps-device-not-found'));
      return;
    }
    const stationDevice = station as unknown as Homey.Device;

    if (!stationDevice.getAvailable()) {
      await this.setUnavailable(this.homey.__('messages.hps-not-available'));
      this.syncErrorCount++;
      return;
    }

    const settings = this.readSettings();
    const timezone = this.homey.clock.getTimezone();
    const nowMs = Date.now();
    const today = localDateString(timezone, nowMs);
    let dayState = this.loadDayState(today);

    try {
      const weather = await this.fetchWeatherIfNeeded(settings, timezone, dayState, nowMs);
      if (!weather || weather.hours.length === 0) {
        throw new Error(this.homey.__('pv-forecast.errors.no-weather-data'));
      }

      const actualKwh = await this.readActualPvTodayKwh(station, timezone);
      const forecast = calculatePvForecast({
        hours: weather.hours,
        installedKwp: settings.installedKwp,
        calibrationFactor: settings.calibrationFactor,
        performanceRatio: settings.performanceRatio,
        nowMs,
        actualKwhSoFar: actualKwh,
      });

      let baselineKwh = dayState?.baselineKwh;
      if (baselineKwh == null) {
        baselineKwh = forecast.baselineKwh;
      }

      dayState = {
        localDate: today,
        baselineKwh,
        lastWeatherFetchMs: nowMs,
      };
      this.saveDayState(dayState);

      updateCapabilityValue('measure_pv_forecast_baseline', baselineKwh, this);
      updateCapabilityValue('measure_pv_forecast_adjusted', forecast.adjustedKwh, this);
      updateCapabilityValue('measure_pv_actual_today', actualKwh, this);

      this.syncErrorCount = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
      this.log(
        `PV forecast sync: baseline=${baselineKwh} kWh adjusted=${forecast.adjustedKwh} kWh `
        + `actual=${actualKwh} kWh correction=${forecast.correctionFactor}`,
      );
    } catch (e) {
      this.error('PV forecast sync failed: ' + formatError(e));
      this.syncErrorCount++;
      if (this.syncErrorCount >= MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE) {
        await this.setUnavailable(formatError(e));
      }
    }
  }

  async onDeleted() {
    if (this.loopId) {
      clearTimeout(this.loopId);
    }
  }
}

module.exports = PvForecastDevice;