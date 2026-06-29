/**
 * Open-Meteo panel azimuth: 0° = south, -90° = east, 90° = west, ±180° = north.
 * @see https://open-meteo.com/en/docs (Solar Radiation Variables)
 */
export type PvCompassOrientation = 'S' | 'SO' | 'O' | 'NO' | 'N' | 'NW' | 'W' | 'SW';

const ORIENTATION_TO_AZIMUTH: Record<PvCompassOrientation, number> = {
  S: 0,
  SO: -45,
  O: -90,
  NO: -135,
  N: 180,
  NW: 135,
  W: 90,
  SW: 45,
};

export function compassOrientationToAzimuth(orientation: string | undefined): number {
  if (orientation && orientation in ORIENTATION_TO_AZIMUTH) {
    return ORIENTATION_TO_AZIMUTH[orientation as PvCompassOrientation];
  }
  return ORIENTATION_TO_AZIMUTH.S;
}

/** Map legacy settings that used 0°=north compass degrees to Open-Meteo azimuth. */
export function legacyAzimuthDegreesToOpenMeteo(azimuthDegrees: number): number {
  if (!Number.isFinite(azimuthDegrees)) {
    return ORIENTATION_TO_AZIMUTH.S;
  }
  const normalized = ((azimuthDegrees % 360) + 360) % 360;
  const legacyCompassToOpenMeteo: Record<number, number> = {
    0: 180,
    45: -135,
    90: -90,
    135: -45,
    180: 0,
    225: 45,
    270: 90,
    315: 135,
  };
  return legacyCompassToOpenMeteo[normalized] ?? ORIENTATION_TO_AZIMUTH.S;
}

export function resolveOpenMeteoAzimuth(
  orientation: string | undefined,
  legacyAzimuth?: number,
): number {
  if (orientation && orientation in ORIENTATION_TO_AZIMUTH) {
    return ORIENTATION_TO_AZIMUTH[orientation as PvCompassOrientation];
  }
  if (legacyAzimuth != null && Number.isFinite(legacyAzimuth)) {
    return legacyAzimuthDegreesToOpenMeteo(legacyAzimuth);
  }
  return ORIENTATION_TO_AZIMUTH.S;
}