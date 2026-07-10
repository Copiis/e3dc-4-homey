import { LiveData } from '../model/live-data';
import { WallboxConfig } from '../model/wallbox.config';
import { Wallbox } from '../model/wallbox';
import { WallboxEmsSettings } from '../model/wallbox-ems-settings';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';

/**
 * WallboxManager
 *
 * Extrahiert aus dem HKW. Verwaltet alle Wallbox-bezogenen Aspekte für eine Station.
 *
 * Aufgaben:
 * - Erkennen und Verknüpfen von Wallbox-Geräten zur aktuellen Station
 * - Weiterleiten von LiveData und EMS-Settings an die einzelnen WallboxDevices
 * - Aufräumen von Legacy-Capabilities auf dem Hauptgerät
 * - Koordination von Wallbox-spezifischen States
 *
 * Entkoppelt, nutzt Factory und Callbacks.
 */
interface WallboxDevice {
  getStoreValue(key: string): unknown;
  getName(): string;
  hasCapability(key: string): boolean;
  getCapabilityValue(key: string): unknown;
  sync(data: unknown): void;
  syncEmsSettings(settings: unknown): void;
}

export class WallboxManager {
  // In-memory cache for linked wallbox devices (addresses repeated getDevices + getStoreValue scans)
  private linkedCache: { timestamp: number; devices: WallboxDevice[] } | null = null;
  private static readonly LINKED_CACHE_TTL_MS = 60_000; // 60s — devices don't change often between polls

  // Cache for Wallbox EMS settings (battery priority etc.). Avoids 4 RSCP reads every 30s.
  private emsSettingsCache: { timestamp: number; settings: Partial<WallboxEmsSettings> } | null = null;
  private static readonly EMS_SETTINGS_TTL_MS = 5 * 60 * 1000; // 5 minutes — these settings change rarely

  constructor(
    private readonly homey: {
      drivers: { getDriver(id: string): { getDevices(): unknown[] } };
      hasCapability?: (cap: string) => boolean;
      removeCapability?: (cap: string) => Promise<void>;
    },
    private readonly stationId: string,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly apiFactory: () => RscpApi,
  ) {}

  hasLinkedWallboxes(): boolean {
    return this.getLinkedWallboxDevices().length > 0;
  }

  /**
   * Returns linked wallbox devices for this station.
   * Uses a short in-memory cache to avoid repeated getDriver().getDevices() + getStoreValue()
   * on every poll and within the same sync cycle (addresses repeated lookups).
   */
  private getLinkedWallboxDevices(): WallboxDevice[] {
    const now = Date.now();
    if (this.linkedCache && now - this.linkedCache.timestamp < WallboxManager.LINKED_CACHE_TTL_MS) {
      return this.linkedCache.devices;
    }

    const wallboxDriver = this.homey.drivers.getDriver('wallbox');
    const allDevices = wallboxDriver.getDevices();
    const linked = allDevices.filter((d: unknown) => {
      const cfg = (d as WallboxDevice).getStoreValue('settings') as { stationId?: string } | undefined;
      return cfg && String(cfg.stationId) === this.stationId;
    }) as WallboxDevice[];

    this.linkedCache = { timestamp: now, devices: linked };
    return linked;
  }

  /**
   * Handle wallbox data from a live data sync.
   * This was previously inline in handleWallbox().
   */
  handleWallboxData(data: LiveData): void {
    // Drop legacy HPS caps (once)
    if (this.homey.hasCapability?.('measure_wallbox_consumption')) {
      this.homey.removeCapability?.('measure_wallbox_consumption').then().catch(() => {});
    }
    if (this.homey.hasCapability?.('measure_wallbox_solarshare')) {
      this.homey.removeCapability?.('measure_wallbox_solarshare').then().catch(() => {});
    }

    if (data.wallboxPowerState.length === 0) {
      return;
    }

    // Single filtered list via cache (no repeated full scans + getStoreValue)
    const linkedDevices = this.getLinkedWallboxDevices();
    const linkedWallboxes: Wallbox[] = [];

    linkedDevices.forEach((d: WallboxDevice) => {
      const wallboxConfig: WallboxConfig | undefined = d.getStoreValue('settings') as WallboxConfig | undefined;
      if (!wallboxConfig?.stationId) {
        this.logger.log('Skipping wallbox device without store settings: ' + d.getName());
        return;
      }
      // stationId already filtered by getLinkedWallboxDevices, but double-check for safety
      if (wallboxConfig.stationId == this.stationId) {
        this.logger.log('Updating wallbox device: ' + d.getName());
        const wallboxDevice = d as unknown as Wallbox;
        const relevantData = data.wallboxPowerState.find(value => value.id == wallboxConfig.id);

        if (relevantData != undefined) {
          wallboxDevice.sync(relevantData);
          linkedWallboxes.push(wallboxDevice);
        } else {
          this.logger.log('Unable to find wallbox data for wallbox with id ' + wallboxConfig.id);
        }
      }
    });

    if (linkedWallboxes.length > 0) {
      this.syncEmsSettingsToWallboxes(linkedWallboxes);
    }
  }

  /**
   * Sync EMS settings (battery priority etc.) to linked wallboxes.
   * Uses 5-minute in-memory cache to avoid calling readWallboxEmsSettings (4 RSCP reads)
   * on every single live data poll.
   */
  private syncEmsSettingsToWallboxes(linkedWallboxes: Wallbox[]): void {
    const now = Date.now();
    if (this.emsSettingsCache && (now - this.emsSettingsCache.timestamp) < WallboxManager.EMS_SETTINGS_TTL_MS) {
      linkedWallboxes.forEach(w => w.syncEmsSettings(this.emsSettingsCache!.settings));
      return;
    }

    this.apiFactory()
      .readWallboxEmsSettings(true, this.logger)
      .then(emsSettings => {
        this.emsSettingsCache = { timestamp: Date.now(), settings: emsSettings };
        linkedWallboxes.forEach(wallboxDevice => wallboxDevice.syncEmsSettings(emsSettings));
      })
      .catch(e => {
        this.logger.log('Wallbox EMS settings read failed: ' + formatError(e));
      });
  }

  /**
   * Aggregate wallbox power for the widget power cache.
   * Moved from publishWidgetPowerCache.
   */
  getWallboxAggregation(): { wallboxPower: number; wallboxSolarShare: number; hasWallbox: boolean } {
    let wallboxPower = 0;
    let wallboxSolarShare = 0;
    let hasWallbox = false;

    // Single pass over cached linked devices (no double iteration, no repeated full getDevices)
    const linkedDevices = this.getLinkedWallboxDevices();
    linkedDevices.forEach((d: WallboxDevice) => {
      hasWallbox = true;
      if (d.hasCapability('measure_power')) {
        wallboxPower += Number(d.getCapabilityValue('measure_power')) || 0;
      }
      if (d.hasCapability('measure_wallbox_solarshare')) {
        wallboxSolarShare += Number(d.getCapabilityValue('measure_wallbox_solarshare')) || 0;
      }
    });

    return { wallboxPower, wallboxSolarShare, hasWallbox };
  }

}
