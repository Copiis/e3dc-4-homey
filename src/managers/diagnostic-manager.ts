import { DeviceDiagnostic, DiagnosticSnapshot, parseAnalysisLogFromStore, serializeAnalysisLog } from '../utils/device-diagnostic';
import { LiveData } from '../model/live-data';
import { formatError } from '../utils/error-utils';
import { updateCapabilityValue } from '../utils/capability-utils';
import { IHpsDevice } from '../types/hps-device';

/**
 * DiagnosticManager
 *
 * Verantwortlich für:
 * - Aufzeichnen von Diagnose-Events (Analysis Log)
 * - Erstellen und Publizieren von Diagnose-Reports
 * - Automatisches Deaktivieren der detaillierten Diagnose nach Timeout
 * - Zählen verknüpfter Geräte und Sammeln von Sync-Statistiken
 *
 * Wird vom HKW-Device genutzt, um Nutzern und Support gute Diagnose-Daten zu liefern.
 */
export class DiagnosticManager {
  private readonly diagnostic = new DeviceDiagnostic();
  private lastSyncAt?: Date;
  private lastSyncResult?: 'ok' | 'error';
  private lastSnapshot: Partial<DiagnosticSnapshot> = {};
  private lastDiagnosticPublish: number = 0;
  private detailedDiagnosticsAutoOffTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly device: IHpsDevice,
    private readonly DIAGNOSTIC_ANALYSIS_STORE_KEY: string
  ) {}

  recordAnalysisEvent(level: 'info' | 'warn' | 'error', message: string): void {
    if (level === 'info' && !this.isDetailedDiagnosticsEnabled()) {
      return;
    }
    if (!this.diagnostic.recordAnalysis(level, message)) {
      return;
    }
    this.persistDiagnosticAnalysisLog().catch(() => {});
    this.publishDiagnosticReport().catch(() => {});
  }

  recordSyncSuccess(result: LiveData): void {
    const hadSyncError = this.lastSyncResult === 'error';
    this.lastSyncAt = new Date();
    this.lastSyncResult = 'ok';
    if (hadSyncError) {
      this.recordAnalysisEvent('info', 'Sync wiederhergestellt / sync restored');
    }
    const wallbox = result.wallboxPowerState[0];
    const wallboxDiag = wallbox?.socDiagnostics;
    this.lastSnapshot = {
      pvW: result.pvDelivery,
      houseW: result.houseConsumption,
      gridW: result.gridDelivery,
      batteryPct: result.batteryChargingLevel * 100,
      firmware: result.firmwareVersion,
      wallboxSocPercent: wallbox?.socPercent,
      wallboxPlugged: wallbox?.plugged,
      wallboxSocRaw: wallboxDiag?.rscpSocRaw,
      wallboxAlgPrecharge: wallboxDiag?.algPrecharge,
      wallboxAlgHex: wallboxDiag?.algHex,
      wallboxChargePlanSoc: wallboxDiag?.chargePlanSoc,
      wallboxChargePlanText: wallboxDiag?.chargePlanText,
    };
  }

  recordSyncFailure(message: string): void {
    this.lastSyncAt = new Date();
    this.lastSyncResult = 'error';
    this.recordAnalysisEvent('error', message);
  }

  scheduleDetailedDiagnosticsAutoOff(delayMs: number, reason: 'timeout' | 'after-export' = 'timeout'): void {
    this.clearDetailedDiagnosticsAutoOff();
    this.detailedDiagnosticsAutoOffTimer = this.device.homey.setTimeout(() => {
      this.device.setSettings({ detailedDiagnostics: false }).catch(() => {});
      this.recordAnalysisEvent('info', `Detailed diagnostics auto-disabled after ${reason}`);
    }, delayMs);
  }

  clearDetailedDiagnosticsAutoOff(): void {
    if (this.detailedDiagnosticsAutoOffTimer) {
      clearTimeout(this.detailedDiagnosticsAutoOffTimer);
      this.detailedDiagnosticsAutoOffTimer = null;
    }
  }

  async publishDiagnosticReport(force = false): Promise<void> {
    const now = Date.now();
    if (!force && now - this.lastDiagnosticPublish < 60000) return;
    this.lastDiagnosticPublish = now;

    try {
      const report = this.diagnostic.formatReport(this.createSnapshot());
      updateCapabilityValue('diagnostic_report', report, this.device);
      await this.device.setSettings({ diagnosticReport: report });
    } catch (e) {
      this.device.error('publishDiagnosticReport failed: ' + formatError(e));
    }
  }

  async persistDiagnosticAnalysisLog(): Promise<void> {
    try {
      const log = serializeAnalysisLog([...this.diagnostic.getAnalysisEntries()]);
      await this.device.setStoreValue(this.DIAGNOSTIC_ANALYSIS_STORE_KEY, log);
    } catch (e) {
      this.device.error('persistDiagnosticAnalysisLog failed: ' + formatError(e));
    }
  }

  loadDiagnosticAnalysisLog(): void {
    const stored = this.device.getStoreValue(this.DIAGNOSTIC_ANALYSIS_STORE_KEY);
    this.diagnostic.replaceAnalysisEntries(parseAnalysisLogFromStore(stored));
  }

  getLastSnapshot(): Partial<DiagnosticSnapshot> {
    return this.lastSnapshot;
  }

  getLastSyncInfo(): { lastSyncAt?: Date; lastSyncResult?: 'ok' | 'error' } {
    return { lastSyncAt: this.lastSyncAt, lastSyncResult: this.lastSyncResult };
  }

  /** Public for device to satisfy IHpsDevice without exposing internals */
  isDetailedDiagnosticsEnabledPublic(): boolean {
    return this.isDetailedDiagnosticsEnabled();
  }

  /** Public for device to satisfy IHpsDevice */
  countLinkedDevicesPublic(driverId: string): number {
    return this.countLinkedDevices(driverId);
  }

  private isDetailedDiagnosticsEnabled(): boolean {
    return this.device.getSetting('detailedDiagnostics') === true;
  }

  private countLinkedDevices(driverId: string): number {
    const stationId = this.device.getId();
    const driver = this.device.homey.drivers.getDriver(driverId);
    if (!driver) return 0;
    return driver.getDevices().filter((device: unknown) => {
      const d = device as { getStoreValue?: (key: string) => unknown };
      const settings = d.getStoreValue?.('settings') as { stationId?: string } | undefined;
      return settings?.stationId === stationId;
    }).length;
  }

  private createSnapshot(): DiagnosticSnapshot {
    const homeyVersion = (this.device.homey as { version?: string }).version;
    return {
      appVersion: this.device.homey.manifest?.version ?? 'unknown',
      deviceName: this.device.getName(),
      deviceId: this.device.getId(),
      homeyVersion,
      available: this.device.getAvailable(),
      syncErrorCount: this.device.syncErrorCount || 0,
      lastSyncAt: this.lastSyncAt,
      lastSyncResult: this.lastSyncResult,
      pvW: this.lastSnapshot.pvW,
      houseW: this.lastSnapshot.houseW,
      gridW: this.lastSnapshot.gridW,
      batteryPct: this.lastSnapshot.batteryPct,
      wallboxDeviceCount: this.countLinkedDevices('wallbox'),
      batteryDeviceCount: this.countLinkedDevices('battery-module'),
      gridMeterDeviceCount: this.countLinkedDevices('grid-meter'),
      firmware: this.lastSnapshot.firmware,
      wallboxSocPercent: this.lastSnapshot.wallboxSocPercent,
      wallboxPlugged: this.lastSnapshot.wallboxPlugged,
      wallboxSocRaw: this.lastSnapshot.wallboxSocRaw,
      wallboxAlgPrecharge: this.lastSnapshot.wallboxAlgPrecharge,
      wallboxAlgHex: this.lastSnapshot.wallboxAlgHex,
      wallboxChargePlanSoc: this.lastSnapshot.wallboxChargePlanSoc,
      wallboxChargePlanText: this.lastSnapshot.wallboxChargePlanText,
      detailedDiagnosticsEnabled: this.isDetailedDiagnosticsEnabled(),
    };
  }
}
