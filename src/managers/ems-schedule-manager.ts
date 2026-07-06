import { PowerModeState, EmsSchedule } from '../model/home-power-station';
import type { PowerModeManager } from './power-mode-manager';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';
import { calculatePvSurplusW } from '../utils/pv-surplus';
import { IHpsDevice } from '../types/hps-device';
import { LiveData } from '../model/live-data';
import { ValueChanged } from '../model/value-changed';
import {
  getScheduleId,
  parseDateTime,
  pruneExpiredSchedules,
  mapEmsModeToNumber,
  POWER_MODE_AUTO,
  isInWindow
} from '../utils/ems-schedule-utils';

// Neue modulare Teile (Split-Vorbereitung umgesetzt)
import { EmsScheduleStore } from './ems-schedule/EmsScheduleStore';
import { EmsScheduleValidator } from './ems-schedule/EmsScheduleValidator';
import { EmsScheduleExecutor } from './ems-schedule/EmsScheduleExecutor';

const POWER_MODE_AUTO_CONST = POWER_MODE_AUTO; // lokale Konstante für Kompatibilität

// Re-export helpers (für Tests und externe Nutzer)
export {
  getScheduleId,
  parseDateTime,
  pruneExpiredSchedules,
  mapEmsModeToNumber,
  isInWindow
} from '../utils/ems-schedule-utils';
export { POWER_MODE_AUTO, POWER_MODE_IDLE, POWER_MODE_DISCHARGE, POWER_MODE_CHARGE, POWER_MODE_GRID_CHARGE } from '../utils/ems-schedule-utils';

/**
 * EmsScheduleManager (Koordinator)
 *
 * Nach dem Split deutlich schlanker:
 * - Koordination + Timer (geplante Starts, Interval-Checker, Expire-Timer)
 * - Delegiert Store-Logik → EmsScheduleStore
 * - Delegiert Business-Regeln → EmsScheduleValidator
 * - Delegiert Execution + Revert → EmsScheduleExecutor (nutzt PowerModeManager)
 *
 * Keine Duplizierung mehr zwischen load und check.
 * Kein direktes Halten von powerModeState (außer minimaler Fallback).
 */
export class EmsScheduleManager {
  private store: EmsScheduleStore;
  private validator: EmsScheduleValidator;
  private executor: EmsScheduleExecutor;

  private emsScheduleCheckId: NodeJS.Timeout | null = null;
  private scheduledPlanTimers: Map<string, NodeJS.Timeout> = new Map();

  lastPvSurplusW = 0;

  constructor(
    private readonly device: IHpsDevice,
    private readonly apiFactory: () => RscpApi,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly powerModeManager?: PowerModeManager,
  ) {
    this.validator = new EmsScheduleValidator();
    this.store = new EmsScheduleStore(device, logger);
    this.executor = new EmsScheduleExecutor(device, apiFactory, logger, powerModeManager, this.validator);
  }

  /**
   * Lädt Schedules (delegiert komplett an Store).
   * Räumt Timer auf und plant neue zukünftige Starts.
   */
  loadEmsSchedules() {
    const schedules = this.store.loadFromSettings();

    // Prüfe ob der aktuell aktive Plan (über PowerModeState) noch existiert
    const activeState = this.getPowerModeState();
    if (activeState?.scheduleId) {
      const needsRevert = this.store.handleDeletedActiveSchedule(activeState.scheduleId);
      if (needsRevert) {
        this.logger.log(`[Ladeplan] Manually deleted running schedule ${activeState.scheduleId} — reverting power mode to AUTO`);
        this.device.recordAnalysisEvent('info', `[Ladeplan] Manually deleted active schedule ${activeState.scheduleId}, reverting to AUTO`);
        this.executor.clearExpireTimer(activeState.scheduleId);
        this.executor.setPowerModeState(null);
        this.apiFactory().setPowerMode(POWER_MODE_AUTO_CONST, 0, true, this.device)
          .catch((e: unknown) => this.logger.error('Failed to revert after manual plan delete: ' + formatError(e)));
      }
    }

    // Alte Timer löschen + neue zukünftige Starts planen
    this.clearScheduledPlanTimers();
    this.clearScheduledExpireTimers();

    const nowTs = Date.now();
    for (const s of schedules) {
      if (!s.start || !s.mode) continue;
      const startTs = (typeof s.startTs === 'number') ? s.startTs : parseDateTime(s.start);
      if (isNaN(startTs) || startTs <= nowTs) continue;

      const id = getScheduleId(s);
      const delay = startTs - nowTs;
      this.logger.log(`[Ladeplan] scheduling timer for plan ${id} in ${delay}ms`);
      this.device.recordAnalysisEvent('info', `[Ladeplan] scheduling timer for ${id} delay=${delay}ms`);

      const timer = setTimeout(() => {
        this.activateScheduledPlanIfNeeded(s, id);
        this.scheduledPlanTimers.delete(id);
      }, delay);
      this.scheduledPlanTimers.set(id, timer);
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

  /**
   * Periodischer Check – jetzt stark delegiert (keine Duplizierung mehr).
   */
  checkEmsSchedules() {
    this.store.refreshFromSettings();
    const pruned = this.store.pruneAndPersistIfNeeded();

    // Aktiver Plan gelöscht?
    const activeState = this.getPowerModeState();
    if (activeState?.scheduleId) {
      const needsRevert = this.store.handleDeletedActiveSchedule(activeState.scheduleId);
      if (needsRevert) {
        this.logger.log(`[Ladeplan] Manually deleted running schedule ${activeState.scheduleId} during check — reverting to AUTO`);
        this.executor.clearExpireTimer(activeState.scheduleId);
        this.executor.setPowerModeState(null);
        this.apiFactory().setPowerMode(POWER_MODE_AUTO_CONST, 0, true, this.device)
          .catch((e: unknown) => this.logger.error('Failed to revert (check): ' + formatError(e)));
      }
    }

    const schedules = this.store.getSchedules();
    if (schedules.length === 0) return;

    const now = Date.now();

    for (const s of schedules) {
      if (!s || !s.start || !s.mode) continue;

      const id = getScheduleId(s);
      const startTs = this.validator.getStartTs(s); // via validator
      if (isNaN(startTs)) continue;

      const endTs = this.validator.computeEndTsForSchedule(s, startTs);
      // Use the clean isInWindow from validator/utils
      const inWindow = this.validator.isInWindow(s, now);

      if (inWindow && !this.store.hasTriggered(id)) {
        this.logger.log(`[Ladeplan] TRIGGERING id=${id} mode=${s.mode} powerW=${s.powerW}`);

        const scheduleId = id;

        // State + Execution über Executor
        const powerState = this.validator.buildPowerStateForSchedule(s, id, now);
        this.executor.setPowerModeState(powerState as PowerModeState);

        const modeNum = this.validator.mapEmsModeToNumber(s.mode);
        const powerW = typeof s.powerW === 'number' ? s.powerW : 0;

        this.executor.executeSetPowerMode(modeNum, powerW, scheduleId).catch(() => {});

        this.store.addTriggered(id);
      }

      // Cleanup triggered wenn Fenster vorbei ist
      if (endTs && now > endTs && this.store.hasTriggered(id)) {
        this.store.deleteTriggered(id);
      }
    }
  }

  private async activateScheduledPlanIfNeeded(s: EmsSchedule, id: string) {
    if (!this.store.isStillPresent(id) || this.store.hasTriggered(id)) return;

    const now = Date.now();
    if (!this.validator.isInWindow(s, now)) {
      if (Math.random() < 0.05) this.logger.log(`[Ladeplan] timer fired but isInWindow=false for ${id}`);
      return;
    }

    this.logger.log(`EMS schedule triggered (timer): ${s.mode} ${s.powerW || 0}W`);

    await this.executor.activatePlan(s, id);
    this.store.addTriggered(id);
  }

  // Delegation an Executor (der wiederum PMM nutzt)
  setPowerModeState(state: PowerModeState | null): void {
    this.executor.setPowerModeState(state);
  }

  getPowerModeState(): PowerModeState | null {
    return this.executor.getPowerModeState();
  }

  clearScheduledPlanTimers() {
    this.scheduledPlanTimers.forEach((t: NodeJS.Timeout) => clearTimeout(t));
    this.scheduledPlanTimers.clear();
  }

  clearScheduledExpireTimers() {
    this.executor.clearAllExpireTimers();
  }

  stop() {
    if (this.emsScheduleCheckId) clearInterval(this.emsScheduleCheckId);
    this.clearScheduledPlanTimers();
    this.clearScheduledExpireTimers();
  }

  getEmsSchedules() {
    return this.store.getSchedules();
  }

  clearTriggeredSchedules(): void {
    this.store.clearTriggered();
  }

  /**
   * Wird von CapabilityManager bei Live-Daten aufgerufen.
   * Bleibt hier (Triggering ist eng mit EMS-Plänen verwandt).
   */
  handleEmsTriggers(result: LiveData, batteryLevelChange?: ValueChanged<number>) {
    const batteryPowerW = result.batteryDelivery;
    const surplus = calculatePvSurplusW(result.pvDelivery, result.houseConsumption, batteryPowerW);
    const previousSurplus = this.lastPvSurplusW || 0;
    this.lastPvSurplusW = surplus;

    try {
      const pvSurplusCard = this.device.homey.flow.getDeviceTriggerCard('pv_surplus_exceeds');
      pvSurplusCard.trigger(this.device, { surplus }, { surplus, previousSurplus })
        .catch((reason: unknown) => this.logger.error('PV surplus trigger failed: ' + formatError(reason)));
    } catch (e) {
      this.logger.error('PV surplus trigger card unavailable: ' + formatError(e));
    }

    if (batteryLevelChange?.oldValue != null && batteryLevelChange.newValue != null) {
      try {
        const socCard = this.device.homey.flow.getDeviceTriggerCard('battery_soc_below');
        socCard.trigger(this.device, { soc: batteryLevelChange.newValue }, {
          soc: batteryLevelChange.newValue,
          previousSoc: batteryLevelChange.oldValue,
        }).catch((reason: unknown) => this.logger.error('Battery SoC trigger failed: ' + formatError(reason)));
      } catch (e) {
        this.logger.error('Battery SoC trigger card unavailable: ' + formatError(e));
      }
    }
  }
}
