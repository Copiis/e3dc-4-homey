import { LiveData } from '../model/live-data';
import { RscpApi } from '../rscp-api';

export interface PollerLogger {
  log(msg: string): void;
  error(msg: string): void;
}

/**
 * Dedicated poller for live data from the E3DC station.
 * Responsibilities:
 * - Manage polling interval
 * - Apply simple debounce / freshness cache to avoid hammering RSCP
 * - Notify listeners when fresh data arrives
 *
 * This is the first extraction step to reduce the size of HomePowerStationDevice.
 */
export class LiveDataPoller {
  private timer: NodeJS.Timeout | null = null;
  private lastData: LiveData | null = null;
  private lastFetch = 0;
  private readonly listeners: Array<(data: LiveData) => void> = [];

  /**
   * @param apiFactory function that returns the current RscpApi (device may recreate it)
   * @param logger device or api logger
   * @param shouldReadWallboxes callback so we can avoid wallbox queries when none are linked
   */
  constructor(
    private readonly apiFactory: () => RscpApi,
    private readonly logger: PollerLogger,
    private readonly shouldReadWallboxes: () => boolean = () => true,
  ) {}

  /**
   * Register a listener that receives every fresh LiveData payload.
   */
  onData(listener: (data: LiveData) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Start periodic polling.
   * @param intervalMs e.g. 30000
   */
  start(intervalMs: number): void {
    this.stop();
    // initial fetch shortly after start (matches old 2s delay in device)
    setTimeout(() => this.fetch().catch(() => {}), 2000);
    this.timer = setInterval(() => this.fetch().catch(() => {}), intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Force an immediate fetch (bypasses short debounce).
   * Used e.g. for manual refresh or after important setting changes.
   */
  async forceFetch(): Promise<LiveData | undefined> {
    return this.fetch(true);
  }

  getLastData(): LiveData | null {
    return this.lastData;
  }

  private async fetch(force = false): Promise<LiveData | undefined> {
    const now = Date.now();
    const DEBOUNCE_MS = 5000;

    if (!force && this.lastData && now - this.lastFetch < DEBOUNCE_MS) {
      this.logger.log('LiveDataPoller: skipping fetch (debounce)');
      return this.lastData;
    }

    try {
      const api = this.apiFactory();
      const readWallboxes = this.shouldReadWallboxes();
      const data = await api.readLiveData(true, this.logger as any, readWallboxes);

      this.lastData = data;
      this.lastFetch = now;

      this.listeners.forEach(listener => {
        try {
          listener(data);
        } catch (err) {
          this.logger.error('LiveDataPoller listener error: ' + (err as Error).message);
        }
      });

      return data;
    } catch (err) {
      this.logger.error('LiveDataPoller fetch failed: ' + (err as Error).message);
      return undefined;
    }
  }
}
