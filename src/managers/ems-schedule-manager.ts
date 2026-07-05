import { PowerModeState, EmsSchedule } from '../model/home-power-station';
import type { PowerModeManager } from './power-mode-manager';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';
import { calculatePvSurplusW } from '../utils/pv-surplus';
import { IHpsDevice } from '../types/hps-device';
import { LiveData } from '../model/live-data';
import { ValueChanged } from '../model/value-changed';



const POWER_MODE_AUTO = 0;
const POWER_MODE_IDLE = 1;
const POWER_MODE_DISCHARGE = 2;
const POWER_MODE_CHARGE = 3;
const POWER_MODE_GRID_CHARGE = 4;

/**
 * EmsScheduleManager
 *
 * Verwaltet EMS/Ladeplan-Schedules für zeitgesteuerte Power-Modi.
 *
 * Kernaufgaben:
 * - Laden und Parsen von Schedules aus den Device-Settings
 * - Timer-Scheduling für Start/Ende von Plänen
 * - Triggern von Power-Modes (AUTO/IDLE/CHARGE/DISCHARGE/GRID_CHARGE)
 * - Behandlung von untilSoc- und untilFull-Bedingungen
 * - Aufräumen von manuell gelöschten oder abgelaufenen Plänen
 * - Bereitstellung von Surplus/SoC-Triggern via handleEmsTriggers()
 *
 * Entkoppelt über IHpsDevice und PowerModeManager. Gut testbar.
 */
export class EmsScheduleManager {
  private emsSchedules: EmsSchedule[] = [];
  private emsScheduleCheckId: NodeJS.Timeout | null = null;
  private scheduledPlanTimers: Map<string, NodeJS.Timeout> = new Map();
  private scheduledExpireTimers: Map<string, NodeJS.Timeout> = new Map();
  private triggeredEmsSchedules: Set<string> = new Set();
  lastPvSurplusW = 0;

  private powerModeState: PowerModeState | null = null;
  private powerModeLoopId: NodeJS.Timeout | null = null;

  constructor(
    private readonly device: IHpsDevice,
    private readonly apiFactory: () => RscpApi,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly powerModeManager?: PowerModeManager,  // was any, now properly referenced (imported below if needed)
  ) {}

  /**
   * Reloads EMS schedules from device settings (called on init and when settings change).
   * Also prunes expired plans and cleans triggered state for deleted ones.
   */
  /**
   * Lädt und parsed die EMS-Schedules aus den Settings.
   * Filtert abgelaufene Pläne und räumt triggered-Set auf.
   * Wird bei Init und bei Settings-Änderung aufgerufen.
   */
  loadEmsSchedules() {
    const json = (this.device.getSetting('emsSchedules') as string) || '[]';
    try {
      this.emsSchedules = JSON.parse(json);
      if (!Array.isArray(this.emsSchedules)) this.emsSchedules = [];
      this.logger.log(`[Ladeplan] device=${this.device.getData().id} raw json length: ${json.length}, parsed ${this.emsSchedules.length} plans`);
      this.device.recordAnalysisEvent('info', `[Ladeplan] Loaded ${this.emsSchedules.length} plans from settings after setting change (device=${this.device.getData().id})`);

      const now = Date.now();
      const before = this.emsSchedules.length;
      this.emsSchedules = this.emsSchedules.filter((s: EmsSchedule) => {
        if (s.untilSoc || s.untilFull) return true;
        const eTs = (typeof s.endTs === 'number') ? s.endTs : (s.end ? this.parseDateTime(s.end) : null);
        if (eTs != null) {
          if (!isNaN(eTs) && now >= eTs) {
            return false;
          }
          return true;
        }
        return true;
      });
      if (this.emsSchedules.length < before) {
        this.logger.log('Cleaned expired EMS schedules on load');
        this.device.setSettings({ emsSchedules: JSON.stringify(this.emsSchedules) })
          .catch((e: unknown) => this.logger.error('Failed to persist cleaned schedules on load: ' + formatError(e)));
      }

      if (this.powerModeState && this.powerModeState.scheduleId) {
        const activeId = this.powerModeState.scheduleId;
        const stillPresent = this.emsSchedules.some((p: EmsSchedule) => {
          const pId = p.id || (p.start + '_' + (p.mode || ''));
          return pId === activeId;
        });
        if (!stillPresent) {
          this.logger.log(`[Ladeplan] Manually deleted running schedule ${activeId} — reverting power mode to AUTO`);
          this.device.recordAnalysisEvent('info', `[Ladeplan] Manually deleted active schedule ${activeId}, reverting to AUTO`);
          this.clearExpireTimer(activeId);
          this.setPowerModeState(null);
          this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
            .catch((e: unknown) => this.logger.error('Failed to revert power mode after manual plan delete: ' + formatError(e)));
          this.triggeredEmsSchedules.delete(activeId);
        }
      }

      const currentIds = new Set(this.emsSchedules.map((s: EmsSchedule) => s.id || (s.start + '_' + (s.mode || ''))));
      this.triggeredEmsSchedules.forEach(id => {
        if (!currentIds.has(id)) this.triggeredEmsSchedules.delete(id);
      });

      for (const id of Array.from(this.scheduledExpireTimers.keys())) {
        const stillPresent = this.emsSchedules.some((s: EmsSchedule) => (s.id || (s.start + '_' + (s.mode || ''))) === id);
        if (!stillPresent) {
          this.clearExpireTimer(id);
        }
      }

      this.clearScheduledPlanTimers();
      this.clearScheduledExpireTimers();
      const nowTs = Date.now();
      for (const s of this.emsSchedules) {
        if (!s.start || !s.mode) continue;
        const startTs = (typeof s.startTs === 'number') ? s.startTs : this.parseDateTime(s.start);
        if (isNaN(startTs) || startTs <= nowTs) continue;
        const id = s.id || (s.start + '_' + (s.mode || ''));
        const delay = startTs - nowTs;
        this.logger.log(`[Ladeplan] scheduling timer for plan ${id} in ${delay}ms (start=${s.start} startTs=${startTs} now=${nowTs})`);
        this.device.recordAnalysisEvent('info', `[Ladeplan] scheduling timer for ${id} delay=${delay}ms start=${s.start}`);
        const timer = setTimeout(() => {
          this.activateScheduledPlanIfNeeded(s, id);
          this.scheduledPlanTimers.delete(id);
        }, delay);
        this.scheduledPlanTimers.set(id, timer);
      }
    } catch (e) {
      this.logger.error('Failed to parse emsSchedules: ' + formatError(e));
      this.emsSchedules = [];
    }
  }

  startEmsScheduleChecker() {
    if (this.emsScheduleCheckId) {
      clearInterval(this.emsScheduleCheckId);
    }
    this.clearScheduledPlanTimers();
    this.emsScheduleCheckId = this.device.homey.setInterval(() => this.checkEmsSchedules(), 30 * 1000);
    setTimeout(() => this.checkEmsSchedules(), 5000);
  }

  private parseDateTime(str: string): number {
    if (!str || typeof str !== 'string') return NaN;
    const d = new Date(str);
    return isNaN(d.getTime()) ? NaN : d.getTime();
  }

  /**
   * Prüft alle aktiven Schedules und triggert bei Bedarf Power-Modes.
   * Wird periodisch und bei Events aufgerufen.
   */
  checkEmsSchedules() {
    try {
      const json = (this.device.getSetting('emsSchedules') as string) || '[]';
      const fresh = JSON.parse(json);
      if (Array.isArray(fresh)) {
        if (fresh.length !== this.emsSchedules.length) {
          this.logger.log(`[Ladeplan] refreshed from setting: ${fresh.length} plans (was ${this.emsSchedules.length})`);
        }
        this.emsSchedules = fresh;
      }
    } catch (_) {}

    const now = Date.now();

    const beforeLen = this.emsSchedules.length;
    this.emsSchedules = this.emsSchedules.filter((s: EmsSchedule) => {
      if (s.untilSoc || s.untilFull) return true;
      const endTs = (typeof s.endTs === 'number') ? s.endTs : (s.end ? this.parseDateTime(s.end) : NaN);
      if (!isNaN(endTs) && now >= endTs) {
        return false;
      }
      return true;
    });
    if (this.emsSchedules.length < beforeLen) {
      this.logger.log('[Ladeplan] Removed expired plans from storage');
      const remainingIds = new Set(this.emsSchedules.map((s: EmsSchedule) => s.id || (s.start + '_' + (s.mode || ''))));
      this.triggeredEmsSchedules.forEach(id => {
        if (!remainingIds.has(id)) this.triggeredEmsSchedules.delete(id);
      });
      this.device.setSettings({ emsSchedules: JSON.stringify(this.emsSchedules) })
        .catch((e: unknown) => this.logger.error('[Ladeplan] persist cleaned schedules failed: ' + formatError(e)));
    }

    if (this.powerModeState && this.powerModeState.scheduleId) {
      const activeId = this.powerModeState.scheduleId;
      const stillPresent = this.emsSchedules.some((s: EmsSchedule) => (s.id || (s.start + '_' + (s.mode || ''))) === activeId);
      if (!stillPresent) {
        this.logger.log(`[Ladeplan] Manually deleted running schedule ${activeId} during check — reverting to AUTO`);
        this.clearExpireTimer(activeId);
        this.setPowerModeState(null);
        this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
          .catch((e: unknown) => this.logger.error('Failed to revert power mode after manual delete (check): ' + formatError(e)));
        this.triggeredEmsSchedules.delete(activeId);
      }
    }

    if (this.emsSchedules.length === 0) return;

    for (const s of this.emsSchedules) {
      if (!s || !s.start || !s.mode) continue;

      const id = s.id || (s.start + '_' + (s.mode || ''));
      let startTs = (typeof s.startTs === 'number') ? s.startTs : (s.start ? this.parseDateTime(s.start) : NaN);
      if (isNaN(startTs)) continue;

      let endTs: number | null = null;
      if (s.untilFull) {
        endTs = null;
      } else if (typeof s.endTs === 'number') {
        endTs = s.endTs;
      } else if (s.end) {
        endTs = this.parseDateTime(s.end);
      } else if (s.durationMin) {
        endTs = startTs + s.durationMin * 60 * 1000;
      }

      const isInWindow = now >= startTs && (endTs === null || now < endTs);

      if (isInWindow && !this.triggeredEmsSchedules.has(id)) {
        this.logger.log(`[Ladeplan] TRIGGERING id=${id} mode=${s.mode} powerW=${s.powerW}`);

        const modeNum = this.mapEmsModeToNumber(s.mode);
        const powerW = typeof s.powerW === 'number' ? s.powerW : 0;
        const scheduleId = id;

        if (s.untilSoc) {
          this.setPowerModeState({ mode: modeNum, powerW, expiresAt: Date.now() + 48 * 60 * 60 * 1000, untilSoc: s.untilSoc, scheduleId });
          this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
            .catch((e: unknown) => this.logger.error('Scheduled untilSoc powerMode failed: ' + formatError(e)));
        } else if (s.untilFull || !endTs) {
          this.setPowerModeState({ mode: modeNum, powerW, expiresAt: Date.now() + 24 * 60 * 60 * 1000, scheduleId });
          this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
            .catch((e: unknown) => this.logger.error('Scheduled open powerMode failed: ' + formatError(e)));
        } else {
          const expiresAt = endTs || (Date.now() + 60 * 60 * 1000);
          this.setPowerModeState({ mode: modeNum, powerW, expiresAt, scheduleId });
          this.logger.log(`[Ladeplan] sending setPowerMode mode=${modeNum} power=${powerW} expiresAt=${expiresAt}`);
          this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
            .then((result: unknown) => {
              this.logger.log(`[Ladeplan] setPowerMode result for ${id}: ${result}`);
              if (result === false) {
                setTimeout(() => {
                  this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
                    .then((r: unknown) => this.logger.log(`[Ladeplan] setPowerMode retry result for ${id}: ${r}`))
                    .catch(() => {});
                }, 2000);
              }
            })
            .catch((e: unknown) => this.logger.error('[Ladeplan] setPowerMode failed: ' + formatError(e)));
        }

        this.triggeredEmsSchedules.add(id);
      }

      if (endTs && now > endTs && this.triggeredEmsSchedules.has(id)) {
        this.triggeredEmsSchedules.delete(id);
      }
    }
  }

  private mapEmsModeToNumber(mode: string): number {
    const m = (mode || '').toLowerCase().trim();
    if (m === 'auto' || m === '0') return POWER_MODE_AUTO;
    if (m === 'idle' || m === 'pause' || m === '1') return POWER_MODE_IDLE;
    if (m === 'discharge' || m === 'entladen' || m === '2') return POWER_MODE_DISCHARGE;
    if (m === 'charge' || m === 'laden' || m === '3') return POWER_MODE_CHARGE;
    if (m === 'grid_charge' || m === 'netz_laden' || m === 'grid' || m === '4') return POWER_MODE_GRID_CHARGE;
    return POWER_MODE_AUTO;
  }

  private removeCompletedEmsSchedule(scheduleId: string) {
    const before = this.emsSchedules.length;
    this.emsSchedules = this.emsSchedules.filter((s: EmsSchedule) => {
      const sId = s.id || (s.start + '_' + (s.mode || ''));
      return sId !== scheduleId;
    });
    if (this.emsSchedules.length < before) {
      this.logger.log(`Removing completed EMS schedule ${scheduleId}`);
      this.device.setSettings({ emsSchedules: JSON.stringify(this.emsSchedules) })
        .catch((e: unknown) => this.logger.error('Failed to persist removed EMS schedule: ' + formatError(e)));
    }
  }

  private activateScheduledPlanIfNeeded(s: EmsSchedule, id: string) {
    const stillPresent = this.emsSchedules.some((p: EmsSchedule) => (p.id || (p.start + '_' + (p.mode || ''))) === id);
    if (!stillPresent || this.triggeredEmsSchedules.has(id)) return;

    const now = Date.now();
    let startTs = (typeof s.startTs === 'number') ? s.startTs : (s.start ? this.parseDateTime(s.start) : NaN);
    let endTs: number | null = null;
    if (typeof s.endTs === 'number') endTs = s.endTs;
    else if (s.end) endTs = this.parseDateTime(s.end);
    else if (s.durationMin) endTs = startTs + s.durationMin * 60 * 1000;

    const isInWindow = now >= startTs && (endTs === null || now < endTs);
    if (!isInWindow) {
      if (Math.random() < 0.05) this.logger.log(`[Ladeplan] timer fired but isInWindow=false for ${id}`);
      return;
    }

    this.logger.log(`EMS schedule triggered (timer): ${s.mode} ${s.powerW || 0}W`);

    const modeNum = this.mapEmsModeToNumber(s.mode);
    const powerW = typeof s.powerW === 'number' ? s.powerW : 0;
    const scheduleId = id;

    if (s.untilSoc) {
      this.setPowerModeState({ mode: modeNum, powerW, expiresAt: now + 48 * 60 * 60 * 1000, untilSoc: s.untilSoc, scheduleId });
      this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
        .catch((e: unknown) => this.logger.error('Scheduled untilSoc powerMode failed: ' + formatError(e)));
    } else if (s.untilFull || !endTs) {
      this.setPowerModeState({ mode: modeNum, powerW, expiresAt: now + 24 * 60 * 60 * 1000, scheduleId });
      this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
        .catch((e: unknown) => this.logger.error('Scheduled open powerMode failed: ' + formatError(e)));
    } else {
      const expiresAt = endTs || (now + 60 * 60 * 1000);
      this.setPowerModeState({ mode: modeNum, powerW, expiresAt, scheduleId });
      this.apiFactory().setPowerMode(modeNum, powerW, true, this.device)
        .catch((e: unknown) => this.logger.error('Scheduled setPowerMode failed: ' + formatError(e)));
    }

    this.triggeredEmsSchedules.add(id);
  }

  setPowerModeState(state: PowerModeState | null): void {
    if (this.powerModeManager) {
      this.powerModeManager.setPowerModeState(state);
    } else {
      this.powerModeState = state;
      if (this.powerModeLoopId) {
        clearTimeout(this.powerModeLoopId);
        this.powerModeLoopId = null;
      }
      if (state !== null) {
        this.schedulePowerModeRefresh();
        if (state.expiresAt && state.scheduleId) {
          this.scheduleExpireTimer(state.scheduleId, state.expiresAt);
        }
      }
    }
  }

  private schedulePowerModeRefresh() {
    this.powerModeLoopId = this.device.homey.setTimeout(() => this.refreshPowerMode(), 30 * 1000);
  }

  private refreshPowerMode() {
    this.powerModeLoopId = null;
    const state = this.powerModeState;
    if (!state) {
      return;
    }

    if (state.untilSoc) {
      const currentSoc = this.device.getCurrentSOC() * 100;
      if (currentSoc >= state.untilSoc) {
        this.logger.log(`[Ladeplan] untilSoc ${state.untilSoc}% reached (current ${currentSoc}%), reverting to AUTO (scheduleId=${state.scheduleId || 'none'})`);
        if (state.scheduleId) {
          this.removeCompletedEmsSchedule(state.scheduleId);
        }
        this.clearExpireTimer(state.scheduleId || '');
        this.setPowerModeState(null);
        this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
          .catch((e: unknown) => this.logger.error('[Ladeplan] untilSoc revert failed: ' + formatError(e)));
        return;
      }
    }

    if (state.expiresAt && Date.now() >= state.expiresAt) {
      this.revertPowerMode(state.scheduleId);
      return;
    }
    this.logger.log(`[Ladeplan] refreshPowerMode: sending mode=${state.mode} power=${state.powerW} (scheduleId=${state.scheduleId || 'none'})`);
    this.apiFactory()
      .setPowerMode(state.mode, state.powerW, true, this.device)
      .then((result: unknown) => {
        if (result === false) {
          this.logger.log(`[Ladeplan] refreshPowerMode result for ${state.scheduleId || 'unknown'}: false`);
          this.device.recordAnalysisEvent('info', `[Ladeplan] refresh setPowerMode result: false (schedule ${state.scheduleId || 'unknown'})`);
        }
      })
      .catch((e: unknown) => this.logger.error('[Ladeplan] Power mode refresh failed: ' + formatError(e)));
    this.schedulePowerModeRefresh();
  }

  private revertPowerMode(scheduleId?: string) {
    this.logger.log(`[Ladeplan] Power mode EXPIRED, reverting to AUTO (scheduleId=${scheduleId || 'none'})`);
    this.device.recordAnalysisEvent('info', `[Ladeplan] Power mode expired for ${scheduleId || 'unknown'}`);
    if (scheduleId) {
      this.clearExpireTimer(scheduleId);
      this.removeCompletedEmsSchedule(scheduleId);
    }
    this.setPowerModeState(null);
    this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
      .catch((e: unknown) => this.logger.error('[Ladeplan] auto revert failed: ' + formatError(e)));
  }

  private scheduleExpireTimer(scheduleId: string, expiresAt: number) {
    this.clearExpireTimer(scheduleId);
    const delay = Math.max(0, expiresAt - Date.now());
    if (delay === 0) {
      this.revertPowerMode(scheduleId);
      return;
    }
    const timer = setTimeout(() => {
      this.revertPowerMode(scheduleId);
      this.scheduledExpireTimers.delete(scheduleId);
    }, delay);
    this.scheduledExpireTimers.set(scheduleId, timer);
  }

  private clearExpireTimer(scheduleId: string) {
    const t = this.scheduledExpireTimers.get(scheduleId);
    if (t) {
      clearTimeout(t);
      this.scheduledExpireTimers.delete(scheduleId);
    }
  }

  clearScheduledPlanTimers() {
    this.scheduledPlanTimers.forEach((t: NodeJS.Timeout) => clearTimeout(t));
    this.scheduledPlanTimers.clear();
  }

  clearScheduledExpireTimers() {
    this.scheduledExpireTimers.forEach((t: NodeJS.Timeout) => clearTimeout(t));
    this.scheduledExpireTimers.clear();
  }

  stop() {
    if (this.emsScheduleCheckId) clearInterval(this.emsScheduleCheckId);
    this.clearScheduledPlanTimers();
    this.clearScheduledExpireTimers();
  }

  getEmsSchedules() { return this.emsSchedules; }

  /**
   * Clears the set of already-triggered schedules.
   * Used when the user manually deletes schedules in settings (onSettings handler).
   * Avoids private property access from the device.
   */
  /**
   * Public API to clear triggered schedule tracking.
   * Called from HKW device when user deletes schedules in the UI/widget.
   */
  /**
   * Löscht alle getriggerten Schedules (z.B. bei manuellem Löschen im UI).
   */
  clearTriggeredSchedules(): void {
    this.triggeredEmsSchedules.clear();
  }
  getPowerModeState() { return this.powerModeManager ? this.powerModeManager.getPowerModeState() : this.powerModeState; }

  /**
   * Wird von CapabilityManager bei Live-Daten aufgerufen.
   * Triggern von Surplus- oder SoC-basierten EMS-Flows.
   */
  handleEmsTriggers(result: LiveData, batteryLevelChange?: ValueChanged<number>) {
    const batteryPowerW = result.batteryDelivery * -1
    const surplus = calculatePvSurplusW(result.pvDelivery, result.houseConsumption, batteryPowerW)
    const previousSurplus = this.lastPvSurplusW || 0
    this.lastPvSurplusW = surplus

    try {
      const pvSurplusCard = this.device.homey.flow.getDeviceTriggerCard('pv_surplus_exceeds')
      pvSurplusCard.trigger(this.device, { surplus }, { surplus, previousSurplus })
        .catch((reason: unknown) => this.logger.error('PV surplus trigger failed: ' + formatError(reason)))
    } catch (e) {
      this.logger.error('PV surplus trigger card unavailable: ' + formatError(e))
    }

    if (batteryLevelChange?.oldValue != null && batteryLevelChange.newValue != null) {
      try {
        const socCard = this.device.homey.flow.getDeviceTriggerCard('battery_soc_below')
        socCard.trigger(this.device, { soc: batteryLevelChange.newValue }, {
          soc: batteryLevelChange.newValue,
          previousSoc: batteryLevelChange.oldValue,
        }).catch((reason: unknown) => this.logger.error('Battery SoC trigger failed: ' + formatError(reason)))
      } catch (e) {
        this.logger.error('Battery SoC trigger card unavailable: ' + formatError(e))
      }
    }
  }
}
