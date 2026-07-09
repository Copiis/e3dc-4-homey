import { PowerModeState, EmsSchedule } from '../../model/home-power-station';
import { RscpApi } from '../../rscp-api';
import { formatError } from '../../utils/error-utils';
import { IHpsDevice } from '../../types/hps-device';
import type { PowerModeManager } from '../power-mode-manager';
import { EmsScheduleValidator } from './EmsScheduleValidator';

/**
 * EmsScheduleExecutor
 *
 * Zuständig für:
 * - Ausführen von setPowerMode via RSCP API
 * - Revert-Logik (AUTO + Schedule entfernen)
 * - UntilSoc-Checks während Refresh
 * - Koordination mit PowerModeManager für State
 *
 * Enthält die Execution + Teile der Scheduling-Business-Logik für Reverts.
 */
export class EmsScheduleExecutor {
  private scheduledExpireTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(
    private readonly device: IHpsDevice,
    private readonly apiFactory: () => RscpApi,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly powerModeManager?: PowerModeManager,
    private readonly validator: EmsScheduleValidator = new EmsScheduleValidator()
  ) {}

  /** Delegiert State an PowerModeManager (wenn vorhanden) oder fällt zurück */
  setPowerModeState(state: PowerModeState | null): void {
    if (this.powerModeManager) {
      this.powerModeManager.setPowerModeState(state);
    } else {
      // Fallback nur für sehr alte Test-Szenarien – in Produktion immer PMM
      (this as any)._fallbackPowerModeState = state;
    }

    // Schedule expire timer for scheduled plans (when we have an ID + expiresAt)
    if (state?.expiresAt && state?.scheduleId) {
      this.scheduleExpireTimer(state.scheduleId, state.expiresAt, (id) => {
        this.revertPowerMode(id).catch(() => {});
      });
    }
  }

  getPowerModeState(): PowerModeState | null {
    if (this.powerModeManager) {
      return this.powerModeManager.getPowerModeState();
    }
    return (this as any)._fallbackPowerModeState ?? null;
  }

  /**
   * Führt den eigentlichen setPowerMode Aufruf aus (inkl. kleiner Retry bei false).
   */
  async executeSetPowerMode(mode: number, powerW: number, scheduleId?: string): Promise<void> {
    try {
      const result = await this.apiFactory().setPowerMode(mode, powerW, true, this.device);
      this.logger.log(`[Ladeplan] setPowerMode result for ${scheduleId || 'manual'}: ${result}`);
      if (result === false) {
        this.device.recordAnalysisEvent('warn', `Power Mode abgelehnt durch HKW (AI360-Modus / Entladesperre / interne Optimierung möglich). Mode=${mode} schedule=${scheduleId || 'manual'}`);
        setTimeout(() => {
          this.apiFactory().setPowerMode(mode, powerW, true, this.device)
            .then((r: unknown) => this.logger.log(`[Ladeplan] setPowerMode retry result: ${r}`))
            .catch(() => {});
        }, 2000);
      }
    } catch (e) {
      this.logger.error('[Ladeplan] setPowerMode failed: ' + formatError(e));
    }
  }

  /**
   * Aktiviert einen Schedule (wird von Timer oder Checker aufgerufen).
   */
  async activatePlan(s: EmsSchedule, id: string, storeRemoveIfNeeded?: (id: string) => void): Promise<void> {
    if (!s || !s.mode) return;

    const modeNum = this.validator.mapEmsModeToNumber(s.mode);
    const powerW = typeof s.powerW === 'number' ? s.powerW : 0;
    const now = Date.now();

    const state = this.validator.buildPowerStateForSchedule(s, id, now);

    this.setPowerModeState(state as PowerModeState);

    await this.executeSetPowerMode(modeNum, powerW, id);

    // Bei untilSoc oder open: State schon gesetzt
  }

  /**
   * Revert zu AUTO + optional Schedule entfernen.
   */
  async revertPowerMode(scheduleId?: string, removeFromStore?: (id: string) => void): Promise<void> {
    this.logger.log(`[Ladeplan] Power mode EXPIRED, reverting to AUTO (scheduleId=${scheduleId || 'none'})`);
    this.device.recordAnalysisEvent('info', `[Ladeplan] Power mode expired for ${scheduleId || 'unknown'}`);

    if (scheduleId && removeFromStore) {
      removeFromStore(scheduleId);
    }

    this.setPowerModeState(null);

    try {
      await this.apiFactory().setPowerMode(this.validator.POWER_MODE_AUTO, 0, true, this.device);
    } catch (e) {
      this.logger.error('[Ladeplan] auto revert failed: ' + formatError(e));
    }
  }

  /**
   * Wird periodisch aufgerufen (Refresh-Loop).
   * Prüft untilSoc und Expiry.
   */
  async refreshPowerMode(getCurrentState: () => PowerModeState | null, removeCompleted: (id: string) => void): Promise<void> {
    const state = getCurrentState();
    if (!state) return;

    if (state.untilSoc) {
      const currentSoc = this.device.getCurrentSOC() * 100;
      if (currentSoc >= state.untilSoc) {
        this.logger.log(`[Ladeplan] untilSoc ${state.untilSoc}% reached (current ${currentSoc}%), reverting to AUTO (scheduleId=${state.scheduleId || 'none'})`);
        if (state.scheduleId) {
          removeCompleted(state.scheduleId);
        }
        this.setPowerModeState(null);
        try {
          await this.apiFactory().setPowerMode(this.validator.POWER_MODE_AUTO, 0, true, this.device);
        } catch (e) {
          this.logger.error('[Ladeplan] untilSoc revert failed: ' + formatError(e));
        }
        return;
      }
    }

    if (state.expiresAt && Date.now() >= state.expiresAt) {
      await this.revertPowerMode(state.scheduleId, removeCompleted);
      return;
    }

    this.logger.log(`[Ladeplan] refreshPowerMode: sending mode=${state.mode} power=${state.powerW} (scheduleId=${state.scheduleId || 'none'})`);

    try {
      const result = await this.apiFactory().setPowerMode(state.mode, state.powerW, true, this.device);
      if (result === false) {
        this.logger.log(`[Ladeplan] refreshPowerMode result for ${state.scheduleId || 'unknown'}: false`);
        this.device.recordAnalysisEvent('warn', `Power Mode abgelehnt durch HKW (AI360-Modus / Entladesperre / interne Optimierung möglich). Mode=${state.mode} schedule=${state.scheduleId || 'unknown'}`);
      }
    } catch (e) {
      this.logger.error('[Ladeplan] Power mode refresh failed: ' + formatError(e));
    }
  }

  /**
   * Direkter Revert ohne Schedule-Entfernung (für manuelle Fälle).
   */
  async forceRevertToAuto(): Promise<void> {
    this.setPowerModeState(null);
    try {
      await this.apiFactory().setPowerMode(this.validator.POWER_MODE_AUTO, 0, true, this.device);
    } catch (e) {
      this.logger.error('[Ladeplan] force revert failed: ' + formatError(e));
    }
  }

  // --- Expire Timer Management (moved here to slim the coordinator) ---

  scheduleExpireTimer(scheduleId: string, expiresAt: number, onExpire: (id: string) => void) {
    this.clearExpireTimer(scheduleId);
    const delay = Math.max(0, expiresAt - Date.now());
    if (delay === 0) {
      onExpire(scheduleId);
      return;
    }
    const timer = setTimeout(() => {
      onExpire(scheduleId);
      this.scheduledExpireTimers.delete(scheduleId);
    }, delay);
    this.scheduledExpireTimers.set(scheduleId, timer);
  }

  clearExpireTimer(scheduleId: string) {
    const t = this.scheduledExpireTimers.get(scheduleId);
    if (t) {
      clearTimeout(t);
      this.scheduledExpireTimers.delete(scheduleId);
    }
  }

  clearAllExpireTimers() {
    this.scheduledExpireTimers.forEach((t) => clearTimeout(t));
    this.scheduledExpireTimers.clear();
  }
}
