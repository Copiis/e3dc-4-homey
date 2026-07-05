import * as Homey from 'homey';
import { SimpleClass } from 'homey';
import type { SimpleValueChangedTrigger } from '../cards/trigger/simple-value-changed.trigger';
import type { ManualBatteryChargingStartedTrigger } from '../cards/trigger/manual-battery-charging-started.trigger';
import type { ManualBatteryChargingStoppedTrigger } from '../cards/trigger/manual-battery-charging-stopped.trigger';
import type { IslandModeStartedTrigger } from '../cards/trigger/island-mode-started.trigger';
import type { IslandModeStoppedTrigger } from '../cards/trigger/island-mode-stopped.trigger';
import { LiveData } from '../model/live-data';
import type { ChargingConfiguration, EmergencyPowerState, ManualChargeState } from 'easy-rscp';

/**
 * Interface für das HomePowerStationDevice.
 * Wird von allen Managern (CapabilityManager, WallboxManager, etc.) verwendet,
 * um das Device zu entkoppeln (Dependency Inversion / Athom Beauty).
 * 
 * Definiert alle benötigten Methoden und Properties für:
 * - Capability-Updates
 * - Settings & Store
 * - Logging & Error
 * - Trigger Cards
 * - Sync-State
 */
export interface IHpsDevice extends SimpleClass, Homey.Device {
  getId(): string;
  getName(): string;
  getAvailable(): boolean;
  setAvailable(available?: boolean): Promise<void>;
  getSetting(key: string): unknown;
  setSettings(settings: unknown): Promise<void>;
  setStoreValue(key: string, value: unknown): Promise<void>;
  getStoreValue(key: string): unknown;
  log(msg: string): void;
  error(msg: string): void;
  getCapabilityValue(key: string): unknown;
  hasCapability(key: string): boolean;
  removeCapability(key: string): Promise<void>;

  /** Zähler für Sync-Fehler (wird vom CapabilityManager hochgezählt) */
  syncErrorCount: number;

  /** Flag used by capability manager to trigger battery capacity refresh */
  updateBatteryData: boolean;

  lastPvSurplusW: number;

  // Current state snapshots (populated by CapabilityManager)
  currentChargingConfig: ChargingConfiguration | null;
  currentManualChargeState: ManualChargeState | null;
  currentEmergencyPowerState: EmergencyPowerState | null;

  // Dynamically attached trigger objects (set by FlowCardManager)
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

  getBatteryCapacity(): Promise<number>;
  postTimelineNotification(excerpt: string): void;
  publishDiagnosticReport(force?: boolean): Promise<void>;
  recordAnalysisEvent(level: 'info' | 'warn' | 'error', message: string): void;
  countLinkedDevices(type: string): number;
  getAppVersion(): string;
  isDetailedDiagnosticsEnabled(): boolean;
  getData(): { id: string };
  getCurrentSOC(): number;

  // Optional delegation methods used by managers for linked devices
  updateLinkedBatteryLiveData?(result: LiveData): void;
  updateLinkedGridMeter?(result: LiveData): void;
}
