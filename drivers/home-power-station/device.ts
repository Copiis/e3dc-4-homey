import Homey, { SimpleClass } from 'homey';
import { PowerStationConfig } from '../../src/model/power-station.config';
import {
  ChargingConfiguration,
  E3dcConnectionData,
  EmergencyPowerState,
  ManualChargeState
} from 'easy-rscp';
import { RscpApi } from '../../src/rscp-api';
import { HomePowerStation, PowerModeState } from '../../src/model/home-power-station';
import { updateCapabilityValue } from '../../src/utils/capability-utils';
import { ValueChanged } from '../../src/model/value-changed';
import { LiveData } from '../../src/model/live-data';

// Trigger types (needed for dynamically attached properties on the device class)
import { SimpleValueChangedTrigger } from '../../src/cards/trigger/simple-value-changed.trigger';
import { ManualBatteryChargingStartedTrigger } from '../../src/cards/trigger/manual-battery-charging-started.trigger';
import { ManualBatteryChargingStoppedTrigger } from '../../src/cards/trigger/manual-battery-charging-stopped.trigger';
import { IslandModeStartedTrigger } from '../../src/cards/trigger/island-mode-started.trigger';
import { IslandModeStoppedTrigger } from '../../src/cards/trigger/island-mode-stopped.trigger';

import { BatteryModuleConfig } from '../../src/model/battery-module.config';
import { BatteryModule } from '../../src/model/battery-module';
import { WallboxConfig } from '../../src/model/wallbox.config';
import { Wallbox } from '../../src/model/wallbox';
import { GridMeterConfig } from '../../src/model/grid-meter.config';
import { GridMeter } from '../../src/model/grid-meter';

import { formatError } from '../../src/utils/error-utils';
import { formatSohPercent, resolveUsableCapacityWh } from '../../src/utils/battery-capacity';
import { BatteryData } from '../../src/model/battery-data';
import {
  DeviceDiagnostic,
  DiagnosticSnapshot,
  parseAnalysisLogFromStore,
  serializeAnalysisLog,
} from '../../src/utils/device-diagnostic';
import { EnergyMeterIntegrator } from '../../src/utils/energy-meter-integrator';
import { ensureCapabilities } from '../../src/utils/energy-capability-migration';
import { HKW_CAPABILITY_ORDER, reorderCapabilitiesIfNeeded } from '../../src/utils/capability-order';

import { calculatePvSurplusW } from '../../src/utils/pv-surplus';
import {
  buildPowerStateFromLiveData,
  publishPlantPowerStateFromStation,
  setPlantPowerState
} from '../../src/utils/plant-power-cache';
import { LiveDataPoller } from '../../src/polling/live-data-poller';
import { E3dcCloudClient } from '../../src/services/e3dc-cloud-client';

// Flow cards now fully encapsulated via FlowCardManager
import { FlowCardManager } from '../../src/cards/flow-card-manager';

// Managers
import { WallboxManager } from '../../src/managers/wallbox-manager';
import { CapabilityManager } from '../../src/managers/capability-manager';
import { EmsScheduleManager } from '../../src/managers/ems-schedule-manager';
import { PowerModeManager } from '../../src/managers/power-mode-manager';
import { DiagnosticManager } from '../../src/managers/diagnostic-manager';
import { IHpsDevice } from '../../src/types/hps-device';
const SYNC_INTERVAL = 1000 * 30; // 30 sec (reads/polling only; was 20s). Power mode keep-alive (EMS setPowerMode for Ladeplaner/grid charge) is 10s inside PowerModeManager.
const POWER_MODE_REFRESH_INTERVAL = 1000 * 10; // 10s keep-alive for active EMS power modes (grid_charge etc.). Actual value used in PowerModeManager.
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5
const DIAGNOSTIC_ANALYSIS_STORE_KEY = 'diagnosticAnalysisLog'

/**
 * HomePowerStationDevice – der zentrale Treiber für E3DC Hauskraftwerke.
 *
 * Diese Klasse ist bewusst schlank gehalten (Koordinator-Rolle).
 * Die eigentliche Fachlogik ist in dedizierte Manager ausgelagert:
 *   - CapabilityManager
 *   - WallboxManager
 *   - EmsScheduleManager
 *   - PowerModeManager
 *   - DiagnosticManager
 *
 * Design-Ziel (Athom Beauty):
 * - Extrem gute Lesbarkeit und Wartbarkeit
 * - Klare Verantwortlichkeiten
 * - Hohe Testbarkeit durch Interfaces (IHpsDevice)
 * - Einheitlicher Stil mit Wallbox, Grid-Meter und Energy-Summary
 *
 * Wichtige Konventionen:
 * - Keine direkten RSCP-Calls im Device (außer über Manager/Api)
 * - Alle Fehler gehen durch formatError()
 * - Capabilities nur über updateCapabilityValue() aktualisieren
 */
class HomePowerStationDevice extends Homey.Device implements HomePowerStation{
  private liveDataPoller: LiveDataPoller | null = null
  private wallboxManager: WallboxManager | null = null
  private e3dcCloudClient: E3dcCloudClient | null = null
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

  /**
   * Initialisiert den HKW-Treiber.
   * Lädt Einstellungen, startet den zentralen LiveDataPoller und alle Manager.
   */
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

    // Optional E3DC Cloud client for fallback values (e.g. vehicle SOC)
    this.e3dcCloudClient = new E3dcCloudClient({
      log: (m: string) => this.log('[Cloud] ' + m),
      error: (m: string) => this.error('[Cloud] ' + m),
    })
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

  hasActivePlan(): boolean {
    const state = this.powerModeManager?.getPowerModeState?.() ?? null;
    return !!state?.scheduleId;
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
  private lastBatteryReadTime = 0;
  private lastBatteryUsable = 0;
  private lastBatteryData: BatteryData | null = null;

  // Short cache for linked battery modules (reduces repeated scans on capacity reads)
  private linkedBatteryModulesCache: { timestamp: number; devices: unknown[] } | null = null;
  private static readonly LINKED_BATTERY_CACHE_TTL_MS = 60_000;

  public getBatteryCapacity(): Promise<number> {
    const now = Date.now();
    const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes — battery capacity changes very rarely (only on hardware swap or strong degradation)
    if (now - this.lastBatteryReadTime < CACHE_TTL_MS && this.lastBatteryUsable > 0) {
      return Promise.resolve(this.lastBatteryUsable);
    }

    return new Promise((resolve, reject) => {
      this.getApi()
          .readBatteryData(true, this)
          .then(value => {
            if (value && value.length > 0) {
              const batteryData = value[0];
              const usable = resolveUsableCapacityWh(batteryData);
              this.lastBatteryReadTime = Date.now();
              this.lastBatteryUsable = usable;
              this.lastBatteryData = batteryData;

              this.updateBatteryCapacitySettings(batteryData);
              this.updateLinkedBatteryModules(batteryData, usable);

              resolve(usable);
            } else {
              this.error('getBatteryCapacity: empty battery data');
              this.resolveFallbackCapacity(resolve);
            }
          })
          .catch(reason => {
            this.error('getBatteryCapacity: Error reading battery data: ' + formatError(reason));
            this.resolveFallbackCapacity(resolve);
          })
    })
  }

  private resolveFallbackCapacity(resolve: (value: number) => void) {
    const settings = this.getSettings() as Record<string, unknown>;
    const fromSettings = (settings.rscpAsoc as number) || (settings.capacity as number) || 0;
    const fallback = fromSettings > 0 ? fromSettings : (this.lastBatteryUsable || 0);
    resolve(fallback);
  }

  /**
   * Persist detected battery capacities/SOH into the HKW device settings (shown as labels
   * under "Batteriedaten"). Restored from refactor; used for fallback + visibility.
   */
  private updateBatteryCapacitySettings(battery: BatteryData): void {
    try {
      const storedSettings: PowerStationConfig = this.getSettings();
      const usableWh = resolveUsableCapacityWh(battery);
      const updated: PowerStationConfig = {
        ...storedSettings,
        rscpCapacity: Math.round(battery.capacity).toString(),
        rscpAsoc: Math.round(usableWh).toString(),
        rscpSoh: formatSohPercent(usableWh, battery.capacity),
      };
      this.setSettings(updated).catch(reason => {
        this.log('Failed to store battery capacity settings: ' + formatError(reason));
      });
    } catch (e) {
      this.error('updateBatteryCapacitySettings failed: ' + formatError(e));
    }
  }

  /**
   * Push full battery readout (usable capacity in kWh, dcb details, temps, voltage, name)
   * to all linked Batteriemonitor devices for this station.
   * This populates the "Kapazität" (and related) fields on the battery module tile.
   */
  private updateLinkedBatteryModules(batteryData: BatteryData, usableWh: number) {
    try {
      const now = Date.now();
      let batteryDevices: unknown[];
      if (this.linkedBatteryModulesCache && now - this.linkedBatteryModulesCache.timestamp < HomePowerStationDevice.LINKED_BATTERY_CACHE_TTL_MS) {
        batteryDevices = this.linkedBatteryModulesCache.devices;
      } else {
        batteryDevices = this.homey.drivers.getDriver('battery-module').getDevices();
        this.linkedBatteryModulesCache = { timestamp: now, devices: batteryDevices };
      }

      const stationId = this.getId();
      const capacityKwh = usableWh / 1000.0;

      batteryDevices.forEach((currentDevice: unknown) => {
        const batteryConfig = (currentDevice as { getStoreValue: (k: string) => unknown }).getStoreValue('settings') as { stationId?: string } | undefined;
        if (!batteryConfig?.stationId) {
          return;
        }
        if (batteryConfig.stationId == stationId) {
          const linked = currentDevice as { updateBatteryInfo?: (d: BatteryData, c: number) => void };
          if (linked.updateBatteryInfo) {
            linked.updateBatteryInfo(batteryData, capacityKwh);
          }
        }
      });
    } catch (e) {
      this.error('updateLinkedBatteryModules: ' + formatError(e));
    }
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
      this.capabilityManager?.handleEmsTriggers(result, batteryLevelChange)
      this.capabilityManager?.updateExternalPower(result)
      this.capabilityManager?.handleChargeTime(result);
      this.capabilityManager?.handleFirmwareChange(result);
      this.capabilityManager?.handleChargingConfigurationChanges(result);
      this.capabilityManager?.handleManualChargeStateChanges(result)
      this.capabilityManager?.handleEmergencyPowerStateChanges(result)
      this.wallboxManager?.handleWallboxData(result)

      // Optional cloud fallback for vehicle SOC (when local RSCP reports 0)
      this.applyCloudVehicleSocFallback().catch(e => this.error('Cloud fallback error: ' + formatError(e)))

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

  /**
   * Opt-in E3DC Cloud fallback.
   * If enabled in settings, tries to fetch vehicle SOC from the cloud when local data is 0/unplausible.
   */
  private async applyCloudVehicleSocFallback(): Promise<void> {
    const settings = this.getSettings() as any;
    if (!settings.useE3dcCloud) {
      return;
    }

    if (!this.e3dcCloudClient) {
      return;
    }

    const cloudConfig = {
      portalUsername: settings.portalUsername || '',
      portalPassword: settings.portalPassword || '',
      enabled: !!settings.useE3dcCloud,
      systemSn: settings.cloudSystemSn ? Number(settings.cloudSystemSn) : undefined,
    };

    const cloudSoc = await this.e3dcCloudClient.fetchVehicleSocFallback(cloudConfig);
    if (cloudSoc === undefined) {
      this.log('E3DC Cloud: no plausible vehicle SOC available from cloud (portal may have issues)');
      return;
    }

    // Apply to linked wallbox devices that currently have no plausible local SOC
    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices();
    for (const d of wallboxDevices) {
      try {
        const wb = d as any;
        const store = wb.getStoreValue?.('settings');
        if (!store || String(store.stationId) !== String(this.getData().id)) continue;

        const currentLocal = Number(wb.getCapabilityValue?.('measure_vehicle_soc')) || 0;
        const isPlausibleLocal = currentLocal > 0 && currentLocal <= 100;

        if (!isPlausibleLocal) {
          if (typeof wb.applyCloudVehicleSoc === 'function') {
            wb.applyCloudVehicleSoc(cloudSoc);
          } else {
            // Fallback for older instances
            await wb.setCapabilityValue('measure_vehicle_soc', cloudSoc);
          }
          this.log(`Applied cloud vehicle SOC fallback ${cloudSoc}% to wallbox ${wb.getName?.() || ''}`);
        }
      } catch (e) {
        this.error('Failed to apply cloud SOC fallback to wallbox: ' + formatError(e));
      }
    }

    // Also record in diagnostics
    const cloudState = this.e3dcCloudClient.getLastState?.();
    if (cloudState) {
      // The diagnostic manager will pick it up on next record if we expose more; for now log is sufficient
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
    // Force publish and actually return the generated report so Flow cards can use the token
    const report = await this.diagnosticManager?.publishDiagnosticReport(true) ?? '';
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

  publishDiagnosticReport(force = false): Promise<string> {
    return this.diagnosticManager?.publishDiagnosticReport(force) ?? Promise.resolve('');
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
      address: (newSettings.stationAddress as string) || '',
      port: parseInt(String(newSettings.stationPort || '502')),
      portalUser: (newSettings.portalUsername as string) || '',
      portalPassword: (newSettings.portalPassword as string) || '',
      rscpPassword: (newSettings.rscpKey as string) || '',
    }
    if (changedKeys.includes('emsSchedules')) {
      this.log('[Ladeplan] emsSchedules setting changed, reloading')
      this.diagnosticManager?.recordAnalysisEvent('info', '[Ladeplan] emsSchedules setting changed, reloading')
      this.emsScheduleManager?.loadEmsSchedules()
      this.emsScheduleManager?.clearTriggeredSchedules()
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
