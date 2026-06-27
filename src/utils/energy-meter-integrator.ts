import {formatError} from './error-utils';
import Homey from 'homey';

const STORE_KEY = 'energyMeterIntegrator';

export interface EnergyMeterIntegratorState {
  chargedKwh: number;
  dischargedKwh: number;
  generatedKwh: number;
  importedKwh: number;
  exportedKwh: number;
  lastSampleMs?: number;
}

export class EnergyMeterIntegrator {

  constructor(private readonly device: Homey.Device) {}

  integrateGeneration(powerW: number, nowMs: number = Date.now()): number {
    const state = this.load();
    this.integrateSignedPower(state, Math.max(0, powerW), nowMs, 'generatedKwh');
    return state.generatedKwh;
  }

  resetGrid(): void {
    const state = this.load();
    state.importedKwh = 0;
    state.exportedKwh = 0;
    state.lastSampleMs = undefined;
    this.save(state);
  }

  integrateGrid(gridPowerW: number, nowMs: number = Date.now()): { importedKwh: number; exportedKwh: number } {
    const state = this.load();
    if (gridPowerW > 0) {
      this.integrateSignedPower(state, gridPowerW, nowMs, 'importedKwh');
    } else if (gridPowerW < 0) {
      this.integrateSignedPower(state, Math.abs(gridPowerW), nowMs, 'exportedKwh');
    } else {
      state.lastSampleMs = nowMs;
      this.save(state);
    }
    return {
      importedKwh: state.importedKwh,
      exportedKwh: state.exportedKwh,
    };
  }

  integrateBattery(powerW: number, nowMs: number = Date.now()): { chargedKwh: number; dischargedKwh: number } {
    const state = this.load();
    if (powerW > 0) {
      this.integrateSignedPower(state, powerW, nowMs, 'chargedKwh');
    } else if (powerW < 0) {
      this.integrateSignedPower(state, Math.abs(powerW), nowMs, 'dischargedKwh');
    } else {
      state.lastSampleMs = nowMs;
      this.save(state);
    }
    return {
      chargedKwh: state.chargedKwh,
      dischargedKwh: state.dischargedKwh,
    };
  }

  private integrateSignedPower(
    state: EnergyMeterIntegratorState,
    powerW: number,
    nowMs: number,
    field: 'chargedKwh' | 'dischargedKwh' | 'generatedKwh' | 'importedKwh' | 'exportedKwh',
  ): void {
    if (state.lastSampleMs !== undefined && nowMs > state.lastSampleMs && powerW > 0) {
      const deltaHours = (nowMs - state.lastSampleMs) / 3_600_000;
      state[field] += (powerW * deltaHours) / 1000;
    }
    state.lastSampleMs = nowMs;
    this.save(state);
  }

  private load(): EnergyMeterIntegratorState {
    const stored = this.device.getStoreValue(STORE_KEY) as EnergyMeterIntegratorState | undefined;
    if (!stored) {
      return {
        chargedKwh: 0,
        dischargedKwh: 0,
        generatedKwh: 0,
        importedKwh: 0,
        exportedKwh: 0,
      };
    }
    return {
      chargedKwh: Number(stored.chargedKwh) || 0,
      dischargedKwh: Number(stored.dischargedKwh) || 0,
      generatedKwh: Number(stored.generatedKwh) || 0,
      importedKwh: Number(stored.importedKwh) || 0,
      exportedKwh: Number(stored.exportedKwh) || 0,
      lastSampleMs: stored.lastSampleMs,
    };
  }

  private save(state: EnergyMeterIntegratorState): void {
    this.device.setStoreValue(STORE_KEY, state).catch((error: unknown) => {
      this.device.error(`Failed to persist energy meter state: ${formatError(error)}`);
    });
  }
}

const WALLBOX_METER_STORE_KEY = 'wallboxMeterKwh';
const WALLBOX_METER_STATE_KEY = 'wallboxMeterState';
const WALLBOX_INTEGRATION_MIN_POWER_W = 50;

interface WallboxMeterState {
  baselineKwh: number;
  supplementKwh: number;
  lastRscpWh?: number;
  lastSampleMs?: number;
}

function loadWallboxMeterState(device: Homey.Device): WallboxMeterState {
  const storedState = device.getStoreValue(WALLBOX_METER_STATE_KEY) as WallboxMeterState | undefined;
  if (storedState) {
    return {
      baselineKwh: Number(storedState.baselineKwh) || 0,
      supplementKwh: Number(storedState.supplementKwh) || 0,
      lastRscpWh: storedState.lastRscpWh,
      lastSampleMs: storedState.lastSampleMs,
    };
  }

  const legacyKwh = device.getStoreValue(WALLBOX_METER_STORE_KEY) as number | undefined;
  if (legacyKwh !== undefined) {
    return {
      baselineKwh: Number(legacyKwh) || 0,
      supplementKwh: 0,
    };
  }

  return {
    baselineKwh: 0,
    supplementKwh: 0,
  };
}

function saveWallboxMeterState(device: Homey.Device, state: WallboxMeterState, totalKwh: number): void {
  device.setStoreValue(WALLBOX_METER_STATE_KEY, state).catch(() => undefined);
  device.setStoreValue(WALLBOX_METER_STORE_KEY, totalKwh).catch(() => undefined);
}

function integrateWallboxSupplement(
  state: WallboxMeterState,
  effectivePowerW: number,
  nowMs: number,
): void {
  if (
    state.lastSampleMs === undefined
    || nowMs <= state.lastSampleMs
    || effectivePowerW < WALLBOX_INTEGRATION_MIN_POWER_W
  ) {
    return;
  }
  const deltaHours = (nowMs - state.lastSampleMs) / 3_600_000;
  state.supplementKwh += (effectivePowerW * deltaHours) / 1000;
}

export function wallboxTotalEnergyKwh(
  totalEnergyWh: number | undefined,
  effectivePowerW: number,
  device: Homey.Device,
  nowMs: number = Date.now(),
): number | undefined {
  const state = loadWallboxMeterState(device);
  const hasRscpCounter = totalEnergyWh !== undefined
    && totalEnergyWh !== null
    && !Number.isNaN(totalEnergyWh);

  if (hasRscpCounter) {
    const rscpWh = Math.max(0, totalEnergyWh);
    const rscpKwh = rscpWh / 1000;

    if (state.lastRscpWh !== undefined && rscpWh < state.lastRscpWh) {
      device.log(
        `Wallbox meter reset detected (${(state.lastRscpWh / 1000).toFixed(2)} -> ${rscpKwh.toFixed(2)} kWh)`,
      );
      state.baselineKwh = rscpKwh;
      state.supplementKwh = 0;
    } else if (state.lastRscpWh !== undefined && rscpWh > state.lastRscpWh) {
      state.baselineKwh = rscpKwh;
      state.supplementKwh = 0;
    } else if (state.lastRscpWh === undefined) {
      state.baselineKwh = rscpKwh;
      state.supplementKwh = 0;
    } else {
      integrateWallboxSupplement(state, effectivePowerW, nowMs);
    }

    state.lastRscpWh = rscpWh;
  } else {
    integrateWallboxSupplement(state, effectivePowerW, nowMs);
  }

  state.lastSampleMs = nowMs;
  const totalKwh = state.baselineKwh + state.supplementKwh;
  if (totalKwh <= 0 && !hasRscpCounter) {
    return undefined;
  }

  saveWallboxMeterState(device, state, totalKwh);
  return totalKwh;
}