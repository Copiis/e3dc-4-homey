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

  private scheduleHandler!: WallboxScheduleHandler;
  private chargingManager!: WallboxChargingManager;


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
      await this.migrateCapabilities();
      this.capabilitiesReady = true;
    } catch (e) {
      this.error('Wallbox onInit failed: ' + formatError(e));
    }
    // Flow cards centralized (reduces device size)
    const flowManager = new FlowCardManager(this as any); // Wallbox uses different interface than HKW's IHpsDevice
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
   */
  private async migrateCapabilities(): Promise<void> {
    await ensureCapabilities(this, [...WALLBOX_CAPABILITY_ORDER]);
    await reorderCapabilitiesIfNeeded(this, WALLBOX_CAPABILITY_ORDER);
    await this.applyLadeplanTileVisibility();
    const legacyCapabilities = [
      'evcharger_charging',
      'evcharger_charging_state',
      'measure_wallbox_consumption',
      'measure_vehicle_soc',
      'wallbox_start_charging',
      'wallbox_stop_charging',
      'wallbox_sun_mode_on',
      'wallbox_sun_mode_off',
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

  /**
   * Dynamically hides or shows Ladeplan-related capabilities on the main tile
   * depending on whether an active plan is running.
   */
  async applyLadeplanTileVisibility(): Promise<void> {
    // Remove Ladepläne/EMS from main tile if not important (no active plan)
    const hasActivePlan = this.scheduleHandler ? this.scheduleHandler.hasActivePlan() : false;
    const ladeplanRelated = ['measure_wallbox_discharge_soc', 'wallbox_battery_discharge_sun', 'wallbox_battery_discharge_mix'];
    const toHide = hasActivePlan
      ? WALLBOX_TILE_HIDDEN_CAPABILITIES.filter(c => !ladeplanRelated.includes(c))
      : [...WALLBOX_TILE_HIDDEN_CAPABILITIES, ...ladeplanRelated];
    await hideCapabilitiesFromTile(this, toHide);
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

    const effectivePowerW = resolveWallboxPowerW(state);
    this.updateWallboxCapabilities(state, effectivePowerW);
    this.handleWallboxReadyTrigger(state, effectivePowerW);
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

  private getApi(): Promise<RscpApi> {
    const config: WallboxConfig = this.getStoreValue('settings');
    if (!config || !config.stationId) {
      return Promise.reject(new Error('Wallbox not associated with a Home Power Station'));
    }
    const hpsDevices = this.homey.drivers.getDriver('home-power-station').getDevices();
    const station = hpsDevices.find((d: unknown) => {
      const dev = d as { getId?: () => string };
      return dev.getId && dev.getId() === config.stationId;
    }) as HomePowerStation | undefined;
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
    const api = await this.getApi();
    const ok = await api.setBatteryToCarMode(enabled, true, this);
    await this.refreshEmsAfterApiCall(ok, 'setBatteryToCar');
    return ok;
  }

  /**
   * System-wide: prioritize car over home battery.
   */
  async setBatteryBeforeCar(enabled: boolean): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setBatteryBeforeCarMode(enabled, true, this);
    await this.refreshEmsAfterApiCall(ok, 'setBatteryBeforeCar');
    return ok;
  }

  /**
   * System-wide: minimum home battery SOC before allowing car charging.
   */
  async setDischargeBatteryUntil(percent: number): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setWbDischargeBatteryUntil(percent, true, this);
    await this.refreshEmsAfterApiCall(ok, 'setDischargeBatteryUntil');
    return ok;
  }

  /**
   * System-wide: prevent home battery use in wallbox mixed mode.
   */
  async setDisableBatteryAtMixMode(enabled: boolean): Promise<boolean> {
    const api = await this.getApi();
    const ok = await api.setWallboxDisableBatteryAtMixMode(enabled, true, this);
    await this.refreshEmsAfterApiCall(ok, 'setDisableBatteryAtMixMode');
    return ok;
  }

  private async refreshEmsAfterApiCall(ok: boolean, method: string): Promise<void> {
    if (ok) {
      await this.refreshEmsSettings().catch(e => {
        this.log(`refreshEmsSettings after ${method} failed: ` + formatError(e));
      });
    }
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
