import Homey, { SimpleClass } from 'homey';
import { LiveData } from '../model/live-data';

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
  homey: any;
  syncErrorCount: number;
  updateBatteryData: boolean;
  lastPvSurplusW: number;
  currentChargingConfig: unknown;
  currentManualChargeState: unknown;
  currentEmergencyPowerState: unknown;
  firmwareChangedTrigger: unknown;
  maxChargingLimitHasChangedTrigger: unknown;
  maxDischargingLimitHasChangedTrigger: unknown;
  emergencyPowerReserveChangedTrigger: unknown;
  houseConsumptionHasChangedTrigger: unknown;
  batteryPowerHasChangedTrigger: unknown;
  gridPowerHasChangedTrigger: unknown;
  manualBatteryChargingStartedTrigger: unknown;
  manualBatteryChargingStoppedTrigger: unknown;
  islandModeStartedTrigger: unknown;
  islandModeStoppedTrigger: unknown;
  getBatteryCapacity(): Promise<number>;
  postTimelineNotification(excerpt: string): void;
  publishDiagnosticReport(force?: boolean): Promise<void>;
  recordAnalysisEvent(level: 'info' | 'warn' | 'error', message: string): void;
  countLinkedDevices(type: string): number;
  getAppVersion(): string;
  isDetailedDiagnosticsEnabled(): boolean;
  getData(): { id: string };
  getCurrentSOC(): number;
  // for managers
  updateLinkedBatteryLiveData?(result: LiveData): void;
  updateLinkedGridMeter?(result: LiveData): void;
}
