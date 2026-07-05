import { PowerModeState } from '../model/home-power-station';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';
import { IHpsDevice } from '../types/hps-device';


const POWER_MODE_AUTO = 0;

/**
 * PowerModeManager
 *
 * Owns the current power mode state (auto/idle/charge/discharge/grid_charge)
 * and handles refresh/expiry timers for manual or scheduled modes.
 * Works closely with EmsScheduleManager for Ladeplan integration.
 */
export class PowerModeManager {
  private powerModeState: PowerModeState | null = null;
  private powerModeLoopId: NodeJS.Timeout | null = null;

  constructor(
    private readonly device: IHpsDevice,
    private readonly apiFactory: () => RscpApi,
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
  ) {}

  setPowerModeState(state: PowerModeState | null): void {
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

  getPowerModeState(): PowerModeState | null {
    return this.powerModeState;
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
          // delegate to caller if needed
        }
        this.clearExpireTimer(state.scheduleId || '');
        this.powerModeState = null;
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

  revertPowerMode(scheduleId?: string) {
    this.logger.log(`[Ladeplan] Power mode EXPIRED, reverting to AUTO (scheduleId=${scheduleId || 'none'})`);
    this.device.recordAnalysisEvent('info', `[Ladeplan] Power mode expired for ${scheduleId || 'unknown'}`);
    if (scheduleId) {
      this.clearExpireTimer(scheduleId);
      // caller should remove schedule if needed
    }
    this.powerModeState = null;
    this.apiFactory().setPowerMode(POWER_MODE_AUTO, 0, true, this.device)
      .catch((e: unknown) => this.logger.error('[Ladeplan] auto revert failed: ' + formatError(e)));
  }

  private scheduleExpireTimer(scheduleId: string, expiresAt: number) {
    // This is now handled in EMS manager for schedules, but keep for general
    // For now, delegate expire to caller via revert
  }

  private clearExpireTimer(scheduleId: string) {
    // no-op here, managed by caller
  }

  stop() {
    if (this.powerModeLoopId) {
      clearTimeout(this.powerModeLoopId);
      this.powerModeLoopId = null;
    }
  }
}
