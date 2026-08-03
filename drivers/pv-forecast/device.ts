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
  applyBaselineDayScale,
  blendAdjustedForecast,
  calculateMultiSegmentPvForecast,
  DEFAULT_BASELINE_DAY_SCALE,
  estimateProductionEndMs,
  getLocalHour,
  localDateString,
  monotoneActualKwh,
  nextCorrectionEma,
  recentProductionRateKwhPerHour,
  roundKwh,
  shouldReanticipateAdjusted,
  updateDayScaleFromOutcome,
} from '../../src/utils/pv-forecast-calculator';
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
/** Cross-day learned baseline scale (actual/rawBaseline EMA). */
const STORE_DAY_SCALE_KEY = 'pvForecastDayScale';

type WeatherCache = Record<string, DailyIrradianceForecast>;

class PvForecastDevice extends Homey.Device {

  private loopId: NodeJS.Timeout | null = null;
  private syncErrorCount = 0;
  private cachedWeather: WeatherCache = {};

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

  private loadLearnedDayScale(): number {
    const stored = this.getStoreValue(STORE_DAY_SCALE_KEY);
    if (typeof stored === 'number' && Number.isFinite(stored)) {
      return stored;
    }
    return DEFAULT_BASELINE_DAY_SCALE;
  }

  private saveLearnedDayScale(scale: number): void {
    this.setStoreValue(STORE_DAY_SCALE_KEY, scale).catch(reason => {
      this.error('Failed to store pv forecast day scale: ' + formatError(reason));
    });
  }

  private restoreDisplayFromCache(): void {
    const timezone = this.homey.clock.getTimezone();
    const settings = readPvForecastSettings(this);
    const dayState = this.loadDayState(localDateString(timezone), pvForecastConfigHash(settings));
    if (!dayState) {
      return;
    }
    const baselineDisplay =
      dayState.baselineDisplayKwh
      ?? applyBaselineDayScale(dayState.baselineKwh, dayState.dayScale ?? this.loadLearnedDayScale());
    if (baselineDisplay != null) {
      updateCapabilityValue('measure_pv_forecast_baseline', baselineDisplay, this);
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
    baselineDisplayKwh: number,
    adjustedKwh: number,
    actualKwh: number,
    dayState: PvForecastDayState,
  ): void {
    updateCapabilityValue('measure_pv_forecast_baseline', baselineDisplayKwh, this);
    updateCapabilityValue('measure_pv_forecast_adjusted', adjustedKwh, this);
    updateCapabilityValue('measure_pv_actual_today', actualKwh, this);
    this.saveDayState({
      ...dayState,
      baselineDisplayKwh,
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

      const rawActualKwh = await this.readActualPvTodayKwh(station, timezone);
      // Monotone "today" counter (Insights / summary glitches must not lower E)
      const actualKwh = monotoneActualKwh(dayState?.actualKwh, rawActualKwh);

      // Wetter-Modell (raw); f nutzt Ist vs. Modell-bisher
      const forecast = calculateMultiSegmentPvForecast(
        segmentInputs,
        settings.calibrationFactor,
        settings.performanceRatio,
        nowMs,
        actualKwh,
      );

      const learnedScale = dayState?.dayScale ?? this.loadLearnedDayScale();

      // Baseline: morgens einmal raw einfrieren, Anzeige = raw × dayScale
      let baselineRawKwh = dayState?.baselineKwh;
      if (baselineRawKwh == null) {
        baselineRawKwh = forecast.baselineKwh;
      }
      const baselineDisplayKwh = applyBaselineDayScale(baselineRawKwh, learnedScale);

      // Historie monoton
      let history = [...(dayState?.productionHistory || [])];
      const lastHist = history[history.length - 1];
      if (!lastHist || nowMs - lastHist.ts > 4 * 60 * 1000) {
        const histKwh = monotoneActualKwh(lastHist?.kwh, actualKwh);
        history.push({ ts: nowMs, kwh: histKwh });
      }
      const trimStart = nowMs - 10 * 3600 * 1000;
      history = history.filter(p => p.ts >= trimStart);

      // === Nachberechnung ab 12:00; davor = skalierte Baseline ===
      let adjustedKwh = baselineDisplayKwh;
      const localHour = getLocalHour(timezone, nowMs);
      const shouldStartEstimation = localHour >= 12;
      // Last meaningful PV from irradiance series (GTI>15); residual tapered in last 2 h
      let productionEndMs = nowMs;
      for (const segment of segmentInputs) {
        productionEndMs = Math.max(productionEndMs, estimateProductionEndMs(segment.hours, nowMs));
      }
      const hoursUntilProductionEnd = (productionEndMs - nowMs) / 3600000;

      let workingDayState: PvForecastDayState = {
        ...(dayState || {
          localDate: today,
          configHash,
          baselineKwh: baselineRawKwh,
          lastWeatherFetchMs: nowMs,
        }),
        localDate: today,
        configHash,
        baselineKwh: baselineRawKwh,
        baselineDisplayKwh,
        dayScale: learnedScale,
        lastWeatherFetchMs: nowMs,
        productionHistory: history,
        actualKwh,
      };

      if (shouldStartEstimation) {
        const lastEstimate = workingDayState.lastAdjustedEstimateMs ?? 0;
        const previousAdjusted =
          typeof workingDayState.adjustedKwh === 'number'
            ? workingDayState.adjustedKwh
            : baselineDisplayKwh;
        const remainingWeather = forecast.remainingWeatherKwh || 0;
        const reanticipate = shouldReanticipateAdjusted({
          actualKwh,
          previousAdjustedKwh: previousAdjusted,
          remainingWeatherKwh: remainingWeather,
          hoursUntilProductionEnd,
        });
        const hourElapsed = !lastEstimate || (nowMs - lastEstimate) >= 60 * 60 * 1000;
        // Recompute end-of-day A hourly, or immediately when Ist overtook A / uncatchable under A.
        // Do NOT glue A to actual between ticks (that only "tracks" production).
        const shouldRecompute = hourElapsed || reanticipate !== 'none';

        if (shouldRecompute) {
          const correctionEma = nextCorrectionEma(
            actualKwh,
            forecast.expectedKwhSoFar || 0,
            workingDayState.correctionEma,
          );
          // Pace from production history caps optimistic Open-Meteo residual
          const recentRate = recentProductionRateKwhPerHour(history, nowMs);
          adjustedKwh = blendAdjustedForecast({
            actualKwh,
            baselineKwh: baselineDisplayKwh,
            expectedKwhSoFar: forecast.expectedKwhSoFar || 0,
            correctionFactor: correctionEma,
            remainingWeatherKwh: remainingWeather,
            previousAdjustedKwh: previousAdjusted,
            previousCorrectionEma: workingDayState.correctionEma,
            localHour,
            hoursUntilProductionEnd,
            reanticipate,
            recentRateKwhPerHour: recentRate,
          });

          workingDayState = {
            ...workingDayState,
            lastAdjustedEstimateMs: nowMs,
            correctionEma,
            adjustedKwh,
          };
        } else {
          // Hold anticipatory A until next hour / re-anticipate trigger
          adjustedKwh = Math.max(previousAdjusted, actualKwh);
          // Only lift floor with actual; never clamp residual away between ticks
          workingDayState = {
            ...workingDayState,
            adjustedKwh,
          };
        }
      } else {
        adjustedKwh = baselineDisplayKwh;
        workingDayState = {
          ...workingDayState,
          adjustedKwh,
        };
      }

      // End-of-day: learn scale from raw baseline vs monotone actual
      if (localHour >= 20 && !workingDayState.dayScaleLearned && baselineRawKwh >= 5 && actualKwh >= 3) {
        const newScale = updateDayScaleFromOutcome(learnedScale, baselineRawKwh, actualKwh);
        this.saveLearnedDayScale(newScale);
        workingDayState = {
          ...workingDayState,
          dayScale: newScale,
          dayScaleLearned: true,
        };
        this.log(
          `PV forecast day-scale learn: actual=${actualKwh} rawB=${baselineRawKwh} `
          + `ratio=${(actualKwh / baselineRawKwh).toFixed(3)} scale ${learnedScale}→${newScale}`,
        );
      }

      this.publishForecastValues(baselineDisplayKwh, adjustedKwh, actualKwh, workingDayState);

      this.syncErrorCount = 0;
      if (!this.getAvailable()) {
        await this.setAvailable();
      }
      this.log(
        `PV forecast sync: surfaces=[${this.formatSegmentLog(settings.segments)}] total=${settings.totalKwp} kWp `
        + `rawB=${baselineRawKwh} dispB=${baselineDisplayKwh} scale=${learnedScale} `
        + `adjusted=${adjustedKwh} actual=${actualKwh} (raw=${rawActualKwh}) `
        + `f=${forecast.correctionFactor} fEma=${workingDayState.correctionEma ?? '—'} `
        + `R=${forecast.remainingWeatherKwh} endIn=${hoursUntilProductionEnd.toFixed(1)}h`,
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