import {isPlausibleVehicleSocPercent, normalizeVehicleSocPercent} from './vehicle-soc';

/**
 * Resolve vehicle SOC from another Homey device (e.g. car apps).
 *
 * Apps cannot read other apps' devices via `homey.drivers` — that is sandboxed.
 * We use the in-app Homey Web API (`homey:manager:api` permission):
 *   getOwnerApiToken + getLocalUrl → GET /api/manager/devices/device
 *
 * Athom policy note (P3):
 * - `homey:manager:api` is optional and only needed for cross-app SOC.
 * - If Athom rejects the permission in review, set wallbox SOC source to `rscp_only`
 *   (or remove the permission) — local RSCP + Flow cards remain the primary path.
 * - Do not expand this feature until Athom review feedback is clear.
 */

export type VehicleSocSourceMode = 'rscp_only' | 'auto_homey_car' | 'device';

export interface ExternalVehicleSocConfig {
  /** How to resolve SOC when local RSCP is not plausible. Default: auto_homey_car */
  mode?: VehicleSocSourceMode | string;
  /** Homey device id when mode === 'device' */
  deviceId?: string;
  /** Capability id on the external device (default measure_battery) */
  capabilityId?: string;
}

export interface ExternalVehicleSocResult {
  socPercent: number;
  deviceId: string;
  deviceName: string;
  capabilityId: string;
}

/** Minimal Homey surface for cross-app device reads */
export interface HomeyApiHost {
  api: {
    getOwnerApiToken(): Promise<string>;
    getLocalUrl(): Promise<string>;
  };
}

const DEFAULT_CAPABILITIES = ['measure_battery', 'measure_soc_level', 'measure_soc_usable'] as const;

/** Cache token/url briefly to avoid hammering on every wallbox poll */
let cachedAuth: {token: string; baseUrl: string; at: number} | undefined;
const AUTH_TTL_MS = 10 * 60 * 1000;

/** Cache full device list briefly */
let cachedDevices: {list: HomeyWebDevice[]; at: number} | undefined;
const DEVICES_TTL_MS = 30_000;

interface HomeyWebDevice {
  id: string;
  name: string;
  class?: string;
  available?: boolean;
  capabilitiesObj?: Record<string, {value?: unknown} | undefined>;
}

/**
 * Async resolve of external vehicle SOC via Homey Web API.
 */
export async function resolveExternalVehicleSoc(
  homey: HomeyApiHost,
  config: ExternalVehicleSocConfig = {},
): Promise<ExternalVehicleSocResult | undefined> {
  const mode = (config.mode || 'auto_homey_car') as VehicleSocSourceMode;
  if (mode === 'rscp_only') {
    return undefined;
  }

  const capabilityHint = (config.capabilityId || '').trim() || undefined;
  const devices = await fetchAllDevices(homey);
  if (devices.length === 0) {
    return undefined;
  }

  if (mode === 'device') {
    const id = (config.deviceId || '').trim();
    if (!id) {
      return undefined;
    }
    const device = devices.find(d => d.id === id);
    if (!device) {
      return undefined;
    }
    return readSocFromWebDevice(device, capabilityHint);
  }

  // auto_homey_car: only class "car" (Tesla etc.)
  const cars = devices.filter(d => d.class === 'car');
  for (const device of cars) {
    const hit = readSocFromWebDevice(device, capabilityHint);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

async function fetchAllDevices(homey: HomeyApiHost): Promise<HomeyWebDevice[]> {
  const now = Date.now();
  if (cachedDevices && now - cachedDevices.at < DEVICES_TTL_MS) {
    return cachedDevices.list;
  }

  try {
    const auth = await getApiAuth(homey);
    const res = await fetch(`${auth.baseUrl}/api/manager/devices/device`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        Accept: 'application/json',
      },
    });
    if (!res.ok) {
      // invalidate auth on 401
      if (res.status === 401 || res.status === 403) {
        cachedAuth = undefined;
      }
      return cachedDevices?.list ?? [];
    }
    const data = (await res.json()) as Record<string, HomeyWebDevice> | HomeyWebDevice[];
    const list = Array.isArray(data) ? data : Object.values(data);
    cachedDevices = {list, at: now};
    return list;
  } catch {
    return cachedDevices?.list ?? [];
  }
}

async function getApiAuth(homey: HomeyApiHost): Promise<{token: string; baseUrl: string}> {
  const now = Date.now();
  if (cachedAuth && now - cachedAuth.at < AUTH_TTL_MS) {
    return {token: cachedAuth.token, baseUrl: cachedAuth.baseUrl};
  }
  const [token, baseUrl] = await Promise.all([
    homey.api.getOwnerApiToken(),
    homey.api.getLocalUrl(),
  ]);
  cachedAuth = {token, baseUrl, at: now};
  return {token, baseUrl};
}

function readSocFromWebDevice(
  device: HomeyWebDevice,
  preferredCapability?: string,
): ExternalVehicleSocResult | undefined {
  const caps = device.capabilitiesObj || {};
  const candidates = preferredCapability
    ? [preferredCapability, ...DEFAULT_CAPABILITIES.filter(c => c !== preferredCapability)]
    : [...DEFAULT_CAPABILITIES];

  for (const cap of candidates) {
    const entry = caps[cap];
    if (!entry || typeof entry.value !== 'number') {
      continue;
    }
    const soc = normalizeVehicleSocPercent(entry.value);
    if (!isPlausibleVehicleSocPercent(soc)) {
      continue;
    }
    return {
      socPercent: soc!,
      deviceId: device.id,
      deviceName: device.name,
      capabilityId: cap,
    };
  }
  return undefined;
}

/** Test helper: clear caches between unit tests */
export function clearExternalVehicleSocCache(): void {
  cachedAuth = undefined;
  cachedDevices = undefined;
}
