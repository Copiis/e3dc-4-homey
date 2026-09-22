import {isPlausibleVehicleSocPercent} from './vehicle-soc';

export type VehicleSocDisplaySource = 'local' | 'external' | 'cloud' | 'last_known' | 'none';

export interface VehicleSocDisplayInput {
  rscpSoc: number | undefined;
  mode?: string;
  lastSource: VehicleSocDisplaySource;
  lastPlausibleSoc?: number;
}

export interface VehicleSocDisplayDecision {
  /** SOC to write; undefined = do not overwrite the capability */
  soc: number | undefined;
  source: VehicleSocDisplaySource;
  tryExternal: boolean;
}

export function isRscpOnlyVehicleSocMode(mode: string | undefined | null): boolean {
  return mode === 'rscp_only';
}

/**
 * Decide what the wallbox tile should show for vehicle SOC.
 *
 * `rscp_only` must never keep a Homey-car / cloud fallback title or value
 * when E3DC reports 0 — that is the setting "Nur E3DC RSCP (kein Fallback)".
 */
export function decideVehicleSocDisplay(input: VehicleSocDisplayInput): VehicleSocDisplayDecision {
  const mode = input.mode || 'auto_homey_car';
  const rscpOnly = isRscpOnlyVehicleSocMode(mode);

  if (isPlausibleVehicleSocPercent(input.rscpSoc)) {
    return {soc: input.rscpSoc, source: 'local', tryExternal: false};
  }

  if (rscpOnly) {
    if (typeof input.rscpSoc === 'number' && input.rscpSoc >= 0 && input.rscpSoc <= 100) {
      return {soc: input.rscpSoc, source: 'local', tryExternal: false};
    }
    if (input.lastSource === 'local' && isPlausibleVehicleSocPercent(input.lastPlausibleSoc)) {
      return {soc: input.lastPlausibleSoc, source: 'last_known', tryExternal: false};
    }
    // Overwrite stale Homey-Auto values. E3DC 0 / missing is the real local reading.
    return {soc: 0, source: 'local', tryExternal: false};
  }

  if (input.lastSource === 'external' || input.lastSource === 'cloud') {
    return {soc: input.lastPlausibleSoc, source: input.lastSource, tryExternal: true};
  }
  if (isPlausibleVehicleSocPercent(input.lastPlausibleSoc)) {
    return {soc: input.lastPlausibleSoc, source: 'last_known', tryExternal: true};
  }
  return {soc: undefined, source: 'none', tryExternal: true};
}
