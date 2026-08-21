import { WallboxSchedule } from '../../model/wallbox';
import { formatError } from '../../utils/error-utils';
import { TriggeredWallboxScheduleInfo } from './WallboxScheduleExecutor';

/**
 * WallboxScheduleStore
 *
 * Zuständig für:
 * - Parsen von Schedules aus Settings
 * - Verwalten von triggeredWallboxSchedules (now with richer info for restore, e.g. saved dischargeSoc)
 * - untilFullLowPowerSince
 * - RevertDeleted (with proper restore of side effects)
 * - Persistieren von bereinigten Schedules
 */
export class WallboxScheduleStore {
  private triggeredWallboxSchedules: Map<string, TriggeredWallboxScheduleInfo> = new Map();
  private untilFullLowPowerSince: Record<string, number> = {};
  private untilFullSeenCharging: Record<string, boolean> = {};

  constructor(
    private readonly device: {
      getSetting(key: string): unknown;
      setSettings(settings: Record<string, unknown>): Promise<void>;
      log(msg: string): void;
      error(msg: string): void;
    }
  ) {}

  parseSchedules(json: string): WallboxSchedule[] {
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed as WallboxSchedule[] : [];
    } catch {
      return [];
    }
  }

  getSchedules(): WallboxSchedule[] {
    const json = (this.device.getSetting('schedules') as string) || '[]';
    return this.parseSchedules(json);
  }

  getTriggered(): Map<string, TriggeredWallboxScheduleInfo> {
    return this.triggeredWallboxSchedules;
  }

  /** Convenience for callers that need the full info object for a specific plan. */
  getTriggeredInfo(id: string): TriggeredWallboxScheduleInfo | undefined {
    return this.triggeredWallboxSchedules.get(id);
  }

  getUntilFullState(): Record<string, number> {
    return this.untilFullLowPowerSince;
  }

  addTriggered(id: string, action: string, savedDischargeSoc?: number) {
    this.triggeredWallboxSchedules.set(id, { action, savedDischargeSoc });
  }

  deleteTriggered(id: string) {
    this.triggeredWallboxSchedules.delete(id);
    delete this.untilFullLowPowerSince[id];
    delete this.untilFullSeenCharging[id];
  }

  setLowPowerSince(id: string, ts: number) {
    this.untilFullLowPowerSince[id] = ts;
  }

  deleteLowPowerSince(id: string) {
    delete this.untilFullLowPowerSince[id];
  }

  markUntilFullChargingSeen(id: string) {
    this.untilFullSeenCharging[id] = true;
  }

  hasUntilFullChargingSeen(id: string): boolean {
    return !!this.untilFullSeenCharging[id];
  }

  clear() {
    this.triggeredWallboxSchedules.clear();
    this.untilFullLowPowerSince = {};
    this.untilFullSeenCharging = {};
  }

  async persistSchedules(schedules: WallboxSchedule[]) {
    await this.device.setSettings({ schedules: JSON.stringify(schedules) }).catch(() => {});
  }

  revertDeleted(schedules: WallboxSchedule[], revertAction: (id: string, info: TriggeredWallboxScheduleInfo | string) => Promise<void>) {
    const currentIds = new Set(schedules.map(s => s.id || (s.start + '_' + s.action)));
    for (const [id, info] of this.triggeredWallboxSchedules.entries()) {
      if (!currentIds.has(id)) {
        const action = info.action;
        this.device.log(`Wallbox schedule ${id} manually deleted, reverting action ${action}${info.savedDischargeSoc !== undefined ? ' + discharge restore' : ''}`);
        revertAction(id, info).catch(e =>
          this.device.error('Error reverting deleted schedule: ' + formatError(e))
        );
        this.deleteTriggered(id);
      }
    }
  }
}
