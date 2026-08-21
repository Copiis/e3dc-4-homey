import { PowerModeState } from '../model/home-power-station';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';
import { IHpsDevice } from '../types/hps-device';


const POWER_MODE_AUTO = 0;

/**
 * Keep-alive interval for active EMS power modes.
 * Must be short (~10s) so that E3DC keeps overrides like GRID_CHARGE (Akkunetzladen)
 * active. The Ladeplaner and manual power mode flows rely on repeated setPowerMode calls.
 * The main live data poll (SYNC_INTERVAL) is intentionally longer (30s) to reduce read load.
 */
const POWER_MODE_REFRESH_MS = 10 * 1000;

/**
 * PowerModeManager
 *
 * Verwaltet den aktuellen Power-Mode-Zustand des HKW (AUTO, IDLE, CHARGE, DISCHARGE, GRID_CHARGE).
 *
 * Zuständigkeiten:
 * - Speichern und Abfragen des aktuellen PowerModeState
 * - Scheduling von Refresh-Timern (alle 10s) für manuelle oder geplante Modi (EMS keep-alive)
 * - Revertieren zu AUTO bei Ablauf oder Erreichen von Bedingungen (untilSoc/Expiry)
 * - Expire-Timer für reine Power-Mode-Pläne werden vom EmsScheduleExecutor verwaltet
 *
 * Wird eng mit EmsScheduleManager und dem HKW-Device zusammen verwendet.
 * Alle Befehle an die RSCP-API werden über die apiFactory delegiert.
 */
export class PowerModeManager {
  private powerModeState: PowerModeState | null = null;
  private powerModeLoopId: NodeJS.Timeout | null = null;
  private consecutiveFailures = 0;

  constructor(
    private readonly device: IHpsDevice,
    private readonly apiFactory: () => RscpApi,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
  ) {}

  /**
   * Setzt den aktuellen Power-Mode-State.
   * Startet bei Bedarf den Refresh-Timer und den Expire-Timer.
   *
   * @param state - Neuer State oder null zum Deaktivieren
   */
  setPowerModeState(state: PowerModeState | null): void {
    this.powerModeState = state;
    this.consecutiveFailures = 0; // reset on new command / state change
    if (this.powerModeLoopId) {
      clearTimeout(this.powerModeLoopId);
      this.powerModeLoopId = null;
    }
    if (state !== null) {
      this.schedulePowerModeRefresh();
      // Expire timer scheduling for schedule-based plans is handled by EmsScheduleExecutor
    }
  }

  /**
   * Gibt den aktuell aktiven Power-Mode-State zurück (oder null).
   */
  getPowerModeState(): PowerModeState | null {
    return this.powerModeState;
  }

  private schedulePowerModeRefresh() {
    this.powerModeLoopId = this.device.homey.setTimeout(() => this.refreshPowerMode(), POWER_MODE_REFRESH_MS);
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
          // delegate to caller if needed
        }
        // expire timer is managed by caller (EmsScheduleExecutor) for schedule plans
        this.powerModeState = null;
        this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
          .catch((e: unknown) => this.logger.error('[Ladeplan] untilSoc revert failed: ' + formatError(e)));
        return;
      }
      // SOC target not yet reached: keep charging, ignore clock expiry
    } else if (state.expiresAt && Date.now() >= state.expiresAt) {
      this.revertPowerMode(state.scheduleId);
      return;
    }
    this.logger.log(`[Ladeplan] refreshPowerMode: sending mode=${state.mode} power=${state.powerW} (scheduleId=${state.scheduleId || 'none'})`);

    const sendAndScheduleNext = () => {
      this.apiFactory()
        .setPowerMode(state.mode, state.powerW, true, this.device)
        .then((result: unknown) => {
          if (result === false) {
            this.consecutiveFailures++;
            this.logger.log(`[Ladeplan] refreshPowerMode result for ${state.scheduleId || 'unknown'}: false (failures=${this.consecutiveFailures})`);
            this.device.recordAnalysisEvent('warn', `Power Mode abgelehnt durch HKW (möglicherweise AI360-Modus, Entladesperre oder interne Optimierung aktiv). Mode=${state.mode} schedule=${state.scheduleId || 'unknown'}`);

            // Throttle on repeated failures (point 2)
            if (this.consecutiveFailures >= 3) {
              this.logger.log(`[Ladeplan] Too many consecutive Power Mode rejections (${this.consecutiveFailures}), pausing refresh for 60s`);
              this.powerModeLoopId = this.device.homey.setTimeout(() => this.refreshPowerMode(), 60 * 1000);
              return;
            }
          } else {
            this.consecutiveFailures = 0;
          }
          this.schedulePowerModeRefresh();
        })
        .catch((e: unknown) => {
          this.consecutiveFailures++;
          this.logger.error('[Ladeplan] Power mode refresh failed: ' + formatError(e));
          this.schedulePowerModeRefresh();
        });
    };

    sendAndScheduleNext();
  }

  /**
   * Revert to AUTO mode. Called on expiry or manual deletion.
   * Schedule removal (if any) is the caller's responsibility (usually EmsScheduleStore).
   */
  revertPowerMode(scheduleId?: string) {
    this.logger.log(`[Ladeplan] Power mode EXPIRED, reverting to AUTO (scheduleId=${scheduleId || 'none'})`);
    this.device.recordAnalysisEvent('info', `[Ladeplan] Power mode expired for ${scheduleId || 'unknown'}`);
    if (scheduleId) {
      // caller (EMS) should clear its expire timer + remove schedule
    }
    this.powerModeState = null;
    this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
      .catch((e: unknown) => this.logger.error('[Ladeplan] auto revert failed: ' + formatError(e)));
  }

  stop() {
    if (this.powerModeLoopId) {
      clearTimeout(this.powerModeLoopId);
      this.powerModeLoopId = null;
    }
  }
}
