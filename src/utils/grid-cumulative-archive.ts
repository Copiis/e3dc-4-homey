export const GRID_CUMULATIVE_STORE_KEY = 'gridCumulativeArchive';
export const GRID_CUMULATIVE_LOGIC_VERSION_KEY = 'gridCumulativeLogicVersion';
/** Bump when cumulative (gesamt) derivation changes — resets archive on existing devices. */
export const GRID_CUMULATIVE_LOGIC_VERSION = 2;

/** Previous day had meaningful consumption before E3DC reset. */
export const GRID_DAY_ROLLOVER_MIN_PREVIOUS_KWH = 0.3;
/** New day values are effectively zero after E3DC reset. */
export const GRID_DAY_ROLLOVER_MAX_NEW_KWH = 0.05;

export interface GridCumulativeArchive {
  importedKwh: number;
  exportedKwh: number;
  /** Local calendar date (YYYY-MM-DD) of the last successful today-sync. */
  lastSyncedDate?: string;
  /** Local calendar date (YYYY-MM-DD) last merged into importedKwh/exportedKwh. */
  lastArchivedDate?: string;
}

export interface GridDayKwh {
  importKwh: number;
  exportKwh: number;
}

export function emptyGridCumulativeArchive(): GridCumulativeArchive {
  return { importedKwh: 0, exportedKwh: 0 };
}

export function loadGridCumulativeArchive(stored: GridCumulativeArchive | undefined): GridCumulativeArchive {
  if (!stored) {
    return emptyGridCumulativeArchive();
  }
  const lastSyncedDate = stored.lastSyncedDate
    ?? (stored as { lastProcessedDate?: string }).lastProcessedDate;
  return {
    importedKwh: Number(stored.importedKwh) || 0,
    exportedKwh: Number(stored.exportedKwh) || 0,
    lastSyncedDate,
    lastArchivedDate: stored.lastArchivedDate,
  };
}

export function localDateString(timezone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function addDaysToLocalDateString(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  // Use UTC-based arithmetic for the calendar day label.
  // This avoids the runtime's local timezone affecting the computed YYYY-MM-DD
  // (e.g. when crossing month/year boundaries or in non-UTC environments).
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLocalHourMinute(timezone: string, date: Date): { hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? 0);
  return { hour, minute };
}

/** UTC instant for 00:00 on a local calendar day in the given IANA timezone. */
export function startOfLocalCalendarDay(timezone: string, dayOffset = 0, now: Date = new Date()): Date {
  const targetYmd = addDaysToLocalDateString(localDateString(timezone, now), dayOffset);
  const [year, month, day] = targetYmd.split('-').map(Number);
  const baseUtc = Date.UTC(year, month - 1, day, 0, 0, 0);
  for (let hour = -12; hour <= 36; hour++) {
    const candidate = new Date(baseUtc + hour * 3_600_000);
    if (localDateString(timezone, candidate) !== targetYmd) {
      continue;
    }
    const { hour: localHour, minute: localMinute } = getLocalHourMinute(timezone, candidate);
    if (localHour === 0 && localMinute === 0) {
      return candidate;
    }
  }
  return new Date(baseUtc);
}

/** E3DC history: gridIn = export (Einspeisung), gridOut = import (Bezug), values in Wh. */
export function gridDayTotalsKwh(gridInWh: number, gridOutWh: number): { exportKwh: number; importKwh: number } {
  return {
    exportKwh: Math.max(0, gridInWh) / 1000,
    importKwh: Math.max(0, gridOutWh) / 1000,
  };
}

export function gridDayKwhFromCapabilities(importKwh: number, exportKwh: number): GridDayKwh {
  return {
    importKwh: Math.max(0, importKwh),
    exportKwh: Math.max(0, exportKwh),
  };
}

export function gridDayKwhFromSummary(gridInWh: number, gridOutWh: number): GridDayKwh {
  const totals = gridDayTotalsKwh(gridInWh, gridOutWh);
  return { importKwh: totals.importKwh, exportKwh: totals.exportKwh };
}

export function isDayValueHigh(day: GridDayKwh): boolean {
  return day.importKwh > GRID_DAY_ROLLOVER_MAX_NEW_KWH || day.exportKwh > GRID_DAY_ROLLOVER_MAX_NEW_KWH;
}

export function dayValuesDroppedForRollover(previous: GridDayKwh, current: GridDayKwh): boolean {
  const importDropped = previous.importKwh >= GRID_DAY_ROLLOVER_MIN_PREVIOUS_KWH
    && current.importKwh <= GRID_DAY_ROLLOVER_MAX_NEW_KWH;
  const exportDropped = previous.exportKwh >= GRID_DAY_ROLLOVER_MIN_PREVIOUS_KWH
    && current.exportKwh <= GRID_DAY_ROLLOVER_MAX_NEW_KWH;
  return importDropped || exportDropped;
}

/** True when at least one local calendar day since last archive still needs merging. */
export function needsArchiveCatchUp(archive: GridCumulativeArchive, todayStr: string): boolean {
  if (!archive.lastArchivedDate) {
    return !!(archive.lastSyncedDate && archive.lastSyncedDate < todayStr);
  }
  const yesterdayStr = addDaysToLocalDateString(todayStr, -1);
  return archive.lastArchivedDate < yesterdayStr;
}

export function addDayKwhToArchive(archive: GridCumulativeArchive, day: GridDayKwh): GridCumulativeArchive {
  return {
    ...archive,
    importedKwh: archive.importedKwh + day.importKwh,
    exportedKwh: archive.exportedKwh + day.exportKwh,
  };
}

export function cumulativeTotalsFromArchive(
  archive: GridCumulativeArchive,
  todayImportKwh: number,
  todayExportKwh: number,
): { importedKwh: number; exportedKwh: number } {
  return {
    importedKwh: archive.importedKwh + todayImportKwh,
    exportedKwh: archive.exportedKwh + todayExportKwh,
  };
}