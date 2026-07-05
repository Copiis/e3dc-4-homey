import Homey, {SimpleClass} from 'homey';
import {Wallbox, WallboxCommandResult} from '../../src/model/wallbox';
import { WallboxScheduleHandler } from '../../src/managers/wallbox-schedule-handler';
import {WallboxEmsSettings} from '../../src/model/wallbox-ems-settings';
import {WallboxLiveState} from '../../src/model/wallbox-live-state';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {RscpApi} from '../../src/rscp-api';
import {formatError} from '../../src/utils/error-utils';
import {RunListener} from '../../src/cards/run-listener';
import {SetWallboxCurrentActionCard} from '../../src/cards/action/set-wallbox-current.action.card';
import {WallboxSetSunModeActionCard} from '../../src/cards/action/wallbox-set-sun-mode.action.card';
import {WallboxAllowChargingActionCard} from '../../src/cards/action/wallbox-allow-charging.action.card';
import {WallboxBlockChargingActionCard} from '../../src/cards/action/wallbox-block-charging.action.card';
import {WallboxSunModeOnActionCard} from '../../src/cards/action/wallbox-sun-mode-on.action.card';
import {WallboxSunModeOffActionCard} from '../../src/cards/action/wallbox-sun-mode-off.action.card';
import {WallboxBatteryToCarActionCard} from '../../src/cards/action/wallbox-battery-to-car.action.card';
import {WallboxBatteryBeforeCarActionCard} from '../../src/cards/action/wallbox-battery-before-car.action.card';
import {WallboxDischargeBatteryUntilActionCard} from '../../src/cards/action/wallbox-discharge-battery-until.action.card';
import {WallboxDisableBatteryMixModeActionCard} from '../../src/cards/action/wallbox-disable-battery-mix-mode.action.card';
import {WallboxSunModeIsActiveConditionCard} from '../../src/cards/condition/wallbox-sun-mode-is-active.condition.card';
import {WallboxSunModeIsOffConditionCard} from '../../src/cards/condition/wallbox-sun-mode-is-off.condition.card';
import {WallboxChargingIsAllowedConditionCard} from '../../src/cards/condition/wallbox-charging-is-allowed.condition.card';
import {WallboxChargingIsBlockedConditionCard} from '../../src/cards/condition/wallbox-charging-is-blocked.condition.card';
import {wallboxTotalEnergyKwh} from '../../src/utils/energy-meter-integrator';
import {resolveWallboxPowerW} from '../../src/utils/wallbox-power';
import {
  hideCapabilitiesFromTile,
  reorderCapabilitiesIfNeeded,
  WALLBOX_CAPABILITY_ORDER,
  WALLBOX_TILE_HIDDEN_CAPABILITIES,
} from '../../src/utils/capability-order';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import {
  isWallboxMixedChargingAllowed,
  wallboxChargingAllowSucceeded,
  wallboxChargingBlockSucceeded,
} from '../../src/utils/wallbox-charging-state';

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

  /**
   * Serializer for RSCP commands to prevent races from concurrent flows.
   */
  private _commandChain: Promise<unknown> = Promise.resolve();

  private scheduleHandler!: WallboxScheduleHandler;

  /**
   * Serializes RSCP commands to avoid overlapping calls from concurrent flows.
   * This prevents race conditions when multiple flows try to control the wallbox at the same time.
   */
  private async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._commandChain.then(fn).catch(err => {
      this.error('Wallbox command chain error: ' + formatError(err));
      throw err;
    });
    this._commandChain = result.catch(() => undefined);
    return result;
  }

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
    this.setupFlowCards();
    this.registerCapabilityListeners();

    this.scheduleHandler = new WallboxScheduleHandler(this);
    this.scheduleHandler.start();
  }



  /**
   * Core logic for Wallbox Ladepläne.
   * - Parses schedules from settings
   * - Reverts actions for manually deleted plans
   * - Applies active plans (with force for Ladeplan)
   * - Handles untilFull / vehicle SOC conditions
   * - Auto-cleans expired plans
   * - Updates tile visibility only on state change
   */
  private async checkWallboxSchedules() {
    await this.scheduleHandler.check();
  }
  

  private bindDevice(listener: RunListener): (args: Record<string, unknown>, state: unknown) => Promise<unknown> {
    return (args, state) => listener.run({ ...args, device: this }, state);
  }

  /**
   * Registers all wallbox-specific flow cards (actions + conditions).
   * Uses bindDevice to ensure the listener receives the correct device instance.
   */
  private setupFlowCards(): void {
    const conditions: Array<{ id: string, listener: RunListener }> = [
      { id: 'wallbox_sun_mode_is_active', listener: new WallboxSunModeIsActiveConditionCard() },
      { id: 'wallbox_sun_mode_is_off', listener: new WallboxSunModeIsOffConditionCard() },
      { id: 'wallbox_charging_is_allowed', listener: new WallboxChargingIsAllowedConditionCard() },
      { id: 'wallbox_charging_is_blocked', listener: new WallboxChargingIsBlockedConditionCard() },
    ];
    conditions.forEach(({ id, listener }) => {
      try {
        this.homey.flow.getConditionCard(id).registerRunListener(this.bindDevice(listener));
      } catch (e) {
        this.error(`Condition card ${id} not registered: ` + formatError(e));
      }
    });

    const actions: Array<{ id: string, listener: RunListener }> = [
      { id: 'wallbox_allow_charging', listener: new WallboxAllowChargingActionCard() },
      { id: 'wallbox_block_charging', listener: new WallboxBlockChargingActionCard() },
      { id: 'wallbox_sun_mode_on', listener: new WallboxSunModeOnActionCard() },
      { id: 'wallbox_sun_mode_off', listener: new WallboxSunModeOffActionCard() },
      { id: 'set_wallbox_current', listener: new SetWallboxCurrentActionCard() },
      { id: 'wallbox_set_sun_mode', listener: new WallboxSetSunModeActionCard() },
      { id: 'wallbox_battery_to_car', listener: new WallboxBatteryToCarActionCard() },
      { id: 'wallbox_battery_before_car', listener: new WallboxBatteryBeforeCarActionCard() },
      { id: 'wallbox_discharge_battery_until', listener: new WallboxDischargeBatteryUntilActionCard() },
      { id: 'wallbox_disable_battery_mix_mode', listener: new WallboxDisableBatteryMixModeActionCard() },
    ];
    actions.forEach(({ id, listener }) => {
      try {
        this.homey.flow.getActionCard(id).registerRunListener(this.bindDevice(listener));
      } catch (e) {
        this.error(`Action card ${id} not registered: ` + formatError(e));
      }
    });
  }

  /**
   * Registers listeners for tile button presses (charging + sun mode toggle).
   */
  private registerCapabilityListeners(): void {
    this.registerCapabilityListener('wallbox_charging', this.onWallboxChargingSet.bind(this));
    this.registerCapabilityListener('wallbox_sun_mode', this.onWallboxSunModeSet.bind(this));
  }

  private async onWallboxChargingSet(value: boolean): Promise<void> {
    // Button press toggles the state (for button uiComponent)
    const current = this.getCapabilityValue('wallbox_charging') === true;
    const newValue = !current;
    const result = await this.applyChargingAllowed(newValue);
    if (!result.ok) {
      this.error('Wallbox charging set via tile failed');
      throw new Error('Charging command failed or not verified');
    }
    this.log(`Wallbox charging toggled via button to ${newValue}`);
  }

  private async onWallboxSunModeSet(value: boolean): Promise<void> {
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

  private static readonly LIVE_STATE_VERIFY_DELAYS_MS = [1000, 2500, 5000];

  private async waitForLiveStateMatch(
    matches: (state: WallboxLiveState) => boolean,
    label: string,
  ): Promise<WallboxLiveState> {
    let last = await this.fetchLiveState();
    if (matches(last)) {
      this.log(`${label}: verified immediately (${this.formatWallboxAlgLog(last)})`);
      return last;
    }

    for (const delayMs of WallboxDevice.LIVE_STATE_VERIFY_DELAYS_MS) {
      await new Promise(resolve => this.homey.setTimeout(resolve, delayMs));
      last = await this.fetchLiveState();
      if (matches(last)) {
        this.log(`${label}: verified after ${delayMs}ms (${this.formatWallboxAlgLog(last)})`);
        return last;
      }
    }

    this.log(`${label}: state unchanged after retries (${this.formatWallboxAlgLog(last)})`);
    return last;
  }

  private formatWallboxAlgLog(state: WallboxLiveState): string {
    const hex = state.socDiagnostics?.algHex ?? 'n/a';
    return `chargingEnabled=${state.chargingEnabled}, chargingCanceled=${state.chargingCanceled}, `
      + `sunMode=${state.sunModeActive}, chargingActive=${state.chargingActive}, algHex=${hex}`;
  }

  /**
   * Public API to allow or block charging.
   * Used by flows, tile, and internal schedule logic.
   */
  async applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.serialize(() => this._applyChargingAllowed(enabled, maxCurrentA, force));
  }

  private async _applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();

    if (!force) {
      if (enabled && isWallboxMixedChargingAllowed(live)) {
        this.log(`applyChargingAllowed(${enabled}): skip, RSCP already allowed (${this.formatWallboxAlgLog(live)})`);
        this.refreshCapabilities(live);
        return { ok: true, skipped: true };
      }
      if (!enabled && wallboxChargingBlockSucceeded(live)) {
        this.log(`applyChargingAllowed(${enabled}): skip, RSCP already blocked (${this.formatWallboxAlgLog(live)})`);
        this.refreshCapabilities(live);
        return { ok: true, skipped: true };
      }
    }

    this.log(`applyChargingAllowed(${enabled}): sending RSCP (force=${force}) (${this.formatWallboxAlgLog(live)})`);
    const ok = enabled
      ? await this.startCharging(maxCurrentA, live.chargingCanceled)
      : await this.stopCharging(live.chargingCanceled);
    if (!ok) {
      return { ok: false, skipped: false };
    }

    const after = await this.waitForLiveStateMatch(
      state => enabled
        ? wallboxChargingAllowSucceeded(live, state)
        : wallboxChargingBlockSucceeded(state),
      `applyChargingAllowed(${enabled})`,
    );
    this.refreshCapabilities(after);
    if (enabled && !wallboxChargingAllowSucceeded(live, after)) {
      this.error(`applyChargingAllowed: RSCP did not allow charging (${this.formatWallboxAlgLog(after)})`);
      return { ok: false, skipped: false };
    }
    if (!enabled && !wallboxChargingBlockSucceeded(after)) {
      this.error(`applyChargingAllowed: RSCP did not block charging (${this.formatWallboxAlgLog(after)})`);
      return { ok: false, skipped: false };
    }
    this.log(`applyChargingAllowed(${enabled}): success (${this.formatWallboxAlgLog(after)})`);
    return { ok: true, skipped: false };
  }

  /**
   * Public API to enable/disable sun (PV surplus) mode.
   */
  async applySunMode(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.serialize(() => this._applySunMode(enabled, maxCurrentA, force));
  }

  private async _applySunMode(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();

    if (!force) {
      if (enabled && live.sunModeActive) {
        this.log(`applySunMode(${enabled}): skip, RSCP sun mode already active (${this.formatWallboxAlgLog(live)})`);
        this.refreshCapabilities(live);
        return { ok: true, skipped: true };
      }
      if (!enabled && !live.sunModeActive) {
        this.log(`applySunMode(${enabled}): skip, RSCP sun mode already inactive (${this.formatWallboxAlgLog(live)})`);
        this.refreshCapabilities(live);
        return { ok: true, skipped: true };
      }
    }

    this.log(`applySunMode(${enabled}): sending RSCP (force=${force}) (${this.formatWallboxAlgLog(live)})`);
    const ok = await this.setSunMode(enabled, maxCurrentA);
    if (!ok) {
      return { ok: false, skipped: false };
    }

    const after = await this.waitForLiveStateMatch(
      state => enabled ? state.sunModeActive : !state.sunModeActive,
      `applySunMode(${enabled})`,
    );
    this.refreshCapabilities(after);
    if (enabled && !after.sunModeActive) {
      this.error(`applySunMode: RSCP did not enable sun mode (${this.formatWallboxAlgLog(after)})`);
      return { ok: false, skipped: false };
    }
    if (!enabled && after.sunModeActive) {
      this.error(`applySunMode: RSCP did not disable sun mode (${this.formatWallboxAlgLog(after)})`);
      return { ok: false, skipped: false };
    }
    this.log(`applySunMode(${enabled}): success (${this.formatWallboxAlgLog(after)})`);
    return { ok: true, skipped: false };
  }

  /**
   * Sets the max charging current (A) without changing the active mode.
   */
  async setCurrentLimit(maxCurrentA: number): Promise<boolean> {
    const api = await this.getApi();
    return api.setWallboxCurrentLimit(this.getWallboxId(), maxCurrentA, true, this);
  }

  /**
   * Starts/resumes charging (used for "resume" after abort).
   */
  async startCharging(maxCurrentA?: number, chargingCanceled = false): Promise<boolean> {
    const api = await this.getApi();
    const wallboxId = this.getWallboxId();
    if (chargingCanceled) {
      this.log('startCharging: toggling charging pause before mixed mode');
    }
    return api.startWallboxCharging(wallboxId, maxCurrentA, chargingCanceled, true, this);
  }

  /**
   * Stops/pauses charging.
   */
  async stopCharging(chargingCanceled = false): Promise<boolean> {
    if (chargingCanceled) {
      this.log('stopCharging: already paused, skip toggle');
      return true;
    }
    const api = await this.getApi();
    return api.stopWallboxCharging(this.getWallboxId(), true, this);
  }

  /**
   * Sets sun mode (PV surplus priority) or switches to mixed mode.
   */
  async setSunMode(enabled: boolean, maxCurrentA?: number): Promise<boolean> {
    const api = await this.getApi();
    return api.setWallboxSunMode(this.getWallboxId(), enabled, maxCurrentA, true, this);
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

}

module.exports = WallboxDevice;
