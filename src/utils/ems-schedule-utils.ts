import { EmsSchedule } from '../model/home-power-station';

/**
 * Utility helpers for EMS/Ladeplan schedules.
 * Extracted to keep EmsScheduleManager focused and prepare for potential
 * further split (ScheduleStore / Executor / Validator) as recommended.
 */

export function getScheduleId(s: EmsSchedule): string {
  return s.id || (s.start + '_' + (s.mode || ''));
}

export function parseDateTime(str: string): number {
  if (!str || typeof str !== 'string') return NaN;
  const d = new Date(str);
  return isNaN(d.getTime()) ? NaN : d.getTime();
}

export function pruneExpiredSchedules(schedules: EmsSchedule[], now: number = Date.now()): EmsSchedule[] {
  return schedules.filter((s: EmsSchedule) => {
    if (s.untilSoc || s.untilFull) return true;
    const eTs = (typeof s.endTs === 'number') ? s.endTs : (s.end ? parseDateTime(s.end) : null);
    if (eTs != null) {
      if (!isNaN(eTs) && now >= eTs) {
        return false;
      }
      return true;
    }
    return true;
  });
}

export function mapEmsModeToNumber(mode: string): number {
  const m = (mode || '').toLowerCase().trim();
  if (m === 'idle' || m === 'stop') return 1;
  if (m === 'discharge') return 2;
  if (m === 'charge') return 3;
  if (m === 'gridcharge' || m === 'grid_charge' || m === 'netz') return 4;
  return 0; // auto
}
