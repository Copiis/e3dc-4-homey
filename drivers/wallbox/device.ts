import Homey, {SimpleClass} from 'homey';
import {Wallbox, WallboxCommandResult} from '../../src/model/wallbox';
import {WallboxEmsSettings} from '../../src/model/wallbox-ems-settings';
import {WallboxLiveState} from '../../src/model/wallbox-live-state';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {RscpApi} from '../../src/rscp-api';
import {formatError} from '../../src/utils/error-utils';
import {RunListener} from '../../src/cards/run-listener';
import {SetWallboxCurrentActionCard} from '../../src/cards/action/set-wallbox-current.action.card';
import {WallboxStartChargingActionCard} from '../../src/cards/action/wallbox-start-charging.action.card';
import {WallboxStopChargingActionCard} from '../../src/cards/action/wallbox-stop-charging.action.card';
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

class WallboxDevice extends Homey.Device implements Wallbox {

  private lastSyncedState?: WallboxLiveState;
  private lastSyncedAt = 0;
  private capabilitiesReady = false;
  private wasReadyToCharge = false;

  async onInit() {
    this.log('WallboxDevice has been initialized');
    try {
      await this.migrateCapabilities();
      this.capabilitiesReady = true;
    } catch (e) {
      this.error('Wallbox onInit failed: ' + formatError(e));
    }
    this.setupFlowCards();
  }

  private bindDevice(listener: RunListener): (args: Record<string, unknown>, state: unknown) => Promise<unknown> {
    return (args, state) => listener.run({ ...args, device: this }, state);
  }

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
      { id: 'wallbox_start_charging', listener: new WallboxStartChargingActionCard() },
      { id: 'wallbox_stop_charging', listener: new WallboxStopChargingActionCard() },
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

  private async migrateCapabilities(): Promise<void> {
    await ensureCapabilities(this, [...WALLBOX_CAPABILITY_ORDER]);
    await reorderCapabilitiesIfNeeded(this, WALLBOX_CAPABILITY_ORDER);
    await hideCapabilitiesFromTile(this, WALLBOX_TILE_HIDDEN_CAPABILITIES);
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

    this.handleWallboxReadyTrigger(state, effectivePowerW);
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

  private static readonly LIVE_STATE_VERIFY_DELAYS_MS = [500, 1000, 2000];

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

  async applyChargingAllowed(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();

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

    this.log(`applyChargingAllowed(${enabled}): sending RSCP (${this.formatWallboxAlgLog(live)})`);
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

  async applySunMode(enabled: boolean, maxCurrentA?: number): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();

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

    this.log(`applySunMode(${enabled}): sending RSCP (${this.formatWallboxAlgLog(live)})`);
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

  async setCurrentLimit(maxCurrentA: number): Promise<boolean> {
    const api = await this.getApi();
    return api.setWallboxCurrentLimit(this.getWallboxId(), maxCurrentA, true, this);
  }

  async startCharging(maxCurrentA?: number, chargingCanceled = false): Promise<boolean> {
    const api = await this.getApi();
    const wallboxId = this.getWallboxId();
    if (chargingCanceled) {
      this.log('startCharging: toggling charging pause before mixed mode');
    }
    return api.startWallboxCharging(wallboxId, maxCurrentA, chargingCanceled, true, this);
  }

  async stopCharging(chargingCanceled = false): Promise<boolean> {
    if (chargingCanceled) {
      this.log('stopCharging: already paused, skip toggle');
      return true;
    }
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
