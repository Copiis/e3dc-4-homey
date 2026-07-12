import {formatWallboxAlgHexSummary} from './wallbox-charging-state';

/**
 * Schweregrad für Diagnose-Events.
 */
export type DiagnosticLevel = 'info' | 'warn' | 'error';

/**
 * Ein einzelner Eintrag im Analysis-Log.
 */
export interface DiagnosticAnalysisEntry {
    at: Date;
    level: DiagnosticLevel;
    message: string;
}

/**
 * Snapshot des aktuellen Geräte-Zustands für Diagnose-Reports.
 * Wird für UI, Export und Support verwendet.
 */
export interface DiagnosticSnapshot {
    appVersion: string;
    deviceName: string;
    deviceId: string;
    homeyVersion?: string;
    available: boolean;
    syncErrorCount: number;
    lastSyncAt?: Date;
    lastSyncResult?: 'ok' | 'error';
    pvW?: number;
    houseW?: number;
    gridW?: number;
    batteryPct?: number;
    wallboxDeviceCount: number;
    batteryDeviceCount: number;
    gridMeterDeviceCount: number;
    firmware?: string;
    wallboxSocPercent?: number;
    wallboxPlugged?: boolean;
    wallboxSocRaw?: number;
    wallboxAlgPrecharge?: number;
    wallboxAlgHex?: string;
    wallboxChargePlanSoc?: number;
    wallboxChargePlanText?: string;
    detailedDiagnosticsEnabled?: boolean;
    cloudVehicleSoc?: number;
}

/** Persisted analysis events — append-only; oldest trimmed only above this count. */
export const MAX_ANALYSIS_ENTRIES = 100;

/** Total report size cap (forum copy); analysis section is never dropped before snapshot. */
export const MAX_REPORT_CHARS = 12000;

const FORUM_URL = 'https://community.homey.app/t/app-pro-e3dc-hauskraftwerke/105181';

/**
 * Parst das gespeicherte Analysis-Log aus dem Store.
 * Gibt leeres Array bei ungültigen Daten zurück.
 */
export function parseAnalysisLogFromStore(raw: unknown): DiagnosticAnalysisEntry[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const entries: DiagnosticAnalysisEntry[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') {
            continue;
        }
        const record = item as { at?: string; level?: string; message?: string };
        if (typeof record.message !== 'string' || record.message.length === 0) {
            continue;
        }
        const level = record.level === 'warn' || record.level === 'error' || record.level === 'info'
            ? record.level
            : 'info';
        const at = typeof record.at === 'string' ? new Date(record.at) : new Date();
        entries.push({ at: Number.isNaN(at.getTime()) ? new Date() : at, level, message: record.message });
    }
    return entries;
}

/**
 * Serialisiert das Analysis-Log für den Store.
 */
export function serializeAnalysisLog(entries: DiagnosticAnalysisEntry[]): Array<{ at: string; level: DiagnosticLevel; message: string }> {
    return entries.map(entry => ({
        at: entry.at.toISOString(),
        level: entry.level,
        message: entry.message,
    }));
}

export function shouldAppendAnalysisEntry(
    entries: DiagnosticAnalysisEntry[],
    level: DiagnosticLevel,
    message: string,
): boolean {
    const last = entries[entries.length - 1];
    if (last && last.level === level && last.message === message) {
        return false;
    }
    return true;
}

export function appendAnalysisEntry(
    entries: DiagnosticAnalysisEntry[],
    level: DiagnosticLevel,
    message: string,
): DiagnosticAnalysisEntry[] {
    if (!shouldAppendAnalysisEntry(entries, level, message)) {
        return entries;
    }
    const next = [...entries, { at: new Date(), level, message }];
    if (next.length <= MAX_ANALYSIS_ENTRIES) {
        return next;
    }
    return next.slice(next.length - MAX_ANALYSIS_ENTRIES);
}

/**
 * Hilfsklasse zum Aufzeichnen und Verwalten von Diagnose-Events.
 * Wird vom DiagnosticManager verwendet.
 */
export class DeviceDiagnostic {
    private analysisEntries: DiagnosticAnalysisEntry[];

    constructor(initialEntries: DiagnosticAnalysisEntry[] = []) {
        this.analysisEntries = initialEntries;
    }

    getAnalysisEntries(): readonly DiagnosticAnalysisEntry[] {
        return this.analysisEntries;
    }

    replaceAnalysisEntries(entries: DiagnosticAnalysisEntry[]): void {
        this.analysisEntries = entries;
    }

    /**
   * Zeichnet ein neues Analysis-Event auf.
   * Gibt true zurück, wenn es tatsächlich gespeichert wurde.
   */
  recordAnalysis(level: DiagnosticLevel, message: string): boolean {
        const trimmed = message.trim();
        if (trimmed.length === 0) {
            return false;
        }
        const before = this.analysisEntries.length;
        this.analysisEntries = appendAnalysisEntry(this.analysisEntries, level, trimmed);
        return this.analysisEntries.length > before;
    }

    formatReport(snapshot: DiagnosticSnapshot): string {
        const lines: string[] = [];
        lines.push('E3DC 4 Homey — Diagnosebericht / Diagnostic report');
        lines.push('(Gesamten Text markieren + kopieren oder Flow-Karte "Diagnosebericht erstellen" nutzen / Select all + copy or use Flow card "Create diagnostic report")');
        lines.push('');
        lines.push('=== Aktueller Stand / Current status ===');
        lines.push(`App: ${snapshot.appVersion}`);
        lines.push(`HKW: ${snapshot.deviceName} (${snapshot.deviceId})`);
        if (snapshot.homeyVersion) {
            lines.push(`Homey: ${snapshot.homeyVersion}`);
        }
        lines.push(`Stand / as of: ${formatTimestamp(snapshot.lastSyncAt ?? new Date())}`);
        lines.push(
            `Gerät / device: ${snapshot.available ? 'verfügbar / available' : 'nicht verfügbar / unavailable'}`
            + ` | Sync-Fehler in Folge / consecutive sync errors: ${snapshot.syncErrorCount}`,
        );
        if (snapshot.lastSyncResult) {
            lines.push(`Letzter Sync / last sync: ${snapshot.lastSyncResult}`);
        }
        lines.push(
            `Verknüpft / linked: Wallbox ${snapshot.wallboxDeviceCount}`
            + ` | Batteriemonitor ${snapshot.batteryDeviceCount}`
            + ` | Netz ${snapshot.gridMeterDeviceCount}`,
        );
        if (snapshot.firmware) {
            lines.push(`Firmware: ${snapshot.firmware}`);
        }
        if (snapshot.detailedDiagnosticsEnabled !== undefined) {
            lines.push(`Detaillierte Diagnose / detailed diagnostics: ${snapshot.detailedDiagnosticsEnabled ? 'EIN / ON' : 'AUS / OFF'}`);
        }
        lines.push('');
        lines.push('Werte / values (letzter erfolgreicher Sync / last successful sync):');
        lines.push(`  PV: ${formatW(snapshot.pvW)}`);
        lines.push(`  Haus / house: ${formatW(snapshot.houseW)}`);
        lines.push(`  Netz / grid: ${formatW(snapshot.gridW)}`);
        lines.push(`  Batterie / battery: ${formatPct(snapshot.batteryPct)}`);
        if (hasWallboxSection(snapshot)) {
            lines.push('');
            lines.push('Wallbox (letzter Sync / last sync):');
            lines.push(`  Fahrzeug-SOC / vehicle SOC: ${formatPct(snapshot.wallboxSocPercent)}`);
            if (snapshot.cloudVehicleSoc !== undefined) {
                lines.push(`  Cloud-Fallback SOC: ${formatPct(snapshot.cloudVehicleSoc)}`);
            }
            lines.push(`  Stecker / plugged: ${formatBool(snapshot.wallboxPlugged)}`);
            lines.push(`  RSCP socRaw: ${formatRaw(snapshot.wallboxSocRaw)}`);
            lines.push(`  RSCP algPrecharge: ${formatRaw(snapshot.wallboxAlgPrecharge)}`);
            lines.push(`  RSCP algHex: ${snapshot.wallboxAlgHex ?? '—'}`);
            const algSummary = formatWallboxAlgHexSummary(snapshot.wallboxAlgHex);
            if (algSummary) {
                lines.push(`  RSCP algDecode: ${algSummary}`);
            }
            lines.push(`  RSCP chargePlanSoc: ${formatRaw(snapshot.wallboxChargePlanSoc)}`);
            if (snapshot.wallboxChargePlanText) {
                lines.push(`  RSCP chargePlanText: ${snapshot.wallboxChargePlanText}`);
            }
            if (snapshot.wallboxSocPercent === 0 || snapshot.wallboxSocPercent === undefined) {
                lines.push('  Hinweis: E3/DC-Portal nutzt oft Cloud — lokales RSCP liefert bei Tesla häufig 0.');
                lines.push('  Aktuell (Stand Juli 2026): E3DC meldet selbst eingeschränkte Fahrzeugintegration im Portal ("Fahrzeug nicht verbunden").');
                lines.push('  Cloud-Fallback und lokale Werte können daher vorübergehend unzuverlässig sein.');
            }
        }
        lines.push('');
        lines.push('=== Analyse-Protokoll / Analysis log ===');
        lines.push('(Nur analyse-relevante Ereignisse, chronologisch — bleiben erhalten / analysis events, kept)');
        if (this.analysisEntries.length === 0) {
            lines.push('  (noch keine Ereignisse / no events yet)');
        } else {
            for (const entry of this.analysisEntries) {
                lines.push(`  ${formatAnalysisLine(entry)}`);
            }
        }
        lines.push('');
        lines.push(`Forum: ${FORUM_URL}`);
        lines.push('Keine Passwörter / no passwords in this report.');

        let report = lines.join('\n');
        if (report.length > MAX_REPORT_CHARS) {
            report = truncateReportPreservingAnalysis(lines, this.analysisEntries, MAX_REPORT_CHARS);
        }
        return report;
    }
}

function hasWallboxSection(snapshot: DiagnosticSnapshot): boolean {
    return snapshot.wallboxSocPercent !== undefined
        || snapshot.wallboxPlugged !== undefined
        || snapshot.wallboxAlgHex !== undefined;
}

function truncateReportPreservingAnalysis(
    lines: string[],
    analysisEntries: DiagnosticAnalysisEntry[],
    maxChars: number,
): string {
    const headerEnd = lines.findIndex(line => line.startsWith('=== Analyse-Protokoll'));
    const header = headerEnd >= 0 ? lines.slice(0, headerEnd).join('\n') : lines.join('\n');
    const footer = [
        '',
        `Forum: ${FORUM_URL}`,
        'Keine Passwörter / no passwords in this report.',
    ].join('\n');
    const analysisHeader = '=== Analyse-Protokoll / Analysis log ===\n(Nur analyse-relevante Ereignisse, chronologisch — bleiben erhalten / analysis events, kept)';
    let budget = maxChars - header.length - footer.length - analysisHeader.length - 4;
    if (budget < 200) {
        return `${header.slice(0, maxChars - 40)}\n… (gekürzt / truncated)`;
    }
    const analysisLines: string[] = [];
    for (let i = analysisEntries.length - 1; i >= 0; i--) {
        const line = `  ${formatAnalysisLine(analysisEntries[i])}`;
        if (analysisLines.join('\n').length + line.length + 1 > budget) {
            break;
        }
        analysisLines.unshift(line);
    }
    return [header, '', analysisHeader, ...analysisLines, footer].join('\n');
}

function formatTimestamp(date: Date): string {
    return date.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function formatW(value: number | undefined): string {
    if (value === undefined || Number.isNaN(value)) {
        return '—';
    }
    return `${Math.round(value)} W`;
}

function formatPct(value: number | undefined): string {
    if (value === undefined || Number.isNaN(value)) {
        return '—';
    }
    return `${Math.round(value)} %`;
}

function formatBool(value: boolean | undefined): string {
    if (value === undefined) {
        return '—';
    }
    return value ? 'ja / yes' : 'nein / no';
}

function formatRaw(value: number | undefined): string {
    if (value === undefined || Number.isNaN(value)) {
        return 'n/a';
    }
    return String(Math.round(value));
}

function formatAnalysisLine(entry: DiagnosticAnalysisEntry): string {
    const prefix = entry.level === 'error' ? 'ERR' : entry.level === 'warn' ? 'WRN' : 'INF';
    return `[${formatTimestamp(entry.at)}] ${prefix} ${entry.message}`;
}