import Homey, {SimpleClass} from 'homey';
import {Wallbox, WallboxCommandResult} from '../../src/model/wallbox';
import {WallboxEmsSettings} from '../../src/model/wallbox-ems-settings';
import {WallboxLiveState} from '../../src/model/wallbox-live-state';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {RscpApi} from '../../src/rscp-api';
import {
  isChargingAlreadyAllowed,
  isChargingAlreadyBlocked,
  isSunModeAlreadyActive,
  isSunModeAlreadyInactive,
} from '../../src/utils/wallbox-command-guard';
import {formatError} from '../../src/utils/error-utils';
import {wallboxTotalEnergyKwh} from '../../src/utils/energy-meter-integrator';
import {resolveWallboxPowerW} from '../../src/utils/wallbox-power';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';

const SYNC_CACHE_MAX_AGE_MS = 30_000;

/** Must match drivers/wallbox/driver.compose.json — existing devices may lack caps added in later releases. */
const WALLBOX_DRIVER_CAPABILITIES = [
  'measure_power',
  'meter_power',
  'wallbox_charging',
  'wallbox_sun_mode',
  'measure_wallbox_solarshare',
  'measure_wallbox_max_current',
  'measure_wallbox_phases',
  'wallbox_plugged',
  'wallbox_plug_locked',
  'wallbox_schuko',
  'wallbox_priority_battery_first',
  'wallbox_battery_discharge_sun',
  'measure_wallbox_discharge_soc',
  'wallbox_battery_discharge_mix',
] as const;

class WallboxDevice extends Homey.Device implements Wallbox {

  private lastSyncedState?: WallboxLiveState;
  private lastSyncedAt = 0;
  private capabilitiesReady = false;

  async onInit() {
    this.log('WallboxDevice has been initialized');
    try {
      await this.migrateCapabilities();
      this.capabilitiesReady = true;
    } catch (e) {
      this.error('Wallbox onInit failed: ' + formatError(e));
    }
  }

  private async migrateCapabilities(): Promise<void> {
    await ensureCapabilities(this, [...WALLBOX_DRIVER_CAPABILITIES]);
    const legacyCapabilities = [
      'evcharger_charging',
      'evcharger_charging_state',
      'measure_wallbox_consumption',
      'measure_vehicle_soc',
    ];
    for (const capability of legacyCapabilities) {
      if (!this.hasCapability(capability)) {
        continue;
      }
      try {
        await this.removeCapability(capability);
        this.log(`Removed legacy capability ${capability}`);
      } catch (e) {
        this.error(`Failed to remove legacy capability ${capability}: ${formatError(e)}`);
      }
    }
  }

  async onAdded() {
    this.log('WallboxDevice has been added');
  }

  sync(state: WallboxLiveState): void {
    if (!this.capabilitiesReady) {
      return;
    }
    this.lastSyncedState = state;
    this.lastSyncedAt = Date.now();

    const effectivePowerW = resolveWallboxPowerW(state);
    updateCapabilityValue('measure_power', effectivePowerW, this);
    const meterKwh = wallboxTotalEnergyKwh(state.totalEnergyWh, effectivePowerW, this);
    if (meterKwh !== undefined) {
      updateCapabilityValue('meter_power', meterKwh, this);
    }
    updateCapabilityValue('measure_wallbox_solarshare', state.solarPowerW, this);
    updateCapabilityValue('wallbox_charging', state.chargingEnabled, this);
    updateCapabilityValue('wallbox_sun_mode', state.sunModeActive, this);

    updateCapabilityValue('wallbox_plugged', state.plugged, this);
    updateCapabilityValue('wallbox_plug_locked', state.plugLocked, this);
    updateCapabilityValue('wallbox_schuko', state.schukoOn, this);

    if (state.maxCurrentA !== undefined) {
      updateCapabilityValue('measure_wallbox_max_current', state.maxCurrentA, this);
    }
    if (state.activePhases !== undefined) {
      updateCapabilityValue('measure_wallbox_phases', state.activePhases, this);
    }
  }

  syncEmsSettings(settings: Partial<WallboxEmsSettings>): void {
    if (!this.capabilitiesReady) {
      return;
    }
    if (settings.batteryBeforeCar !== undefined) {
      updateCapabilityValue('wallbox_priority_battery_first', settings.batteryBeforeCar, this);
    }
    if (settings.batteryToCarAllowed !== undefined) {
      updateCapabilityValue('wallbox_battery_discharge_sun', settings.batteryToCarAllowed, this);
    }
    if (settings.dischargeBatteryUntilPercent !== undefined) {
      updateCapabilityValue('measure_wallbox_discharge_soc', settings.dischargeBatteryUntilPercent, this);
    }
    if (settings.batteryDischargeMixBlocked !== undefined) {
      updateCapabilityValue('wallbox_battery_discharge_mix', !settings.batteryDischargeMixBlocked, this);
    }
  }

  private getApi(): Promise<RscpApi> {
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config || !config.stationId) {
      return Promise.reject(new Error('Wallbox not associated with a Home Power Station'));
    }
    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices();
    const station = hpsDevices.find((d: any) => d.getId && d.getId() === config.stationId) as unknown as HomePowerStation | undefined;
    if (!station || !station.getApi) {
      return Promise.reject(new Error('Associated Home Power Station not found or not ready'));
    }
    return Promise.resolve(station.getApi());
  }

  private getWallboxId(): number {
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config || config.id === undefined || config.id === null) {
      throw new Error('Wallbox RSCP id not configured');
    }
    return Number(config.id);
  }

  private getCachedValue(readValue: (state: WallboxLiveState) => boolean): boolean | undefined {
    if (!this.lastSyncedState || Date.now() - this.lastSyncedAt > SYNC_CACHE_MAX_AGE_MS) {
      return undefined;
    }
    return readValue(this.lastSyncedState);
  }

  private async fetchLiveState(): Promise<WallboxLiveState> {
    const api = await this.getApi();
    const state = await api.readWallboxLiveStateById(this.getWallboxId(), true, this);
    this.lastSyncedState = state;
    this.lastSyncedAt = Date.now();
    return state;
  }

  private refreshCapabilities(state: WallboxLiveState): void {
    updateCapabilityValue('wallbox_charging', state.chargingEnabled, this);
    updateCapabilityValue('wallbox_sun_mode', state.sunModeActive, this);
  }

  private async refreshEmsSettings(): Promise<void> {
    const api = await this.getApi();
    const settings = await api.readWallboxEmsSettings(true, this);
    this.syncEmsSettings(settings);
  }

  async applyChargingAllowed(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult> {
    const tileAllowed = !!this.getCapabilityValue('wallbox_charging');

    if (enabled === tileAllowed) {
      this.log(`applyChargingAllowed(${enabled}): skip, tile already matches (tile=${tileAllowed})`);
      return { ok: true, skipped: true };
    }

    const live = await this.fetchLiveState();
    const cached = this.getCachedValue(state => state.chargingEnabled);

    if (enabled && isChargingAlreadyAllowed(live, cached, tileAllowed)) {
      this.log(
        `applyChargingAllowed(${enabled}): skip after read (live=${live.chargingEnabled}, `
        + `cached=${cached}, tile=${tileAllowed})`,
      );
      this.refreshCapabilities(live);
      return { ok: true, skipped: true };
    }
    if (!enabled && isChargingAlreadyBlocked(live, cached, tileAllowed)) {
      this.log(
        `applyChargingAllowed(${enabled}): skip after read (live=${live.chargingEnabled}, `
        + `cached=${cached}, tile=${tileAllowed})`,
      );
      this.refreshCapabilities(live);
      return { ok: true, skipped: true };
    }

    const ok = enabled
      ? await this.startCharging(maxCurrentA)
      : await this.stopCharging();
    if (!ok) {
      return { ok: false, skipped: false };
    }

    const after = await this.fetchLiveState();
    this.refreshCapabilities(after);
    return { ok: true, skipped: false };
  }

  async applySunMode(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult> {
    const tileActive = !!this.getCapabilityValue('wallbox_sun_mode');

    if (enabled === tileActive) {
      this.log(`applySunMode(${enabled}): skip, tile already matches (tile=${tileActive})`);
      return { ok: true, skipped: true };
    }

    const live = await this.fetchLiveState();
    const cached = this.getCachedValue(state => state.sunModeActive);

    if (enabled && isSunModeAlreadyActive(live, cached, tileActive)) {
      this.log(
        `applySunMode(${enabled}): skip after read (live=${live.sunModeActive}, `
        + `cached=${cached}, tile=${tileActive})`,
      );
      this.refreshCapabilities(live);
      return { ok: true, skipped: true };
    }
    if (!enabled && isSunModeAlreadyInactive(live, cached, tileActive)) {
      this.log(
        `applySunMode(${enabled}): skip after read (live=${live.sunModeActive}, `
        + `cached=${cached}, tile=${tileActive})`,
      );
      this.refreshCapabilities(live);
      return { ok: true, skipped: true };
    }

    const ok = await this.setSunMode(enabled, maxCurrentA);
    if (!ok) {
      return { ok: false, skipped: false };
    }

    const after = await this.fetchLiveState();
    this.refreshCapabilities(after);
    return { ok: true, skipped: false };
  }

  async setCurrentLimit(maxCurrentA: number): Promise<boolean> {
    const api = await this.getApi();
    return api.setWallboxCurrentLimit(this.getWallboxId(), maxCurrentA, true, this);
  }

  async startCharging(maxCurrentA?: number): Promise<boolean> {
    const api = await this.getApi();
    return api.startWallboxCharging(this.getWallboxId(), maxCurrentA, true, this);
  }

  async stopCharging(): Promise<boolean> {
    const api = await this.getApi();
    return api.stopWallboxCharging(this.getWallboxId(), true, this);
  }

  async setSunMode(enabled: boolean, maxCurrentA?: number): Promise<boolean> {
    const api = await this.getApi();
    return api.setWallboxSunMode(this.getWallboxId(), enabled, maxCurrentA, true, this);
  }

  async setBatteryToCar(enabled: boolean): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setBatteryToCarMode(enabled, true, this);
    if (ok) {
      await this.refreshEmsSettings().catch(e => {
        this.log('refreshEmsSettings after setBatteryToCar failed: ' + formatError(e));
      });
    }
    return ok;
  }

  async setBatteryBeforeCar(enabled: boolean): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setBatteryBeforeCarMode(enabled, true, this);
    if (ok) {
      await this.refreshEmsSettings().catch(e => {
        this.log('refreshEmsSettings after setBatteryBeforeCar failed: ' + formatError(e));
      });
    }
    return ok;
  }

  async setDischargeBatteryUntil(percent: number): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setWbDischargeBatteryUntil(percent, true, this);
    if (ok) {
      await this.refreshEmsSettings().catch(e => {
        this.log('refreshEmsSettings after setDischargeBatteryUntil failed: ' + formatError(e));
      });
    }
    return ok;
  }

  async setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setWallboxDisableBatteryAtMixMode(enabled, true, this);
    if (ok) {
      await this.refreshEmsSettings().catch(e => {
        this.log('refreshEmsSettings after setDisableBatteryAtMixMode failed: ' + formatError(e));
      });
    }
    return ok;
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log('WallboxDevice settings were changed');
  }

  async onRenamed(name: string) {
    this.log('WallboxDevice was renamed');
  }

  async onDeleted() {
    this.log('WallboxDevice has been deleted');
  }

  asSimple(): SimpleClass {
    return this;
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }

}

module.exports = WallboxDevice;
