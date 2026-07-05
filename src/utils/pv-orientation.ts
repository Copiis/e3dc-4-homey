/**
 * Kompass-Ausrichtung für PV-Module (für Open-Meteo und interne Logik).
 * Open-Meteo: 0° = south, -90° = east, 90° = west, ±180° = north.
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

/**
 * Konvertiert alte Einstellungen (0°=Nord) in Open-Meteo Azimut.
 */
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

/**
 * Ermittelt den finalen Azimut-Wert aus Orientierung + Legacy-Wert.
 */
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