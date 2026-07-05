import Homey, {SimpleClass} from 'homey';
import {clearTimeout} from 'node:timers';
import {GridMeter} from '../../src/model/grid-meter';
import {GridMeterConfig} from '../../src/model/grid-meter.config';
import {HomePowerStation} from '../../src/model/home-power-station';
import {SummaryType} from '../../src/model/summary.config';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {GRID_METER_CAPABILITY_ORDER, reorderCapabilitiesIfNeeded} from '../../src/utils/capability-order';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import {formatError} from '../../src/utils/error-utils';
import {
  GRID_CUMULATIVE_LOGIC_VERSION,
  GRID_CUMULATIVE_LOGIC_VERSION_KEY,
  GRID_CUMULATIVE_STORE_KEY,
  GridCumulativeArchive,
  GridDayKwh,
  addDayKwhToArchive,
  cumulativeTotalsFromArchive,
  dayValuesDroppedForRollover,
  gridDayKwhFromCapabilities,
  gridDayKwhFromSummary,
  gridDayTotalsKwh,
  isDayValueHigh,
  loadGridCumulativeArchive,
  localDateString,
  needsArchiveCatchUp,
  addDaysToLocalDateString,
} from '../../src/utils/grid-cumulative-archive';

const TODAY_SYNC_INTERVAL_MS = 1000 * 60 * 5;

/**
 * GridMeterDevice
 *
 * Repräsentiert einen externen Netz-Zähler (Grid-Meter) für das E3DC-System.
 * Verantwortlich für:
 * - Messung von Import/Export (kWh und W)
 * - Kumulative Archive für Tages-/Monatswerte
 * - Rollover-Erkennung und Catch-Up Logik
 * - Synchronisation mit dem zentralen HKW
 *
 * Nutzt grid-cumulative-archive Utils für saubere Langzeit-Speicherung.
 * Folgt demselben Schönheitsstandard wie HKW und Wallbox (Athom Beauty).
 */
class GridMeterDevice extends Homey.Device implements GridMeter {

  private todayLoopId: NodeJS.Timeout | null = null;
  private lastSyncedDate?: string;

  /**
   * Initialisiert den GridMeterDevice.
   * Stellt Capabilities sicher, lädt Archive und startet Sync.
   */
  async onInit() {
    this.log('GridMeterDevice has been initialized');
    try {
      await ensureCapabilities(this, [
        'meter_power.imported',
        'meter_power.exported',
        'measure_grid_in',
        'measure_grid_out',
      ]);
      await reorderCapabilitiesIfNeeded(this, GRID_METER_CAPABILITY_ORDER);
      this.ensureCumulativeLogicVersion();
      const archive = this.loadArchive();
      this.lastSyncedDate = archive.lastSyncedDate;
      setTimeout(() => this.scheduleTodaySync(), 5000);
    } catch (e) {
      this.error('Grid meter onInit failed: ' + formatError(e));
    }
  }

  async onAdded() {
    this.log('GridMeterDevice has been added');
  }

  /**
   * rawGridDeliveryW: EMS POWER_GRID (same as HPS measure_grid_delivery).
   * No sign normalization — matches HKW display convention on this firmware.
   */
  sync(rawGridDeliveryW: number): void {
    updateCapabilityValue('measure_power', rawGridDeliveryW, this);
    this.updateCumulativeMeters();
  }

  private ensureCumulativeLogicVersion(): void {
    const storedVersion = this.getStoreValue(GRID_CUMULATIVE_LOGIC_VERSION_KEY) as number | undefined;
    if (storedVersion === GRID_CUMULATIVE_LOGIC_VERSION) {
      return;
    }
    this.unsetStoreValue(GRID_CUMULATIVE_STORE_KEY).catch(() => undefined);
    this.setStoreValue(GRID_CUMULATIVE_LOGIC_VERSION_KEY, GRID_CUMULATIVE_LOGIC_VERSION).catch(() => undefined);
    this.lastSyncedDate = undefined;
    this.log('Grid cumulative archive reset for v' + GRID_CUMULATIVE_LOGIC_VERSION);
  }

  private loadArchive(): GridCumulativeArchive {
    return loadGridCumulativeArchive(this.getStoreValue(GRID_CUMULATIVE_STORE_KEY) as GridCumulativeArchive | undefined);
  }

  private saveArchive(archive: GridCumulativeArchive): void {
    this.setStoreValue(GRID_CUMULATIVE_STORE_KEY, archive).catch(() => undefined);
  }

  private updateCumulativeMeters(): void {
    const archive = this.loadArchive();
    const today = this.readTodayFromCapabilities();
    const totals = cumulativeTotalsFromArchive(archive, today.importKwh, today.exportKwh);
    updateCapabilityValue('meter_power.imported', totals.importedKwh, this);
    updateCapabilityValue('meter_power.exported', totals.exportedKwh, this);
  }

  private readTodayFromCapabilities(): GridDayKwh {
    const exportKwh = Number(this.getCapabilityValue('measure_grid_in')) || 0;
    const importKwh = Number(this.getCapabilityValue('measure_grid_out')) || 0;
    return gridDayKwhFromCapabilities(importKwh, exportKwh);
  }

  private resolveArchivedDate(todayStr: string, lastSyncedDate?: string): string {
    if (lastSyncedDate && lastSyncedDate < todayStr) {
      return lastSyncedDate;
    }
    // Delegate to the timezone-safe helper (fixed to use UTC day arithmetic).
    return addDaysToLocalDateString(todayStr, -1);
  }

  private shouldArchiveDate(archive: GridCumulativeArchive, archivedDate: string): boolean {
    return !archive.lastArchivedDate || archivedDate > archive.lastArchivedDate;
  }

  private async applyDayRollover(
    archive: GridCumulativeArchive,
    previousToday: GridDayKwh,
    newToday: GridDayKwh,
    todayStr: string,
    timezone: string,
    station: HomePowerStation,
  ): Promise<GridCumulativeArchive> {
    const dropDetected = dayValuesDroppedForRollover(previousToday, newToday);
    if (dropDetected) {
      const archivedDate = this.resolveArchivedDate(todayStr, archive.lastSyncedDate);
      if (this.shouldArchiveDate(archive, archivedDate)) {
        const updated = addDayKwhToArchive(archive, previousToday);
        this.log(
          `Grid day rollover: archived ${archivedDate} from today drop (+${previousToday.importKwh.toFixed(2)} kWh import, +${previousToday.exportKwh.toFixed(2)} kWh export)`,
        );
        return { ...updated, lastArchivedDate: archivedDate };
      }
      return archive;
    }

    if (!needsArchiveCatchUp(archive, todayStr)) {
      return archive;
    }

    if (isDayValueHigh(newToday)) {
      this.log(
        `Grid day rollover: waiting for today reset (import ${newToday.importKwh.toFixed(2)} / export ${newToday.exportKwh.toFixed(2)} kWh)`,
      );
      return archive;
    }

    const archivedDate = this.resolveArchivedDate(todayStr, archive.lastSyncedDate);
    if (!this.shouldArchiveDate(archive, archivedDate)) {
      return archive;
    }

    if (isDayValueHigh(previousToday)) {
      const updated = addDayKwhToArchive(archive, previousToday);
      this.log(
        `Grid day rollover: archived ${archivedDate} from date fallback (+${previousToday.importKwh.toFixed(2)} kWh import, +${previousToday.exportKwh.toFixed(2)} kWh export)`,
      );
      return { ...updated, lastArchivedDate: archivedDate };
    }

    try {
      const yesterdayResult = await station.getApi().readSummaryData(SummaryType.YESTERDAY, true, this, timezone);
      const dayTotals = gridDayTotalsKwh(yesterdayResult.gridIn, yesterdayResult.gridOut);
      const updated = {
        ...archive,
        importedKwh: archive.importedKwh + dayTotals.importKwh,
        exportedKwh: archive.exportedKwh + dayTotals.exportKwh,
        lastArchivedDate: archivedDate,
      };
      this.log(
        `Grid day rollover: archived ${archivedDate} from yesterday API (+${dayTotals.importKwh.toFixed(2)} kWh import, +${dayTotals.exportKwh.toFixed(2)} kWh export)`,
      );
      return updated;
    } catch (e) {
      this.error('Grid yesterday archive failed: ' + formatError(e));
      return archive;
    }
  }

  private scheduleTodaySync(): void {
    this.syncToday()
      .finally(() => {
        this.todayLoopId = setTimeout(() => this.scheduleTodaySync(), TODAY_SYNC_INTERVAL_MS);
      });
  }

  private syncToday(): Promise<void> {
    return new Promise(resolve => {
      const station = this.resolveLinkedStation();
      if (!station) {
        resolve();
        return;
      }
      const timezone = this.homey.clock.getTimezone();
      const todayStr = localDateString(timezone);
      const previousToday = this.readTodayFromCapabilities();
      station.getApi()
        .readSummaryData(SummaryType.TODAY, true, this, timezone)
        .then(async todayResult => {
          const newToday = gridDayKwhFromSummary(todayResult.gridIn, todayResult.gridOut);
          let archive = this.loadArchive();
          archive = await this.applyDayRollover(archive, previousToday, newToday, todayStr, timezone, station);

          updateCapabilityValue('measure_grid_in', newToday.exportKwh, this);
          updateCapabilityValue('measure_grid_out', newToday.importKwh, this);

          archive = { ...archive, lastSyncedDate: todayStr };
          this.saveArchive(archive);
          this.lastSyncedDate = todayStr;
          this.updateCumulativeMeters();
          resolve();
        })
        .catch(e => {
          this.error('Grid today sync failed: ' + formatError(e));
          resolve();
        });
    });
  }

  private resolveLinkedStation(): HomePowerStation | undefined {
    const config = this.getStoreValue('settings') as GridMeterConfig | undefined;
    if (!config?.stationId) {
      this.log('Grid today sync skipped: no station link in store');
      return undefined;
    }
    const station = this.homey.drivers.getDriver('home-power-station').getDevices()
      .find((device: unknown) => {
        const d = device as { getId?: () => string };
        return d.getId && d.getId() === config.stationId;
      }) as HomePowerStation | undefined;
    if (!station?.getApi) {
      this.log('Grid today sync skipped: linked HPS not found');
      return undefined;
    }
    return station;
  }

  async onRenamed(name: string) {
    this.log('GridMeterDevice was renamed to ' + name);
  }

  async onDeleted() {
    this.log('GridMeterDevice has been deleted');
    if (this.todayLoopId) {
      clearTimeout(this.todayLoopId);
    }
  }

  asSimple(): SimpleClass {
    return this;
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }
}

module.exports = GridMeterDevice;