import { DeviceDiagnostic, DiagnosticSnapshot, parseAnalysisLogFromStore, serializeAnalysisLog } from '../utils/device-diagnostic';
import { LiveData } from '../model/live-data';
import { formatError } from '../utils/error-utils';
import { updateCapabilityValue } from '../utils/capability-utils';
import { IHpsDevice } from '../types/hps-device';

/** Safety cap: detailed diagnostics auto-off after this long (from enable time). */
export const DETAILED_DIAGNOSTICS_MAX_MS = 60 * 60 * 1000;

/** After exporting a report while diagnostics are on, shorten remaining time to this. */
export const DETAILED_DIAGNOSTICS_AFTER_EXPORT_MS = 10 * 60 * 1000;

/** Store key: Date.now() when detailedDiagnostics was turned on (survives app restarts). */
export const DETAILED_DIAGNOSTICS_ENABLED_AT_KEY = 'detailedDiagnosticsEnabledAt';

/**
 * DiagnosticManager
 *
 * Zentrale Stelle für Diagnose und Analyse des HKW.
 *
 * Aufgaben:
 * - Record und Persistierung von Analysis-Events (Info/Warn/Error)
 * - Erzeugen und Veröffentlichen von Diagnose-Reports
 * - Auto-Off für detailedDiagnostics nach Timeout (persistierter Zeitstempel,
 *   damit App-/Homey-Neustarts den 60‑Minuten-Timer nicht verlieren)
 * - Zählen verknüpfter Geräte (Wallbox, Battery, Grid-Meter)
 * - Sammeln von Sync-Statistiken und Snapshots
 *
 * Entkoppelt über IHpsDevice. Wird für Export, UI und Support verwendet.
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

  /**
   * Zeichnet ein Analyse-Event auf (wird nur bei detailedDiagnostics oder Warn/Error gespeichert).
   * Persistiert bei Bedarf sofort.
   */
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

  recordSyncSuccess(result: LiveData, cloudVehicleSoc?: number): void {
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
      cloudVehicleSoc,
    };
  }

  recordSyncFailure(message: string): void {
    this.lastSyncAt = new Date();
    this.lastSyncResult = 'error';
    this.recordAnalysisEvent('error', message);
  }

  /**
   * Called when the user toggles detailedDiagnostics in settings.
   * Persists the enable timestamp so auto-off can resume after restarts.
   */
  onDetailedDiagnosticsSettingChanged(enabled: boolean): void {
    if (enabled) {
      const now = Date.now();
      this.device.setStoreValue(DETAILED_DIAGNOSTICS_ENABLED_AT_KEY, now).catch(() => {});
      this.scheduleDetailedDiagnosticsAutoOff(DETAILED_DIAGNOSTICS_MAX_MS, 'timeout');
      return;
    }
    this.clearDetailedDiagnosticsAutoOff();
    this.device.setStoreValue(DETAILED_DIAGNOSTICS_ENABLED_AT_KEY, 0).catch(() => {});
  }

  /**
   * Call on device init. Restores auto-off after app/Homey restarts.
   * If still enabled but deadline is past (or no timestamp from older builds), turns off immediately.
   */
  resumeDetailedDiagnosticsAutoOff(): void {
    if (!this.isDetailedDiagnosticsEnabled()) {
      this.clearDetailedDiagnosticsAutoOff();
      return;
    }
    const enabledAt = this.readEnabledAtMs();
    if (enabledAt === null) {
      // Legacy: setting was left ON without a stored deadline (timer died on restart).
      this.device.log('Detailed diagnostics still ON without deadline — auto-disabling (legacy/stuck)');
      this.disableDetailedDiagnosticsNow('timeout-missing-deadline');
      return;
    }
    const remainingMs = enabledAt + DETAILED_DIAGNOSTICS_MAX_MS - Date.now();
    if (remainingMs <= 0) {
      this.device.log('Detailed diagnostics deadline expired during restart — auto-disabling');
      this.disableDetailedDiagnosticsNow('timeout');
      return;
    }
    this.device.log(`Detailed diagnostics still ON — auto-off in ${Math.round(remainingMs / 1000)}s`);
    this.scheduleDetailedDiagnosticsAutoOff(remainingMs, 'timeout');
  }

  /**
   * After report export: shorten remaining time to AFTER_EXPORT_MS, never beyond the 60 min safety cap.
   */
  scheduleAutoOffAfterExport(): void {
    if (!this.isDetailedDiagnosticsEnabled()) {
      return;
    }
    const enabledAt = this.readEnabledAtMs() ?? Date.now();
    const maxDeadline = enabledAt + DETAILED_DIAGNOSTICS_MAX_MS;
    const exportDeadline = Date.now() + DETAILED_DIAGNOSTICS_AFTER_EXPORT_MS;
    const delayMs = Math.max(0, Math.min(maxDeadline, exportDeadline) - Date.now());
    if (delayMs <= 0) {
      this.disableDetailedDiagnosticsNow('after-export');
      return;
    }
    this.scheduleDetailedDiagnosticsAutoOff(delayMs, 'after-export');
  }

  scheduleDetailedDiagnosticsAutoOff(delayMs: number, reason: 'timeout' | 'after-export' = 'timeout'): void {
    this.clearDetailedDiagnosticsAutoOff();
    const safeDelay = Math.max(0, delayMs);
    this.detailedDiagnosticsAutoOffTimer = this.device.homey.setTimeout(() => {
      this.disableDetailedDiagnosticsNow(reason);
    }, safeDelay);
  }

  clearDetailedDiagnosticsAutoOff(): void {
    if (this.detailedDiagnosticsAutoOffTimer) {
      // Homey setTimeout handles are cleared via the global clearTimeout in this runtime.
      clearTimeout(this.detailedDiagnosticsAutoOffTimer);
      this.detailedDiagnosticsAutoOffTimer = null;
    }
  }

  private readEnabledAtMs(): number | null {
    const raw = this.device.getStoreValue(DETAILED_DIAGNOSTICS_ENABLED_AT_KEY);
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
      return raw;
    }
    if (typeof raw === 'string') {
      const parsed = parseInt(raw, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return null;
  }

  private disableDetailedDiagnosticsNow(reason: string): void {
    this.clearDetailedDiagnosticsAutoOff();
    // Record while still enabled so the info line is kept in the analysis log.
    this.recordAnalysisEvent('info', `Detailed diagnostics auto-disabled after ${reason}`);
    this.device.setStoreValue(DETAILED_DIAGNOSTICS_ENABLED_AT_KEY, 0).catch(() => {});
    this.device.setSettings({ detailedDiagnostics: false }).catch((e: unknown) => {
      this.device.error('Failed to auto-disable detailedDiagnostics: ' + formatError(e));
    });
  }

  /**
   * Publiziert den aktuellen Diagnose-Report (als Notification oder für Export).
   * Bei force wird auch bei deaktivierter detailedDiagnostics geschrieben.
   * Gibt den Report-Text zurück (auch bei Throttling den letzten bekannten Wert).
   */
  async publishDiagnosticReport(force = false): Promise<string> {
    const now = Date.now();
    if (!force && now - this.lastDiagnosticPublish < 60000) {
      const existing = this.device.getSetting('diagnosticReport');
      return typeof existing === 'string' ? existing : '';
    }
    this.lastDiagnosticPublish = now;

    try {
      const report = this.diagnostic.formatReport(this.createSnapshot());
      updateCapabilityValue('diagnostic_report', report, this.device);
      await this.device.setSettings({ diagnosticReport: report });
      return report;
    } catch (e) {
      this.device.error('publishDiagnosticReport failed: ' + formatError(e));
      const existing = this.device.getSetting('diagnosticReport');
      return typeof existing === 'string' ? existing : '';
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
      cloudVehicleSoc: this.lastSnapshot.cloudVehicleSoc,
    };
  }
}
