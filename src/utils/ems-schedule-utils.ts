import { EmsSchedule } from '../model/home-power-station';

/**
 * Utility helpers for EMS/Ladeplan schedules.
 * Extracted to keep EmsScheduleManager focused and prepare for potential
 * further split (ScheduleStore / Executor / Validator) as recommended.
 *
 * These are pure / stateless where possible to support EmsScheduleStore,
 * EmsScheduleValidator and EmsScheduleExecutor.
 */

export const POWER_MODE_AUTO = 0;
export const POWER_MODE_IDLE = 1;
export const POWER_MODE_DISCHARGE = 2;
export const POWER_MODE_CHARGE = 3;
export const POWER_MODE_GRID_CHARGE = 4;

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

/**
 * Compute effective endTs for a schedule (handles untilFull, explicit endTs, end, durationMin).
 */
export function computeEndTs(s: EmsSchedule, startTs: number): number | null {
  if (s.untilFull) return null;
  if (typeof s.endTs === 'number') return s.endTs;
  if (s.end) {
    const parsed = parseDateTime(s.end);
    return isNaN(parsed) ? null : parsed;
  }
  if (s.durationMin && typeof startTs === 'number' && !isNaN(startTs)) {
    return startTs + s.durationMin * 60 * 1000;
  }
  return null;
}

/**
 * Pure check: is the schedule currently inside its active time window?
 */
export function isInWindow(s: EmsSchedule, now: number = Date.now()): boolean {
  if (!s || !s.start || !s.mode) return false;
  let startTs = (typeof s.startTs === 'number') ? s.startTs : (s.start ? parseDateTime(s.start) : NaN);
  if (isNaN(startTs)) return false;

  const endTs = computeEndTs(s, startTs);
  return now >= startTs && (endTs === null || now < endTs);
}

/**
 * Returns a short description of why/ how a schedule ends (for logging).
 */
export function describeScheduleEnd(s: EmsSchedule): string {
  if (s.untilSoc) return `untilSoc=${s.untilSoc}%`;
  if (s.untilFull) return 'untilFull';
  if (s.end || s.endTs) return 'endTs';
  if (s.durationMin) return `${s.durationMin}min`;
  return 'open';
}
