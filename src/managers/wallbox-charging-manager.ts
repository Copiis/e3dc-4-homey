import { WallboxLiveState } from '../model/wallbox-live-state';
import { WallboxCommandResult } from '../model/wallbox';
import { RscpApi } from '../rscp-api';
import { formatError } from '../utils/error-utils';
import {
  isWallboxMixedChargingAllowed,
  wallboxChargingAllowSucceeded,
  wallboxChargingBlockSucceeded,
} from '../utils/wallbox-charging-state';

/**
 * WallboxChargingManager
 *
 * Extrahierte Logik für das Ausführen und Verifizieren von Wallbox-Steuerbefehlen.
 * Zuständig für:
 * - Serialisierung von RSCP-Kommandos (gegen Race-Conditions bei parallelen Flows)
 * - Fetch + Wait-for-verification mit Retries (Live-State-Rücklesen)
 * - applyChargingAllowed / applySunMode mit Skip-Logik und Erfolgsprüfung
 * - Delegation an RscpApi für die eigentlichen Kommandos
 *
 * Ermöglicht weitere Reduktion der WallboxDevice auf Koordinator-Rolle.
 * Analog zu anderen Managern (Single Responsibility).
 */
export class WallboxChargingManager {
  private _commandChain: Promise<unknown> = Promise.resolve();

  private lastLiveState?: WallboxLiveState;
  private lastLiveAt = 0;

  private static readonly LIVE_STATE_VERIFY_DELAYS_MS = [1000, 2500, 5000];

  constructor(
    private readonly logger: { log: (msg: string) => void; error: (msg: string) => void },
    private readonly apiProvider: () => Promise<RscpApi>,
    private readonly wallboxIdProvider: () => number,
    private readonly refreshCaps: (state: WallboxLiveState) => void,
    private readonly homey: { setTimeout: (fn: (value?: unknown) => void, ms: number) => NodeJS.Timeout },
  ) {}

  /**
   * Serializes RSCP commands to avoid overlapping calls from concurrent flows.
   */
  async serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = this._commandChain.then(fn).catch(err => {
      this.logger.error('Wallbox command chain error: ' + formatError(err));
      throw err;
    });
    this._commandChain = result.catch(() => undefined);
    return result;
  }

  /**
   * Public: allow or block charging (with verification + serialization).
   */
  async applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.serialize(() => this._applyChargingAllowed(enabled, maxCurrentA, force));
  }

  private async _applyChargingAllowed(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();
    if (!force && this.shouldSkipChargingApply(enabled, live)) {
      this.refreshCaps(live);
      return { ok: true, skipped: true };
    }
    this.logger.log(`applyChargingAllowed(${enabled}): sending RSCP (force=${force}) (${this.formatWallboxAlgLog(live)})`);
    const ok = enabled ? await this.startCharging(maxCurrentA, live.chargingCanceled) : await this.stopCharging(live.chargingCanceled);
    if (!ok) return { ok: false, skipped: false };
    const after = await this.waitForLiveStateMatch(s => enabled ? wallboxChargingAllowSucceeded(live, s) : wallboxChargingBlockSucceeded(s), `applyChargingAllowed(${enabled})`);
    this.refreshCaps(after);
    const success = enabled ? wallboxChargingAllowSucceeded(live, after) : wallboxChargingBlockSucceeded(after);
    if (!success) {
      this.logger.error(`applyChargingAllowed: RSCP did not ${enabled ? 'allow' : 'block'} (${this.formatWallboxAlgLog(after)})`);
      return { ok: false, skipped: false };
    }
    this.logger.log(`applyChargingAllowed(${enabled}): success`);
    return { ok: true, skipped: false };
  }

  private shouldSkipChargingApply(enabled: boolean, live: WallboxLiveState): boolean {
    if (enabled && isWallboxMixedChargingAllowed(live)) return true;
    if (!enabled && wallboxChargingBlockSucceeded(live)) return true;
    return false;
  }

  /**
   * Public: enable/disable sun mode (with verification).
   */
  async applySunMode(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    return this.serialize(() => this._applySunMode(enabled, maxCurrentA, force));
  }

  private async _applySunMode(enabled: boolean, maxCurrentA?: number, force = false): Promise<WallboxCommandResult> {
    const live = await this.fetchLiveState();
    if (!force && ((enabled && live.sunModeActive) || (!enabled && !live.sunModeActive))) {
      this.refreshCaps(live);
      return { ok: true, skipped: true };
    }
    this.logger.log(`applySunMode(${enabled}): sending RSCP (force=${force})`);
    const ok = await this.setSunMode(enabled, maxCurrentA);
    if (!ok) return { ok: false, skipped: false };
    const after = await this.waitForLiveStateMatch(s => enabled ? s.sunModeActive : !s.sunModeActive, `applySunMode(${enabled})`);
    this.refreshCaps(after);
    const success = enabled ? after.sunModeActive : !after.sunModeActive;
    if (!success) {
      this.logger.error(`applySunMode: RSCP did not set ${enabled}`);
      return { ok: false, skipped: false };
    }
    this.logger.log(`applySunMode(${enabled}): success`);
    return { ok: true, skipped: false };
  }

  /**
   * Sets max current limit (no mode change).
   */
  async setCurrentLimit(maxCurrentA: number): Promise<boolean> {
    const api = await this.apiProvider();
    return api.setWallboxCurrentLimit(this.wallboxIdProvider(), maxCurrentA, true, this.logger);
  }

  /**
   * Start/resume charging.
   */
  async startCharging(maxCurrentA?: number, chargingCanceled = false): Promise<boolean> {
    const api = await this.apiProvider();
    const wallboxId = this.wallboxIdProvider();
    if (chargingCanceled) {
      this.logger.log('startCharging: toggling charging pause before mixed mode');
    }
    return api.startWallboxCharging(wallboxId, maxCurrentA, chargingCanceled, true, this.logger);
  }

  /**
   * Stop/pause charging.
   */
  async stopCharging(chargingCanceled = false): Promise<boolean> {
    if (chargingCanceled) {
      this.logger.log('stopCharging: already paused, skip toggle');
      return true;
    }
    const api = await this.apiProvider();
    return api.stopWallboxCharging(this.wallboxIdProvider(), true, this.logger);
  }

  /**
   * Set sun mode on/off.
   */
  async setSunMode(enabled: boolean, maxCurrentA?: number): Promise<boolean> {
    const api = await this.apiProvider();
    return api.setWallboxSunMode(this.wallboxIdProvider(), enabled, maxCurrentA, true, this.logger);
  }

  private async fetchLiveState(): Promise<WallboxLiveState> {
    const api = await this.apiProvider();
    const state = await api.readWallboxLiveStateById(this.wallboxIdProvider(), true, this.logger);
    this.lastLiveState = state;
    this.lastLiveAt = Date.now();
    return state;
  }

  private async waitForLiveStateMatch(
    matches: (state: WallboxLiveState) => boolean,
    label: string,
  ): Promise<WallboxLiveState> {
    let last = await this.fetchLiveState();
    if (matches(last)) {
      this.logger.log(`${label}: verified immediately (${this.formatWallboxAlgLog(last)})`);
      return last;
    }

    for (const delayMs of WallboxChargingManager.LIVE_STATE_VERIFY_DELAYS_MS) {
      await new Promise(resolve => this.homey.setTimeout(resolve, delayMs));
      last = await this.fetchLiveState();
      if (matches(last)) {
        this.logger.log(`${label}: verified after ${delayMs}ms (${this.formatWallboxAlgLog(last)})`);
        return last;
      }
    }

    this.logger.log(`${label}: state unchanged after retries (${this.formatWallboxAlgLog(last)})`);
    return last;
  }

  private formatWallboxAlgLog(state: WallboxLiveState): string {
    const hex = state.socDiagnostics?.algHex ?? 'n/a';
    return `chargingEnabled=${state.chargingEnabled}, chargingCanceled=${state.chargingCanceled}, `
      + `sunMode=${state.sunModeActive}, chargingActive=${state.chargingActive}, algHex=${hex}`;
  }

  /**
   * Allows external refresh of last known state (e.g. from sync).
   */
  updateLastState(state: WallboxLiveState): void {
    this.lastLiveState = state;
    this.lastLiveAt = Date.now();
  }
}
