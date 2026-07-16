/**
 * PvForecastDevice
 *
 * Liefert PV-Ertragsprognosen basierend auf Open-Meteo und lokalen Modul-Einstellungen.
 * Unterstützt Multi-Segment-Konfigurationen (verschiedene Ausrichtungen/Neigungen).
 *
 * Verantwortlichkeiten:
 * - Abruf und Berechnung von Tages-/Stunden-Prognosen
 * - Caching und Fehlerbehandlung
 * - Integration in Summary und Capabilities
 *
 * Nutzt zentrale Services und Utils für saubere Trennung.
 */
import Homey from 'homey';
import {clearTimeout} from 'node:timers';
import {HomePowerStation} from '../../src/model/home-power-station';
import {
  PvForecastDayState,
  PvForecastSettings,
  PvForecastStoreConfig,
  PvSegmentConfig,
} from '../../src/model/pv-forecast.config';
import {SummaryType} from '../../src/model/summary.config';
import {DailyIrradianceForecast, fetchTodayTiltedIrradianceForecast} from '../../src/services/open-meteo-forecast';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {formatError} from '../../src/utils/error-utils';
import {
  blendAdjustedForecast,
  calculateMultiSegmentPvForecast,
  estimateDailyProductionLandingPoint,
  getLocalHour,
  localDateString,
  roundKwh,
} from '../../src/utils/pv-forecast-calculator';
import { fetchSunsetMs } from '../../src/services/open-meteo-forecast';
import {
  PV_SEGMENT_SETTING_PREFIXES,
  pvForecastConfigHash,
  readPvForecastSettings,
  weatherCacheKey,
} from '../../src/utils/pv-segment-settings';

const SYNC_INTERVAL_MS = 1000 * 60 * 5;
const WEATHER_REFRESH_MS = 1000 * 60 * 60;
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 3;

const STORE_DAY_STATE_KEY = 'pvForecastDayState';
const STORE_WEATHER_KEY = 'pvForecastWeatherBySurface';

type WeatherCache = Record<string, DailyIrradianceForecast>;

class PvForecastDevice extends Homey.Device {

  private loopId: NodeJS.Timeout | null = null;
  private syncErrorCount = 0;
  private cachedWeather: WeatherCache = {};
  /** Cached sunset for the current local day to avoid repeated API calls */
  private cachedSunset: { localDate: string; sunsetMs: number } | null = null;

  /**
   * Initialisiert die PV-Prognose.
   * Lädt Segmente, stellt Capabilities sicher und startet den Scheduler.
   */
  async onInit() {
    this.log('PvForecastDevice has been initialized');
    this.cachedWeather = this.getStoreValue(STORE_WEATHER_KEY) ?? {};
    await this.migrateLegacySettingsOnce();
    this.restoreDisplayFromCache();
    setTimeout(() => this.autoSync(), 4000);
  }

  private async migrateLegacySettingsOnce(): Promise<void> {
    const raw = this.getSettings() as Record<string, unknown>;
    if (Number(raw.segment1Kwp) > 0) {
      return;
    }
    const legacyKwp = Number(raw.installedKwp) || 0;
    if (legacyKwp <= 0) {
      return;
    }
    this.log(`PV forecast: migrating legacy installedKwp=${legacyKwp} to segment 1`);
    await this.setSettings({
      ...raw,
      segment1Kwp: legacyKwp,
      segment1Tilt: Number.isFinite(Number(raw.tilt)) ? Number(raw.tilt) : 30,
      segment1Orientation: typeof raw.orientation === 'string' ? raw.orientation : 'S',
      installedKwp: 0,
    });
    await this.unsetStoreValue(STORE_DAY_STATE_KEY).catch(() => undefined);
    this.cachedWeather = {};
    await this.unsetStoreValue(STORE_WEATHER_KEY).catch(() => undefined);
  }

  async onSettings({
    changedKeys,
  }: {
    changedKeys: string[];
  }): Promise<string | void> {
    const pvSettingKeys = [
      ...PV_SEGMENT_SETTING_PREFIXES,
      'installedKwp', 'tilt', 'orientation', 'azimuth',
      'calibrationFactor', 'performanceRatio', 'latitude', 'longitude',
    ];
    if (changedKeys.some(key => pvSettingKeys.includes(key))) {
      this.cachedWeather = {};
      await this.unsetStoreValue(STORE_WEATHER_KEY).catch(() => undefined);
      await this.unsetStoreValue(STORE_DAY_STATE_KEY).catch(() => undefined);
      this.log('PV forecast settings changed — weather and day cache cleared');
    }
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

  private restoreDisplayFromCache(): void {
    const timezone = this.homey.clock.getTimezone();
    const settings = readPvForecastSettings(this);
    const dayState = this.loadDayState(localDateString(timezone), pvForecastConfigHash(settings));
    if (!dayState) {
      return;
    }
    if (dayState.baselineKwh != null) {
      updateCapabilityValue('measure_pv_forecast_baseline', dayState.baselineKwh, this);
    }
    if (dayState.adjustedKwh != null) {
      updateCapabilityValue('measure_pv_forecast_adjusted', dayState.adjustedKwh, this);
    }
    if (dayState.actualKwh != null) {
      updateCapabilityValue('measure_pv_actual_today', dayState.actualKwh, this);
    }
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

  private isMissingKwpError(reason: unknown): boolean {
    return formatError(reason).includes(this.homey.__('pv-forecast.errors.missing-kwp'));
  }

  private async resolveCoordinates(settings: PvForecastSettings): Promise<{ latitude: number; longitude: number } | null> {
    if (settings.latitude !== 0 && settings.longitude !== 0) {
      return { latitude: settings.latitude, longitude: settings.longitude };
    }
    try {
      const latitude = this.homey.geolocation.getLatitude();
      const longitude = this.homey.geolocation.getLongitude();
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0)) {
        const current = this.getSettings();
        await this.setSettings({
          ...current,
          latitude,
          longitude,
        });
        this.log(`PV forecast: using Homey location ${latitude}, ${longitude}`);
        return { latitude, longitude };
      }
    } catch (e) {
      this.log('Homey geolocation unavailable: ' + formatError(e));
    }
    return null;
  }

  private loadDayState(localDate: string, configHash: string): PvForecastDayState | undefined {
    const state = this.getStoreValue(STORE_DAY_STATE_KEY) as PvForecastDayState | undefined;
    if (state?.localDate === localDate && state?.configHash === configHash) {
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

  private uniqueSurfaceKeys(segments: PvSegmentConfig[]): string[] {
    const keys = new Set<string>();
    for (const segment of segments) {
      keys.add(weatherCacheKey(segment.tilt, segment.openMeteoAzimuth));
    }
    return [...keys];
  }

  private async fetchWeatherForSegments(
    settings: PvForecastSettings,
    timezone: string,
    dayState: PvForecastDayState | undefined,
    nowMs: number,
  ): Promise<WeatherCache> {
    const refresh = this.shouldRefreshWeather(dayState, nowMs);
    const requiredKeys = this.uniqueSurfaceKeys(settings.segments);
    const result: WeatherCache = refresh ? {} : { ...this.cachedWeather };

    const missingKeys = requiredKeys.filter(key => !result[key]?.hours?.length);
    if (!refresh && missingKeys.length === 0) {
      return result;
    }

    const coords = await this.resolveCoordinates(settings);
    if (!coords) {
      throw new Error(this.homey.__('pv-forecast.errors.missing-location'));
    }

    const keysToFetch = refresh ? requiredKeys : missingKeys;
    for (const key of keysToFetch) {
      const sample = settings.segments.find(
        segment => weatherCacheKey(segment.tilt, segment.openMeteoAzimuth) === key,
      );
      if (!sample) {
        continue;
      }
      const forecast = await fetchTodayTiltedIrradianceForecast(
        coords.latitude,
        coords.longitude,
        sample.tilt,
        sample.openMeteoAzimuth,
        timezone,
      );
      if (!forecast.hours.length) {
        throw new Error(this.homey.__('pv-forecast.errors.no-weather-data'));
      }
      result[key] = forecast;
    }

    this.cachedWeather = result;
    await this.setStoreValue(STORE_WEATHER_KEY, result);
    return result;
  }

  private async readActualPvTodayKwh(station: HomePowerStation, timezone: string): Promise<number> {
    try {
      const result = await station.getApi().readSummaryData(SummaryType.TODAY, true, this, timezone);
      return roundKwh(Math.max(0, result.pvDelivery) / 1000);
    } catch (e) {
      this.log('PV today from HKW summary unavailable, using 0 for correction: ' + formatError(e));
      return 0;
    }
  }

  private isMissingLocationError(reason: unknown): boolean {
    return formatError(reason).includes(this.homey.__('pv-forecast.errors.missing-location'));
  }

  private publishForecastValues(
    baselineKwh: number,
    adjustedKwh: number,
    actualKwh: number,
    dayState: PvForecastDayState,
  ): void {
    updateCapabilityValue('measure_pv_forecast_baseline', baselineKwh, this);
    updateCapabilityValue('measure_pv_forecast_adjusted', adjustedKwh, this);
    updateCapabilityValue('measure_pv_actual_today', actualKwh, this);
    this.saveDayState({
      ...dayState,
      baselineKwh,
      adjustedKwh,
      actualKwh,
    });
  }

  private formatSegmentLog(segments: PvSegmentConfig[]): string {
    return segments
      .map(segment => `${segment.kwp}kWp/${segment.tilt}°/${segment.orientation}`)
      .join(' + ');
  }

  /**
   * Führt den vollen Sync der PV-Prognose durch.
   * Holt aktuelle Wetterdaten, berechnet Forecast und aktualisiert Capabilities.
   */
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

    const settings = readPvForecastSettings(this);
    if (settings.totalKwp <= 0 || settings.segments.length === 0) {
      await this.setUnavailable(this.homey.__('pv-forecast.errors.missing-kwp'));
      return;
    }

    const timezone = this.homey.clock.getTimezone();
    const nowMs = Date.now();
    const today = localDateString(timezone, nowMs);
    const configHash = pvForecastConfigHash(settings);
    let dayState = this.loadDayState(today, configHash);

    try {
      const weatherBySurface = await this.fetchWeatherForSegments(settings, timezone, dayState, nowMs);
      const segmentInputs = settings.segments.map(segment => {
        const key = weatherCacheKey(segment.tilt, segment.openMeteoAzimuth);
        const weather = weatherBySurface[key];
        if (!weather?.hours?.length) {
          throw new Error(this.homey.__('pv-forecast.errors.no-weather-data'));
        }
        return {
          hours: weather.hours,
          installedKwp: segment.kwp,
        };
      });

      // Sonnenuntergang holen und Produktionsende immer 3 Stunden davor setzen.
      // Das ist zuverlässiger als die letzte Irradiance-Stunde aus dem Forecast.
      const coords = await this.resolveCoordinates(settings);
      let estimatedEndMs = nowMs + 4 * 3600 * 1000; // Fallback
      if (coords) {
        const todayForSun = localDateString(timezone, nowMs);
        if (!this.cachedSunset || this.cachedSunset.localDate !== todayForSun) {
          const sunsetMs = await fetchSunsetMs(coords.latitude, coords.longitude, timezone, nowMs);
          if (sunsetMs && sunsetMs > nowMs) {
            this.cachedSunset = { localDate: todayForSun, sunsetMs };
          }
        }
        if (this.cachedSunset?.sunsetMs) {
          estimatedEndMs = this.cachedSunset.sunsetMs - 3 * 3600 * 1000;
        }
      }

      const actualKwh = await this.readActualPvTodayKwh(station, timezone);

      // Reine Baseline (Ursprungsprognose) aus dem Wetter-Modell
      const forecast = calculateMultiSegmentPvForecast(
        segmentInputs,
        settings.calibrationFactor,
        settings.performanceRatio,
        nowMs,
        actualKwh,
      );

      let baselineKwh = dayState?.baselineKwh;
      if (baselineKwh == null) {
        baselineKwh = forecast.baselineKwh;
      }

      // Historie der kumulierten PV-Erzeugung (Insights-Kurve) immer pflegen
      let history = [...(dayState?.productionHistory || [])];
      const lastHist = history[history.length - 1];
      if (!lastHist || nowMs - lastHist.ts > 4 * 60 * 1000) {
        history.push({ ts: nowMs, kwh: actualKwh });
      }
      // Trimmen auf sinnvollen Zeitraum (letzte ~10 Stunden)
      const trimStart = nowMs - 10 * 3600 * 1000;
      history = history.filter(p => p.ts >= trimStart);

      // === Nachberechnete Prognose (Landepunkt) ===
      // Ab 12:00, stündlich neu. Blend aus Kurve + Wetter-guided (kein min()-Crash).
      // Vor 12:00 = reine Baseline (Ursprungsprognose).
      let adjustedKwh = baselineKwh;
      const localHour = getLocalHour(timezone, nowMs);
      const shouldStartEstimation = localHour >= 12;

      let workingDayState: PvForecastDayState = dayState || {
        localDate: today,
        configHash,
        baselineKwh,
        lastWeatherFetchMs: nowMs,
      };

      if (shouldStartEstimation) {
        const lastEstimate = workingDayState.lastAdjustedEstimateMs ?? 0;
        const previousAdjusted =
          typeof workingDayState.adjustedKwh === 'number'
            ? workingDayState.adjustedKwh
            : baselineKwh;

        // Alle 1 Stunde neu rechnen (nur ab Mittag)
        if (!lastEstimate || (nowMs - lastEstimate) >= 60 * 60 * 1000) {
          // estimatedEndMs: sunset − 2h (weniger aggressiv als −3h, Restzeit trotzdem capped)
          if (this.cachedSunset?.sunsetMs) {
            estimatedEndMs = this.cachedSunset.sunsetMs - 2 * 3600 * 1000;
          }

          const curveEstimate = estimateDailyProductionLandingPoint(
            history,
            nowMs,
            estimatedEndMs,
          );

          adjustedKwh = blendAdjustedForecast({
            actualKwh,
            baselineKwh,
            expectedKwhSoFar: forecast.expectedKwhSoFar || 0,
            correctionFactor: forecast.correctionFactor || 1,
            curveEstimate,
            previousAdjustedKwh: previousAdjusted,
            localHour,
          });

          workingDayState = {
            ...workingDayState,
            localDate: today,
            configHash,
            baselineKwh,
            lastWeatherFetchMs: nowMs,
            lastAdjustedEstimateMs: nowMs,
            productionHistory: history,
          };
        } else {
          // Zwischen den Stunden: gespeicherten Wert halten, aber nie unter Ist
          adjustedKwh = Math.max(previousAdjusted, actualKwh);
          workingDayState = {
            ...workingDayState,
            localDate: today,
            configHash,
            baselineKwh,
            lastWeatherFetchMs: nowMs,
            productionHistory: history,
          };
        }
      } else {
        adjustedKwh = baselineKwh;
        workingDayState = {
          localDate: today,
          configHash,
          baselineKwh,
          lastWeatherFetchMs: nowMs,
          productionHistory: history,
        };
      }

      this.publishForecastValues(baselineKwh, adjustedKwh, actualKwh, workingDayState);

      this.syncErrorCount = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
      this.log(
        `PV forecast sync: surfaces=[${this.formatSegmentLog(settings.segments)}] total=${settings.totalKwp} kWp `
        + `baseline=${baselineKwh} kWh adjusted=${adjustedKwh} kWh actual=${actualKwh} kWh `
        + `correction=${forecast.correctionFactor}`,
      );
    } catch (e) {
      this.error('PV forecast sync failed: ' + formatError(e));
      this.syncErrorCount++;
      if (
        this.isMissingLocationError(e)
        || this.isMissingKwpError(e)
        || this.syncErrorCount >= MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE
      ) {
        const message = this.isMissingLocationError(e)
          ? this.homey.__('pv-forecast.errors.missing-location')
          : this.isMissingKwpError(e)
            ? this.homey.__('pv-forecast.errors.missing-kwp')
            : formatError(e);
        await this.setUnavailable(message);
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