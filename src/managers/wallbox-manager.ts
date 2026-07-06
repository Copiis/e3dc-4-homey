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
    const wallboxDriver = this.homey.drivers.getDriver('wallbox');
    return wallboxDriver.getDevices().some((d: unknown) => {
      const cfg = (d as WallboxDevice).getStoreValue('settings') as { stationId?: string } | undefined;
      return cfg && String(cfg.stationId) === this.stationId;
    });
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

    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices();
    const linkedWallboxes: Wallbox[] = [];

    wallboxDevices.forEach((currentDevice: unknown) => {
      const d = currentDevice as WallboxDevice;
      const wallboxConfig: WallboxConfig | undefined = d.getStoreValue('settings') as WallboxConfig | undefined;
      if (!wallboxConfig?.stationId) {
        this.logger.log('Skipping wallbox device without store settings: ' + d.getName());
        return;
      }
      if (wallboxConfig.stationId == this.stationId) {
        this.logger.log('Updating wallbox device: ' + d.getName());
        const wallboxDevice = currentDevice as unknown as Wallbox;
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
      this.apiFactory()
        .readWallboxEmsSettings(true, this.logger)
        .then(emsSettings => {
          linkedWallboxes.forEach(wallboxDevice => wallboxDevice.syncEmsSettings(emsSettings));
        })
        .catch(e => {
          this.logger.log('Wallbox EMS settings read failed: ' + formatError(e));
        });
    }
  }

  /**
   * Aggregate wallbox power for the widget power cache.
   * Moved from publishWidgetPowerCache.
   */
  getWallboxAggregation(): { wallboxPower: number; wallboxSolarShare: number; hasWallbox: boolean } {
    let wallboxPower = 0;
    let wallboxSolarShare = 0;
    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices();
    const stationId = this.stationId;

    wallboxDevices.forEach((device: unknown) => {
      const d = device as WallboxDevice;
      const config = d.getStoreValue('settings') as { stationId?: string } | undefined;
      if (String(config?.stationId) !== stationId) {
        return;
      }
      if (d.hasCapability('measure_power')) {
        wallboxPower += Number(d.getCapabilityValue('measure_power')) || 0;
      }
      if (d.hasCapability('measure_wallbox_solarshare')) {
        wallboxSolarShare += Number(d.getCapabilityValue('measure_wallbox_solarshare')) || 0;
      }
    });

    const hasWallbox = wallboxDevices.some((device: unknown) => {
      const d = device as WallboxDevice;
      const config = d.getStoreValue('settings') as { stationId?: string } | undefined;
      return String(config?.stationId) === stationId;
    });

    return { wallboxPower, wallboxSolarShare, hasWallbox };
  }

}
