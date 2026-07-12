import Homey, {SimpleClass} from 'homey';
import {Wallbox, WallboxCommandResult} from '../../src/model/wallbox';
import { WallboxScheduleHandler } from '../../src/managers/wallbox-schedule-handler';
import { FlowCardManager } from '../../src/cards/flow-card-manager';
import { WallboxChargingManager } from '../../src/managers/wallbox-charging-manager';
import {WallboxEmsSettings} from '../../src/model/wallbox-ems-settings';
import {WallboxLiveState} from '../../src/model/wallbox-live-state';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {RscpApi} from '../../src/rscp-api';
import {formatError} from '../../src/utils/error-utils';
import {wallboxTotalEnergyKwh} from '../../src/utils/energy-meter-integrator';
import {resolveWallboxPowerW} from '../../src/utils/wallbox-power';
import {
  hideCapabilitiesFromTile,
  reorderCapabilitiesIfNeeded,
  WALLBOX_CAPABILITY_ORDER,
  WALLBOX_TILE_HIDDEN_CAPABILITIES,
} from '../../src/utils/capability-order';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import { RunListener } from '../../src/cards/run-listener';
import { WallboxEmsSettingsManager } from '../../src/managers/wallbox-ems-settings-manager';

const WALLBOX_LEGACY_CAPABILITIES = [
  'evcharger_charging',
  'evcharger_charging_state',
  'measure_wallbox_consumption',
  'wallbox_start_charging',
  'wallbox_stop_charging',
  'wallbox_sun_mode_on',
  'wallbox_sun_mode_off',
];

/**
 * WallboxDevice
 *
 * Steuert und überwacht eine einzelne Wallbox am E3DC HKW.
 *
 * Kern-Verantwortlichkeiten:
 * - Synchronisation von Live-State und EMS-Settings auf das Gerät
 * - Registrierung und Ausführung von Flow-Karten (Actions/Conditions/Triggers)
 * - Verarbeitung von Ladeplänen (Wallbox-spezifische Schedules)
 * - Serialisierung von RSCP-Befehlen gegen Race-Conditions aus parallelen Flows
 * - Capability-Management und Tile-Updates (z.B. Ladeplan-Sichtbarkeit)
 *
 * Design-Ziel (Athom Beauty): Dünner Device als Koordinator.
 * Komplexe Logik ist in WallboxManager, Utils und diesem Device (für wallbox-spezifisches) verteilt.
 * Struktur und Typen sollen mit dem HKW-Treiber konsistent sein.
 */
class WallboxDevice extends Homey.Device implements Wallbox {

  private lastSyncedState?: WallboxLiveState;
  private lastSyncedAt = 0;
  private capabilitiesReady = false;
  private wasReadyToCharge = false;

  // Last known good vehicle SOC (always prefer this when current data is implausible)
  private lastPlausibleVehicleSoc?: number;
  private lastSocSource: 'local' | 'cloud' | 'none' = 'none';

  private async loadLastPlausibleSoc(): Promise<void> {
    try {
      const stored = await this.getStoreValue('lastPlausibleVehicleSoc');
      if (typeof stored === 'number' && stored > 0 && stored <= 100) {
        this.lastPlausibleVehicleSoc = stored;
      }
    } catch {}
  }

  private async saveLastPlausibleSoc(value: number): Promise<void> {
    try {
      await this.setStoreValue('lastPlausibleVehicleSoc', value);
    } catch {}
  }

  private async updateVehicleSocTitle(): Promise<void> {
    try {
      // Always show the hint in parentheses under the value, as the displayed
      // value is always the last known good one (or the best available).
      const title = 'Fahrzeug-SOC (letzter bekannter Wert)';
      await this.setCapabilityOptions('measure_vehicle_soc', {
        title,
        units: { en: '%', de: '%' },
        decimals: 0,
        uiComponent: 'sensor'
      });
      this.log(`Vehicle SOC title set to: ${title}`);
    } catch (e) {
      this.error('Failed to set vehicle SOC title: ' + formatError(e));
    }
  }

  private scheduleHandler!: WallboxScheduleHandler;
  private chargingManager!: WallboxChargingManager;
  private emsSettingsManager!: WallboxEmsSettingsManager;


  /**
   * Initializes the WallboxDevice:
   * - Migrates capabilities if needed
   * - Sets up all flow cards (actions, conditions, triggers)
   * - Registers capability listeners for UI changes
   * - Starts the internal Ladeplan scheduler
   */
  async onInit() {
    this.log('WallboxDevice has been initialized');
    try {
      // Run ghost cleanup as early as possible (before full migrate)
      await this.cleanupGhostCapabilities().catch(() => {});

      await this.migrateCapabilities();
      await this.loadLastPlausibleSoc();

      // Immediately set last known good SOC (from previous cloud or local) so the tile shows it right after init/restart
      if (this.lastPlausibleVehicleSoc !== undefined && this.lastPlausibleVehicleSoc > 0) {
        updateCapabilityValue('measure_vehicle_soc', this.lastPlausibleVehicleSoc, this, { force: true });
        this.lastSocSource = 'cloud';
      }

      // Always set the title with the "last known value" hint
      await this.updateVehicleSocTitle();
      this.capabilitiesReady = true;
    } catch (e) {
      this.error('Wallbox onInit failed: ' + formatError(e));
    }
    // Flow cards centralized (reduces device size)
    const flowManager = new FlowCardManager(this as any as import('../../src/types/hps-device').IHpsDevice);
    flowManager.setupWallboxFlowCards(this.homey, this.bindDevice.bind(this));

    this.registerCapabilityListeners();

    this.scheduleHandler = new WallboxScheduleHandler(this);
    this.scheduleHandler.start();

    this.chargingManager = new WallboxChargingManager(
      { log: (m: string) => this.log(m), error: (m: string) => this.error(m) },
      () => this.getApi(),
      () => this.getWallboxId(),
      (state: WallboxLiveState) => this.refreshCapabilities(state),
      this.homey,
    );
    this.emsSettingsManager = new WallboxEmsSettingsManager(this as any);
  }



  private bindDevice(listener: RunListener): (args: Record<string, unknown>, state: unknown) => Promise<unknown> {
    return (args, state) => listener.run({ ...args, device: this }, state);
  }

  /**
   * Registers listeners for tile button presses (charging + sun mode toggle).
   */
  private registerCapabilityListeners(): void {
    this.registerCapabilityListener('wallbox_charging', this.onWallboxChargingSet.bind(this));
    this.registerCapabilityListener('wallbox_sun_mode', this.onWallboxSunModeSet.bind(this));
  }

  private async onWallboxChargingSet(): Promise<void> {
    const current = this.getCapabilityValue('wallbox_charging') === true;
    const newValue = !current;
    const result = await this.applyChargingAllowed(newValue);
    if (!result.ok) {
      this.error('Wallbox charging set via tile failed');
      throw new Error('Charging command failed or not verified');
    }
    this.log(`Wallbox charging toggled via button to ${newValue}`);
  }

  private async onWallboxSunModeSet(): Promise<void> {
    const current = this.getCapabilityValue('wallbox_sun_mode') === true;
    const newValue = !current;
    const result = await this.applySunMode(newValue);
    if (!result.ok) {
      this.error('Wallbox sun mode set via tile failed');
      throw new Error('Sun mode command failed or not verified');
    }
    this.log(`Wallbox sun mode toggled via button to ${newValue}`);
  }

  /**
   * Ensures all required capabilities exist and removes legacy ones.
   * Also sets initial Ladeplan tile visibility.
   * This also aggressively cleans up known "ghost" capabilities that can break the tile and repair view.
   */
  private async migrateCapabilities(): Promise<void> {
    await ensureCapabilities(this, [...WALLBOX_CAPABILITY_ORDER]);
    await reorderCapabilitiesIfNeeded(this, WALLBOX_CAPABILITY_ORDER);

    // Ensure new plan indicator capability for existing devices
    if (!this.hasCapability('wallbox_ladeplan_active')) {
      await this.addCapability('wallbox_ladeplan_active').catch(() => {});
    }
    await this.applyLadeplanTileVisibility();

    // Remove legacy capabilities
    for (const capability of WALLBOX_LEGACY_CAPABILITIES) {
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

    // === AUTOMATIC CLEANUP OF KNOWN BAD CAPABILITIES (even without repair) ===
    // This fixes cases where temporary capabilities (like vehicle_soc_last_known) were added
    // and later removed from the manifest, leaving devices in a broken state.
    const badCapabilities = ['vehicle_soc_last_known', 'evcharger_charging_state'];
    for (const cap of badCapabilities) {
      if (this.hasCapability(cap)) {
        try {
          await this.removeCapability(cap);
          this.log(`Auto-removed ghost capability "${cap}" during sync/init (prevents broken tiles and repair errors)`);
        } catch (e) {
          // Non-fatal – device might still be partially broken, but we tried
          this.error(`Could not auto-remove ghost cap ${cap}: ${formatError(e)}`);
        }
      }
    }
  }

  /**
   * Dynamically hides or shows Ladeplan-related capabilities on the main tile
   * depending on whether an active plan is running.
   */
  async applyLadeplanTileVisibility(): Promise<void> {
    // Hide Ladeplan/EMS indicators only when no active plan.
    // measure_wallbox_discharge_soc (Batterie entladen bis) is now always visible after Fahrzeug-SOC.
    const hasActivePlan = this.scheduleHandler ? this.scheduleHandler.hasActivePlan() : false;
    const ladeplanRelated = ['wallbox_battery_discharge_sun', 'wallbox_battery_discharge_mix'];
    const toHide = hasActivePlan
      ? WALLBOX_TILE_HIDDEN_CAPABILITIES.filter(c => !ladeplanRelated.includes(c))
      : [...WALLBOX_TILE_HIDDEN_CAPABILITIES, ...ladeplanRelated];
    await hideCapabilitiesFromTile(this, toHide);

    // Set explicit indicator capability
    if (this.hasCapability('wallbox_ladeplan_active')) {
      try {
        await this.setCapabilityValue('wallbox_ladeplan_active', hasActivePlan);
      } catch (e) {
        this.error('Failed to set wallbox_ladeplan_active: ' + formatError(e));
      }
    }

    // Always show "Batterie entladen bis" (after Fahrzeug-SOC) on the main tile
    // When a plan is active, change title to make it obvious that a Ladeplan is controlling it.
    if (this.hasCapability('measure_wallbox_discharge_soc')) {
      try {
        const title = hasActivePlan
          ? { en: 'Battery discharge until (by charge plan)', de: 'Batterie entladen bis (durch Ladeplan)' }
          : { en: 'Battery discharge until', de: 'Batterie entladen bis' };
        await this.setCapabilityOptions('measure_wallbox_discharge_soc', {
          uiComponent: 'sensor',
          title
        });
      } catch (e) {
        this.error('Failed to ensure measure_wallbox_discharge_soc visible on tile: ' + formatError(e));
      }
    }
  }

  async onAdded() {
    this.log('WallboxDevice has been added');
  }

  /**
   * Called by WallboxManager when new live data arrives from the HKW.
   * Updates all wallbox-specific capabilities and handles side effects
   * like the "ready to charge" trigger.
   */
  sync(state: WallboxLiveState): void {
    if (!this.capabilitiesReady) {
      return;
    }
    this.lastSyncedState = state;
    this.lastSyncedAt = Date.now();

    // Run ghost-capability cleanup on every sync (automatic, no repair needed)
    this.cleanupGhostCapabilities().catch(() => {});

    const effectivePowerW = resolveWallboxPowerW(state);
    this.updateWallboxCapabilities(state, effectivePowerW);
    this.handleWallboxReadyTrigger(state, effectivePowerW);
  }

  /**
   * Safe, non-blocking cleanup for known problematic ghost capabilities.
   * Called from onInit (via migrate) and from every sync().
   */
  private async cleanupGhostCapabilities(): Promise<void> {
    const bad = ['vehicle_soc_last_known', 'evcharger_charging_state'];
    for (const cap of bad) {
      if (this.hasCapability(cap)) {
        try {
          await this.removeCapability(cap);
          this.log(`Auto-removed ghost capability "${cap}" during sync`);
        } catch (e) {
          // ignore – might be temporary
        }
      }
    }
  }

  /**
   * Aktualisiert alle Wallbox-spezifischen Capabilities basierend auf Live-State.
   */
  private updateWallboxCapabilities(state: WallboxLiveState, effectivePowerW: number): void {
    updateCapabilityValue('measure_power', effectivePowerW, this);
    const meterKwh = wallboxTotalEnergyKwh(state.totalEnergyWh, effectivePowerW, this);
    if (meterKwh !== undefined) {
      updateCapabilityValue('meter_power', meterKwh, this);
    }
    updateCapabilityValue('measure_wallbox_solarshare', state.solarPowerW, this);
    // Vehicle SOC: always show last known good value (with hint in title)
    const socVal = state.socPercent;
    const isPlausible = socVal !== undefined && socVal > 0 && socVal <= 100;

    let valueToSet: number | undefined;
    let isLastKnown = false;

    if (isPlausible) {
      // Fresh good value from local RSCP
      this.lastPlausibleVehicleSoc = socVal;
      this.saveLastPlausibleSoc(socVal).catch(() => {});
      valueToSet = socVal;
      isLastKnown = false;
      this.lastSocSource = 'local';
    } else if (this.lastPlausibleVehicleSoc !== undefined) {
      // Use last known (could be from previous cloud or local)
      valueToSet = this.lastPlausibleVehicleSoc;
      isLastKnown = true;
      this.lastSocSource = 'cloud';
      this.log(`Vehicle SOC: showing last known value ${valueToSet}% (current data implausible)`);
    } else {
      // Nothing available
      valueToSet = 0;
      isLastKnown = false;
      this.lastSocSource = 'none';
      this.log('Vehicle SOC: no plausible value available (showing 0)');
    }

    const socChanged = updateCapabilityValue('measure_vehicle_soc', valueToSet, this, { force: true });

    // Always force the title with the hint so it appears under the value
    this.updateVehicleSocTitle().catch(() => {});

    if (socChanged || isLastKnown) {
      const d = state.socDiagnostics;
      this.log(`Vehicle SOC tile updated to ${valueToSet}% (lastKnown=${isLastKnown}, source=${socVal ?? 'n/a'})`);
    }
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

  private handleWallboxReadyTrigger(state: WallboxLiveState, powerW: number): void {
    const ready = state.plugged && !state.chargingEnabled && Math.abs(powerW) < 50;
    if (ready && !this.wasReadyToCharge) {
      try {
        const card = this.homey.flow.getDeviceTriggerCard('wallbox_ready');
        card.trigger(this, { power: powerW }, { power: powerW })
          .catch(reason => this.error('Wallbox ready trigger failed: ' + formatError(reason)));
      } catch (e) {
        this.error('Wallbox ready trigger card unavailable: ' + formatError(e));
      }
    }
    this.wasReadyToCharge = ready;
  }

  syncEmsSettings(settings: Partial<WallboxEmsSettings>): void {
    if (!this.capabilitiesReady) {
      return;
    }
    const emsUpdates: Array<[string, unknown]> = [
      ['wallbox_priority_battery_first', settings.batteryBeforeCar],
      ['wallbox_battery_discharge_sun', settings.batteryToCarAllowed],
      ['measure_wallbox_discharge_soc', settings.dischargeBatteryUntilPercent],
      ['wallbox_battery_discharge_mix', settings.batteryDischargeMixBlocked !== undefined ? !settings.batteryDischargeMixBlocked : undefined],
    ];
    emsUpdates.forEach(([cap, val]) => {
      if (val !== undefined) {
        updateCapabilityValue(cap, val, this);
      }
    });
  }

  private cachedHps: HomePowerStation | null = null;

  private async getApi(): Promise<RscpApi> {
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config || !config.stationId) {
      return Promise.reject(new Error('Wallbox not associated with a Home Power Station'));
    }
    if (this.cachedHps && (this.cachedHps as any).getId?.() === config.stationId) {
      return this.cachedHps.getApi();
    }
    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices();
    const station = hpsDevices.find((d: unknown) => {
      const dev = d as { getId?: () => string };
      return dev.getId && dev.getId() === config.stationId;
    }) as HomePowerStation | undefined;
    if (!station || !station.getApi) {
      return Promise.reject(new Error('Associated Home Power Station not found or not ready'));
    }
    this.cachedHps = station;
    return station.getApi();
  }

  private getWallboxId(): number {
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config || config.id === undefined || config.id === null) {
      throw new Error('Wallbox RSCP id not configured');
    }
    return Number(config.id);
  }

  private async refreshEmsSettings(): Promise<void> {
    const api = await this.getApi();
    const settings = await api.readWallboxEmsSettings(true, this);
    this.syncEmsSettings(settings);
  }

  private refreshCapabilities(state: WallboxLiveState): void {
    updateCapabilityValue('wallbox_charging', state.chargingEnabled, this);
    updateCapabilityValue('wallbox_sun_mode', state.sunModeActive, this);
  }

  /**
   * Public API to allow or block charging. Delegates to ChargingManager.
   */
  async applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.chargingManager.applyChargingAllowed(enabled, maxCurrentA, force);
  }

  /**
   * Public API to enable/disable sun (PV surplus) mode. Delegates to ChargingManager.
   */
  async applySunMode(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.chargingManager.applySunMode(enabled, maxCurrentA, force);
  }

  /**
   * Sets the max charging current (A) without changing the active mode. Delegates.
   */
  async setCurrentLimit(maxCurrentA: number): Promise<boolean> {
    return this.chargingManager.setCurrentLimit(maxCurrentA);
  }

  // Interface compliance (Wallbox): delegate to manager (even if not called by external code)
  async startCharging(maxCurrentA?: number, chargingCanceled = false): Promise<boolean> {
    return this.chargingManager.startCharging(maxCurrentA, chargingCanceled);
  }

  async stopCharging(chargingCanceled = false): Promise<boolean> {
    return this.chargingManager.stopCharging(chargingCanceled);
  }

  async setSunMode(enabled: boolean, maxCurrentA?: number): Promise<boolean> {
    return this.chargingManager.setSunMode(enabled, maxCurrentA);
  }

  /**
   * System-wide: allow home battery to discharge for car charging.
   */
  async setBatteryToCar(enabled: boolean): Promise<boolean> {
    return this.emsSettingsManager.setBatteryToCar(enabled);
  }

  /**
   * System-wide: prioritize car over home battery.
   */
  async setBatteryBeforeCar(enabled: boolean): Promise<boolean> {
    return this.emsSettingsManager.setBatteryBeforeCar(enabled);
  }

  /**
   * System-wide: minimum home battery SOC before allowing car charging.
   */
  async setDischargeBatteryUntil(percent: number): Promise<boolean> {
    const result = await this.emsSettingsManager.setDischargeBatteryUntil(percent);
    // Invalidate cache so the tile shows the new value immediately and future polls don't revert to stale cache
    this.invalidateAssociatedEmsCache();
    return result;
  }

  /**
   * Returns the currently active "Batterie entladen bis" value (from last synced EMS settings / capability).
   * Used by Wallbox Ladepläne to snapshot the original value before overriding for the plan duration.
   */
  getCurrentDischargeBatteryUntil(): number | undefined {
    const v = this.getCapabilityValue('measure_wallbox_discharge_soc');
    return typeof v === 'number' ? v : undefined;
  }

  /**
   * Invalidate the global EMS settings cache on the associated HKW.
   * Called after a Ladeplan changes the discharge limit so the tile does not
   * get overwritten by a stale cached value on the next live data poll.
   */
  invalidateAssociatedEmsCache(): void {
    // Find the HKW and tell it to drop its EMS cache
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config?.stationId) return;

    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices() as any[];
    const station = hpsDevices.find((d: any) => d.getId && d.getId() === config.stationId);
    if (station && typeof station.invalidateWallboxEmsSettingsCache === 'function') {
      station.invalidateWallboxEmsSettingsCache();
    }
  }

  /**
   * Called by HPS cloud fallback to set a plausible SOC from cloud.
   * Treats it as current value.
   */
  applyCloudVehicleSoc(socPercent: number): void {
    if (socPercent > 0 && socPercent <= 100) {
      this.lastPlausibleVehicleSoc = socPercent;
      this.saveLastPlausibleSoc(socPercent).catch(() => {});
      this.lastSocSource = 'cloud';
      updateCapabilityValue('measure_vehicle_soc', socPercent, this, { force: true });
      this.updateVehicleSocTitle().catch(() => {});
      this.log(`Applied cloud vehicle SOC ${socPercent}% (current value)`);
    }
  }

  /**
   * System-wide: prevent home battery use in wallbox mixed mode.
   */
  async setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean> {
    return this.emsSettingsManager.setDisableBatteryAtMixMode(enabled);
  }

  /**
   * Reacts to settings changes from the UI or widget.
   * Special handling for 'schedules': immediately reverts actions for manually deleted running plans
   * (mirrors the HKW Ladeplaner behavior).
   */
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

    if (changedKeys.includes('schedules')) {
      await this.scheduleHandler.handleManualDeletion(newSettings as Record<string, unknown>);
      // Re-evaluate schedules shortly (new plans may have been added)
      setTimeout(() => this.scheduleHandler.check(), 50);
    }
  }

  async onRenamed(name: string) {
    this.log('WallboxDevice was renamed');
  }

  async onDeleted() {
    this.log('WallboxDevice has been deleted');
    if (this.scheduleHandler) this.scheduleHandler.stop();
  }

  asSimple(): SimpleClass {
    return this;
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }

  hasActivePlan(): boolean {
    return this.scheduleHandler ? this.scheduleHandler.hasActivePlan() : false;
  }

}

module.exports = WallboxDevice;
