import { EmsSchedule } from '../../model/home-power-station';
import {
  getScheduleId,
  parseDateTime,
  mapEmsModeToNumber,
  computeEndTs,
  isInWindow as utilsIsInWindow,
  POWER_MODE_AUTO,
  POWER_MODE_IDLE,
  POWER_MODE_DISCHARGE,
  POWER_MODE_CHARGE,
  POWER_MODE_GRID_CHARGE
} from '../../utils/ems-schedule-utils';

export { computeEndTs }; // re-export for consumers that need it directly

/**
 * EmsScheduleValidator
 *
 * Reine Business-Regeln für Ladepläne:
 * - Zeitfenster-Berechnung (isInWindow)
 * - Entscheidung über Expiry/Until-Typen (untilSoc, untilFull, normales Ende)
 * - Ableitung von Mode-Nummer + Expiry-Zeit
 *
 * Keine Seiteneffekte, keine API-Aufrufe, gut testbar isoliert.
 */
export class EmsScheduleValidator {
  /** Re-export der IDs und Parser für Kompatibilität */
  getScheduleId = getScheduleId;
  parseDateTime = parseDateTime;
  mapEmsModeToNumber = mapEmsModeToNumber;

  /** Zentrale POWER_MODE Konstanten */
  readonly POWER_MODE_AUTO = POWER_MODE_AUTO;
  readonly POWER_MODE_IDLE = POWER_MODE_IDLE;
  readonly POWER_MODE_DISCHARGE = POWER_MODE_DISCHARGE;
  readonly POWER_MODE_CHARGE = POWER_MODE_CHARGE;
  readonly POWER_MODE_GRID_CHARGE = POWER_MODE_GRID_CHARGE;

  /**
   * Prüft ob Schedule aktuell im aktiven Fenster liegt.
   * Nutzt die zentrale Utils-Implementierung.
   */
  isInWindow(s: EmsSchedule, now: number = Date.now()): boolean {
    return utilsIsInWindow(s, now);
  }

  /**
   * Berechnet die effektive expiresAt für einen Plan.
   * Berücksichtigt untilSoc (48h), untilFull (24h), normales Ende oder Fallback.
   */
  computeExpiry(s: EmsSchedule, startTs: number, now: number = Date.now()): number {
    if (s.untilSoc) {
      return now + 48 * 60 * 60 * 1000;
    }
    if (s.untilFull) {
      return now + 24 * 60 * 60 * 1000;
    }
    const endTs = computeEndTs(s, startTs);
    if (endTs != null && !isNaN(endTs) && endTs > now) {
      return endTs;
    }
    return now + 60 * 60 * 1000; // Fallback 1h
  }

  /**
   * Gibt zurück, ob der Plan einen untilSoc-Modus hat.
   */
  isUntilSoc(s: EmsSchedule): boolean {
    return !!s && typeof s.untilSoc === 'number';
  }

  /**
   * Gibt zurück, ob der Plan "bis voll" oder ohne Ende läuft.
   */
  isUntilFullOrOpen(s: EmsSchedule): boolean {
    return !!s && (s.untilFull === true || !s.end && !s.endTs && !s.durationMin);
  }

  /**
   * Baut den PowerModeState-ähnlichen Payload für einen Schedule auf.
   */
  buildPowerStateForSchedule(s: EmsSchedule, id: string, now: number = Date.now()) {
    const modeNum = mapEmsModeToNumber(s.mode);
    const powerW = typeof s.powerW === 'number' ? s.powerW : 0;
    const expiresAt = this.computeExpiry(s, 0, now); // startTs wird intern berechnet falls nötig

    // startTs für compute korrekt ermitteln
    const startTs = (typeof s.startTs === 'number') ? s.startTs : (s.start ? parseDateTime(s.start) : now);
    const realExpires = this.computeExpiry(s, startTs, now);

    const base = { mode: modeNum, powerW, expiresAt: realExpires, scheduleId: id };

    if (this.isUntilSoc(s)) {
      return { ...base, untilSoc: s.untilSoc };
    }
    return base;
  }

  /**
   * Hilfsfunktion: berechnet startTs robust.
   */
  getStartTs(s: EmsSchedule): number {
    return (typeof s.startTs === 'number') ? s.startTs : (s.start ? parseDateTime(s.start) : NaN);
  }

  /** Re-export compute für Kompatibilität im Manager */
  computeEndTsForSchedule(s: EmsSchedule, startTs: number): number | null {
    return computeEndTs(s, startTs);
  }
}
