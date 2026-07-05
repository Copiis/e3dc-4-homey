import Homey, {FlowCardTriggerDevice, SimpleClass} from 'homey';
import {PowerStationConfig} from '../../src/model/power-station.config';
import {
  BatteryUnit,
  ChargingConfiguration,
  E3dcConnectionData,
  EmergencyPowerState,
  ManualChargeState
} from 'easy-rscp';
import {RscpApi} from '../../src/rscp-api';
import {HomePowerStation} from '../../src/model/home-power-station';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {SetMaxChargingPowerActionCard} from '../../src/cards/action/set-max-charging-power.action.card';
import {clearTimeout} from 'node:timers';
import {
  RemoveMaxChargingPowerLimitActionCard
} from '../../src/cards/action/remove-max-charging-power-limit.action.card';
import {SetPowerLimitsToDefaultActionCard} from '../../src/cards/action/set-power-limits-to-default.action.card';
import {SetMaxDischargingPowerActionCard} from '../../src/cards/action/set-max-discharging-power.action.card';
import {
  RemoveMaxDischargingPowerLimitActionCard
} from '../../src/cards/action/remove-max-discharging-power-limit.action.card';
import {
  ProvideChargingConfigurationActionCard
} from '../../src/cards/action/provide-charging-configuration.action.card';
import {
  IsMaxChargingLimitGreaterThanConditionCard
} from '../../src/cards/condition/is-max-charging-limit-greater-than.condition.card';
import {
  IsMaxDischargingLimitGreaterThanConditionCard
} from '../../src/cards/condition/is-max-discharging-limit-greater-than.condition.card';
import {
  IsMaxChargingLimitActiveConditionCard
} from '../../src/cards/condition/is-max-charging-limit-active.condition.card';
import {
  IsMaxDischargingLimitActiveConditionCard
} from '../../src/cards/condition/is-max-discharging-limit-active.condition.card';
import {IsAnyPowerLimitActiveConditionCard} from '../../src/cards/condition/is-any-power-limit-active.condition.card';
import {SimpleValueChangedTrigger} from '../../src/cards/trigger/simple-value-changed.trigger';
import {ActivatePowerLimitsActionCard} from '../../src/cards/action/activate-power-limits.action.card';
import {ValueChanged} from '../../src/model/value-changed';
import {DeactivatePowerLimitsActionCard} from '../../src/cards/action/deactivate-power-limits.action.card';
import {BatteryModuleConfig} from '../../src/model/battery-module.config';
import {BatteryModule} from '../../src/model/battery-module';
import {TriggerCard} from '../../src/cards/trigger-card';
import {ManualBatteryChargingStartedTrigger} from '../../src/cards/trigger/manual-battery-charging-started.trigger';
import {ManualBatteryChargingStoppedTrigger} from '../../src/cards/trigger/manual-battery-charging-stopped.trigger';
import {IsManualChargeActiveConditionCard} from '../../src/cards/condition/is-manual-charge-active.condition.card';
import {LiveData} from '../../src/model/live-data';
import {StopManualBatteryChargeActionCard} from '../../src/cards/action/stop-manual-battery-charge.action.card';
import {
  StartManualBatteryChargeActionPercentageCard,
  StartManualBatteryChargeWhActionCard
} from '../../src/cards/action/start-manual-battery-charge.action.card';
import {ConfigureEmergencyReserveActionCard} from '../../src/cards/action/configure-emergency-reserve.action.card';
import {RemoveEmergencyReserveActionCard} from '../../src/cards/action/remove-emergency-reserve.action.card';
import {IslandModeStartedTrigger} from '../../src/cards/trigger/island-mode-started.trigger';
import {IslandModeStoppedTrigger} from '../../src/cards/trigger/island-mode-stopped.trigger';
import {
  IsEmergencyPowerReserveGreaterThanConditionCard
} from '../../src/cards/condition/is-emergency-power-reserve-greater-than.condition.card';
import {IsIslandModeActiveConditionCard} from '../../src/cards/condition/is-island-mode-active.condition.card';
import {IsIslandModePossibleConditionCard} from '../../src/cards/condition/is-island-mode-possible.condition.card';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {Wallbox} from '../../src/model/wallbox';
import {GridMeterConfig} from '../../src/model/grid-meter.config';
import {GridMeter} from '../../src/model/grid-meter';
import {formatError} from '../../src/utils/error-utils';
import {formatSohPercent, resolveUsableCapacityWh} from '../../src/utils/battery-capacity';
import {BatteryData} from '../../src/model/battery-data';
import {
  DeviceDiagnostic,
  DiagnosticSnapshot,
  parseAnalysisLogFromStore,
  serializeAnalysisLog,
} from '../../src/utils/device-diagnostic';
import {ExportDiagnosticReportActionCard} from '../../src/cards/action/export-diagnostic-report.action.card';
import {EnergyMeterIntegrator} from '../../src/utils/energy-meter-integrator';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import {HKW_CAPABILITY_ORDER, reorderCapabilitiesIfNeeded} from '../../src/utils/capability-order';
import {
  SetPowerModeAutoActionCard,
  SetPowerModeChargeActionCard,
  SetPowerModeDischargeActionCard,
  SetPowerModeGridChargeActionCard,
  SetPowerModeIdleActionCard,
  POWER_MODE_AUTO,
  POWER_MODE_IDLE,
  POWER_MODE_DISCHARGE,
  POWER_MODE_CHARGE,
  POWER_MODE_GRID_CHARGE,
} from '../../src/cards/action/set-power-mode.action.card';
import {PowerModeState} from '../../src/model/home-power-station';
import {calculatePvSurplusW} from '../../src/utils/pv-surplus';
import {buildPowerStateFromLiveData, publishPlantPowerStateFromStation, setPlantPowerState} from '../../src/utils/plant-power-cache';
import {LiveDataPoller} from '../../src/polling/live-data-poller';
import {FlowCardManager} from '../../src/cards/flow-card-manager';
import {WallboxManager} from '../../src/managers/wallbox-manager';
import {CapabilityManager} from '../../src/managers/capability-manager';
import {EmsScheduleManager} from '../../src/managers/ems-schedule-manager';
import {PowerModeManager} from '../../src/managers/power-mode-manager';
import {DiagnosticManager} from '../../src/managers/diagnostic-manager';
import { IHpsDevice } from '../../src/types/hps-device';
const SYNC_INTERVAL = 1000 * 30; // 30 sec (was 20s; reduces CPU/RSCP/cap churn on older Homeys while flow editor is open)
const POWER_MODE_REFRESH_INTERVAL = 1000 * 30; // 30 sec (was 10s)
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5
const DIAGNOSTIC_ANALYSIS_STORE_KEY = 'diagnosticAnalysisLog'
class HomePowerStationDevice extends Homey.Device implements HomePowerStation{
  private liveDataPoller: LiveDataPoller | null = null
  private wallboxManager: WallboxManager | null = null
  private capabilityManager: CapabilityManager | null = null
  private emsScheduleManager: EmsScheduleManager | null = null
  private powerModeManager: PowerModeManager | null = null
  private diagnosticManager: DiagnosticManager | null = null

  // Dynamically attached value-changed and event triggers (populated by FlowCardManager)
  // Declared here so the class structurally satisfies IHpsDevice without casts.
  firmwareChangedTrigger?: SimpleValueChangedTrigger<string>;
  maxChargingLimitHasChangedTrigger?: SimpleValueChangedTrigger<number>;
  maxDischargingLimitHasChangedTrigger?: SimpleValueChangedTrigger<number>;
  emergencyPowerReserveChangedTrigger?: SimpleValueChangedTrigger<number>;
  houseConsumptionHasChangedTrigger?: SimpleValueChangedTrigger<number>;
  batteryPowerHasChangedTrigger?: SimpleValueChangedTrigger<number>;
  gridPowerHasChangedTrigger?: SimpleValueChangedTrigger<number>;
  manualBatteryChargingStartedTrigger?: ManualBatteryChargingStartedTrigger;
  manualBatteryChargingStoppedTrigger?: ManualBatteryChargingStoppedTrigger;
  islandModeStartedTrigger?: IslandModeStartedTrigger;
  islandModeStoppedTrigger?: IslandModeStoppedTrigger;

  // Properties required by IHpsDevice (managers access them directly)
  syncErrorCount: number = 0;
  updateBatteryData: boolean = false;
  lastPvSurplusW: number = 0;
  currentChargingConfig: import('easy-rscp').ChargingConfiguration | null = null;
  currentManualChargeState: import('easy-rscp').ManualChargeState | null = null;
  currentEmergencyPowerState: import('easy-rscp').EmergencyPowerState | null = null;

  async onInit() {
    this.log('HomePowerStationDevice has been initialized');
    const initialStoredSettings: PowerStationConfig | undefined = this.getStoreValue('settings')
    if (initialStoredSettings) {
      initialStoredSettings.stationPort = parseInt(initialStoredSettings.stationPort.toString())
      let configuredTimeout = 5
      if (initialStoredSettings.timeout) {
        configuredTimeout = parseInt(initialStoredSettings.timeout.toString())
      }
      initialStoredSettings.timeout = configuredTimeout
      this.log('Migrating store to settings')
      this.setSettings(initialStoredSettings)
          .then(value => {
            this.unsetStoreValue('settings').then()
            this.log('Starting process')
            this.doInit()
          })
    }
    else {
      this.log('Starting process without migration')
      this.doInit()
    }
  }
  private doInit() {
    this.diagnosticManager?.loadDiagnosticAnalysisLog?.() || undefined
    const flowManager = new FlowCardManager(this);
    flowManager.setupActionCards();
    flowManager.setupConditionCards();
    flowManager.setupTriggerCards();
    this.diagnosticManager?.publishDiagnosticReport().catch(reason => {
      this.error('Initial diagnostic report failed: ' + formatError(reason))
    })
    publishPlantPowerStateFromStation(this)
    this.wallboxManager = new WallboxManager(
      this.homey,
      this.getId(),
      this,
      () => this.getApi(),
    )
    this.capabilityManager = new CapabilityManager(this, new EnergyMeterIntegrator(this));
    this.powerModeManager = new PowerModeManager(this, () => this.getApi(), this);
    this.emsScheduleManager = new EmsScheduleManager(this, () => this.getApi(), this, this.powerModeManager);
    this.emsScheduleManager.loadEmsSchedules();
    this.emsScheduleManager.startEmsScheduleChecker();
    this.diagnosticManager = new DiagnosticManager(this, DIAGNOSTIC_ANALYSIS_STORE_KEY);
    this.liveDataPoller = new LiveDataPoller(
      () => this.getApi(),
      this,
      () => this.wallboxManager!.hasLinkedWallboxes(),
    )
    this.liveDataPoller.onData((data) => this.processLiveData(data))
    this.liveDataPoller.start(SYNC_INTERVAL)
  }
  getCurrentSOC(): number {
    const number = this.getCapabilityValue('measure_battery')
    if (number) {
      return number / 100.0;
    }
    return  0.0
  }
  getManualChargeState(): ManualChargeState | null {
    return this.capabilityManager?.currentManualChargeState ?? null;
  }
  getEmergencyPowerState(): EmergencyPowerState | null {
    return this.capabilityManager?.currentEmergencyPowerState ?? null;
  }
  setPowerModeState(state: PowerModeState | null): void {
    this.powerModeManager?.setPowerModeState(state);
    this.emsScheduleManager?.setPowerModeState(state);
  }
  asSimple(): SimpleClass {
    return this;
  }
  validateUnit(value: number, unit: CardUnit): string | undefined {
    if (unit == CardUnit.PERCENTAGE && value > 100) {
      return this.homey.__('messages.invalid-percentage')
    }
    if (value < 0) {
      return this.homey.__('messages.to-low-limit')
    }
    return undefined
  }
  getId(): string {
    return this.getData().id;
  }
  public getBatteryCapacity(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getApi()
          .readBatteryData(true, this)
          .then(value => {
            const usable = resolveUsableCapacityWh(value[0])
            resolve(usable)
          })
          .catch(reason => {
            this.error('getBatteryCapacity: Error reading battery data: ' + formatError(reason))
            const settings: any = this.getSettings()
            const fromSettings = settings.rscpAsoc || settings.capacity || 0
            resolve(fromSettings > 0 ? fromSettings : 0)
          })
    })
  }
  public getApi(): RscpApi {
    const api = new RscpApi()
    const storedSettings: PowerStationConfig = this.getSettings();
    let timeoutMillis = 5000
    if (storedSettings.timeout) {
      timeoutMillis = storedSettings.timeout * 1000
    } else {
      storedSettings.timeout = 5
      this.setSettings(storedSettings).then()
    }
    api.init({
      address: storedSettings.stationAddress,
      port: storedSettings.stationPort,
      portalUser: storedSettings.portalUsername,
      portalPassword: storedSettings.portalPassword,
      rscpPassword: storedSettings.rscpKey,
      connectionTimeoutMillis: timeoutMillis,
      readTimeoutMillis: timeoutMillis,
    }, this)
    return api
  }
  async sync() {
    if (this.liveDataPoller) {
      const data = await this.liveDataPoller.forceFetch();
      if (data) {
        this.processLiveData(data);
      }
      return data;
    }
    const hasWallboxes = this.wallboxManager?.hasLinkedWallboxes() ?? false;
    const data = await this.getApi().readLiveData(true, this, hasWallboxes);
    this.processLiveData(data);
    return data;
  }
  /**
   * Processing extracted from the old monolithic sync path.
   * Called by the LiveDataPoller when fresh data arrives.
   */
  private processLiveData(result: LiveData) {
    try {
      const capChanges = this.capabilityManager?.processLivePowerData(result) ?? { batteryLevelChange: undefined };
      const batteryLevelChange = capChanges.batteryLevelChange;
      this.emsScheduleManager?.handleEmsTriggers(result, batteryLevelChange)
      this.capabilityManager?.updateExternalPower(result)
      this.capabilityManager?.handleChargeTime(result);
      this.capabilityManager?.handleFirmwareChange(result);
      this.capabilityManager?.handleChargingConfigurationChanges(result);
      this.capabilityManager?.handleManualChargeStateChanges(result)
      this.capabilityManager?.handleEmergencyPowerStateChanges(result)
      this.wallboxManager?.handleWallboxData(result)
      const agg = this.wallboxManager?.getWallboxAggregation() ?? { wallboxPower: 0, wallboxSolarShare: 0, hasWallbox: false };
      const stationId = String(this.getData().id);
      setPlantPowerState(stationId, buildPowerStateFromLiveData(result, agg.wallboxPower, agg.wallboxSolarShare, agg.hasWallbox));
      this.capabilityManager?.updateLinkedGridMeter(result)
      this.capabilityManager?.handleAvailability();
      this.diagnosticManager?.recordSyncSuccess(result)
      this.capabilityManager?.updateLinkedBattery(result)
      this.capabilityManager?.updateBatteryDataIfNeeded?.();
    } catch (e) {
      this.error('Error processing live data: ' + formatError(e))
      this.diagnosticManager?.recordSyncFailure('Verarbeitung Live-Daten / processing live data: ' + formatError(e))
    }
  }

















  async onAdded() {
    this.log('HomePowerStationDevice has been added');
    const storedSettings: PowerStationConfig = this.getStoreValue('settings')
    await this.setSettings(storedSettings)
    await this.unsetStoreValue('settings')
  }
  async buildDiagnosticReport(): Promise<string> {
    const wasEnabled = this.getSetting('detailedDiagnostics') === true;
    await this.diagnosticManager?.publishDiagnosticReport(true) // force for export card
    const report = '';
    if (wasEnabled) {
      this.diagnosticManager?.scheduleDetailedDiagnosticsAutoOff(10 * 60 * 1000, 'after-export');
    }
    return report;
  }

  postTimelineNotification(excerpt: string): void {
    this.homey.notifications
      .createNotification({ excerpt })
      .catch((reason: unknown) => {
        this.error('Failed to create timeline notification: ' + formatError(reason));
      });
  }

  publishDiagnosticReport(force = false): Promise<void> {
    return this.diagnosticManager?.publishDiagnosticReport(force) ?? Promise.resolve();
  }

  recordAnalysisEvent(level: 'info' | 'warn' | 'error', message: string): void {
    this.diagnosticManager?.recordAnalysisEvent(level, message);
  }

  countLinkedDevices(type: string): number {
    return this.diagnosticManager?.countLinkedDevicesPublic?.(type) ?? 0;
  }

  getAppVersion(): string {
    return this.homey.manifest?.version ?? 'unknown';
  }

  isDetailedDiagnosticsEnabled(): boolean {
    return this.diagnosticManager?.isDetailedDiagnosticsEnabledPublic?.() ?? (this.getSetting('detailedDiagnostics') === true);
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
    this.log("HomePowerStationDevice settings where changed");
    const e3dcData: E3dcConnectionData = {
      // @ts-ignore
      address: newSettings.stationAddress,
      // @ts-ignore
      port: newSettings.stationPort,
      // @ts-ignore
      portalUser: newSettings.portalUsername,
      // @ts-ignore
      portalPassword: newSettings.portalPassword,
      // @ts-ignore
      rscpPassword: newSettings.rscpKey
    }
    if (changedKeys.includes('emsSchedules')) {
      this.log('[Ladeplan] emsSchedules setting changed, reloading')
      this.diagnosticManager?.recordAnalysisEvent('info', '[Ladeplan] emsSchedules setting changed, reloading')
      this.emsScheduleManager?.loadEmsSchedules()
      this.emsScheduleManager?.clearTriggeredSchedules()  // clean public API (no more private bracket hack)
      this.emsScheduleManager?.checkEmsSchedules?.()  // evaluate immediately
    }
    if (changedKeys.includes('detailedDiagnostics')) {
      const enabled = !!newSettings.detailedDiagnostics;
      // Always record the toggle change (bypass gate so the event is captured)
      this.diagnosticManager?.recordAnalysisEvent('info', `Detailed diagnostics logging ${enabled ? 'ENABLED' : 'DISABLED'}`);
      this.diagnosticManager?.persistDiagnosticAnalysisLog().catch(() => {});
      this.diagnosticManager?.publishDiagnosticReport(true).catch(() => {}); // force update
      this.log(`Detailed diagnostics ${enabled ? 'enabled' : 'disabled'}`);
      if (enabled) {
        // Start safety timeout (60 min max) so resources are not wasted if user forgets to turn off
        this.diagnosticManager?.scheduleDetailedDiagnosticsAutoOff(60 * 60 * 1000, 'timeout');
      } else {
        this.diagnosticManager?.clearDetailedDiagnosticsAutoOff();
      }
    }
  }
  async onRenamed(name: string) {
    this.log('HomePowerStationDevice was renamed');
  }
  async onDeleted() {
    this.log('HomePowerStationDevice has been deleted');
    this.emsScheduleManager?.stop();
    this.liveDataPoller?.stop?.();
    this.diagnosticManager?.clearDetailedDiagnosticsAutoOff();
    try {
      this.getApi().closeOwnConnection(this).catch(reason => {
        this.log('closeOwnConnection on delete failed: ' + formatError(reason))
      });
    } catch (e) {}
  }
  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }
}
export enum CardUnit {
  WATT = 'w',
  PERCENTAGE = 'percentage'
}
module.exports = HomePowerStationDevice;
