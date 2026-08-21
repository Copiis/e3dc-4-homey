import { WallboxSchedule } from '../../model/wallbox';

/**
 * WallboxScheduleValidator
 *
 * Business rules for Wallbox schedules:
 * - isActive window
 * - untilFull detection logic
 * - clean expired
 */
export class WallboxScheduleValidator {
  readonly LOW_POWER_THRESHOLD = 80;
  readonly LOW_POWER_DURATION_MS = 5 * 60 * 1000;

  getId(s: WallboxSchedule): string {
    return s.id || (s.start + '_' + (s.action || ''));
  }

  isActive(s: WallboxSchedule, now: number): boolean {
    if (!s?.start || !s.action) return false;
    const startTs = typeof s.startTs === 'number' ? s.startTs : new Date(s.start).getTime();
    if (isNaN(startTs)) return false;

    let endTs: number | null = null;
    if (s.untilFull) endTs = null;
    else if (typeof s.endTs === 'number') endTs = s.endTs;
    else if (s.end) endTs = new Date(s.end).getTime();

    return now >= startTs && (endTs === null || now < endTs);
  }

  shouldRemoveForUntilFull(
    absPower: number,
    lowPowerSince: number | undefined,
    now: number,
    seenCharging: boolean = false,
  ): boolean {
    if (!seenCharging) return false;
    if (absPower >= this.LOW_POWER_THRESHOLD) return false;
    if (!lowPowerSince) return false;
    return now - lowPowerSince >= this.LOW_POWER_DURATION_MS;
  }

  filterValid(schedules: WallboxSchedule[], now: number): WallboxSchedule[] {
    return schedules.filter(s => {
      if (!s?.start) return false;
      if (s.untilFull) return true;
      const eTs = typeof s.endTs === 'number' ? s.endTs : (s.end ? new Date(s.end).getTime() : null);
      return !(eTs && now >= eTs);
    });
  }
}
