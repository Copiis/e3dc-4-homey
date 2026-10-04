import {SummaryType} from '../model/summary.config';
import {startOfLocalCalendarDay} from './grid-cumulative-archive';

/**
 * E3DC has no house-only energy tag. History CONSUMPTION is the period total
 * including the wallbox (portal Σ Verbrauch). WB ENERGY_ALL is the lifetime
 * counter, the same number as the wallbox meter_power, not that period's kWh.
 * The period wallbox energy is the meter delta over the same window the
 * history request uses. Portal Hausverbrauch = total − that delta.
 */
export const HOUSE_WITHOUT_WALLBOX_CAPABILITY = 'measure_house_without_wallbox_summary';

const DAY_MS = 24 * 60 * 60 * 1000;
const SERIES_TTL_MS = 4 * 60 * 1000;

export interface SummaryPeriodBounds {
  start: Date;
  end: Date;
  /** Today, this month, this year: the history sum is still growing. */
  open: boolean;
}

export interface MeterSample {
  t: number;
  v: number;
}

export interface MeterSeries {
  samples: MeterSample[];
  stepMs: number;
  liveKwh?: number;
}

export interface WallboxMeterSource {
  /** Homey device UUID, used in the insight log URI. */
  id: string;
  /** Pairing id (`wb-<stationId>-<index>`), used when the SDK object has no UUID. */
  dataId?: string;
  stationId?: string;
  liveKwh?: number;
}

export interface HomeyInsightsHost {
  api: {
    getOwnerApiToken(): Promise<string>;
    getLocalUrl(): Promise<string>;
  };
}

interface CachedSeries {
  at: number;
  promise: Promise<MeterSeries | null>;
}

let cachedAuth: {token: string; baseUrl: string; at: number} | undefined;
const AUTH_TTL_MS = 10 * 60 * 1000;
const seriesCache = new Map<string, CachedSeries>();

/**
 * Same window as RscpApi.buildFrameBySummaryType.
 * Days follow the Homey timezone. Month and year follow the process-local
 * calendar, because the history frame does too. The span is N × 24h, matching
 * the RSCP duration, including across a daylight-saving change.
 */
export function summaryPeriodBounds(
  summaryType: SummaryType,
  timezone: string,
  now: Date = new Date(),
): SummaryPeriodBounds {
  if (summaryType === SummaryType.TODAY || summaryType === SummaryType.YESTERDAY) {
    const dayOffset = summaryType === SummaryType.YESTERDAY ? -1 : 0;
    const start = startOfLocalCalendarDay(timezone, dayOffset, now);
    return {
      start,
      end: new Date(start.getTime() + DAY_MS),
      open: summaryType === SummaryType.TODAY,
    };
  }

  if (summaryType === SummaryType.CURRENT_MONTH || summaryType === SummaryType.LAST_MONTH) {
    const date = new Date(now.getTime());
    if (summaryType === SummaryType.LAST_MONTH) {
      if (date.getMonth() === 0) {
        date.setFullYear(date.getFullYear() - 1, 11, 1);
      } else {
        date.setMonth(date.getMonth() - 1, 1);
      }
    } else {
      date.setMonth(date.getMonth(), 1);
    }
    date.setHours(0, 0, 0, 0);
    const days = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return {
      start: date,
      end: new Date(date.getTime() + days * DAY_MS),
      open: summaryType === SummaryType.CURRENT_MONTH,
    };
  }

  const yearOffset = summaryType === SummaryType.LAST_YEAR ? 1 : 0;
  const start = new Date(now.getFullYear() - yearOffset, 0, 1, 0, 0, 0, 0);
  const first = new Date(start.getFullYear(), 0, 1);
  const last = new Date(start.getFullYear() + 1, 0, 0);
  const days = Math.round((last.getTime() - first.getTime()) / DAY_MS) + 1;
  return {
    start,
    end: new Date(start.getTime() + days * DAY_MS),
    open: summaryType === SummaryType.CURRENT_YEAR,
  };
}

/** Finest Homey insight resolution that still covers this summary period. */
export function insightResolutionForSummary(summaryType: SummaryType): string {
  switch (summaryType) {
    case SummaryType.TODAY:
      return 'today';
    case SummaryType.YESTERDAY:
      return 'yesterday';
    case SummaryType.CURRENT_MONTH:
      return 'thisMonth';
    case SummaryType.LAST_MONTH:
      return 'lastMonth';
    case SummaryType.CURRENT_YEAR:
      return 'thisYear';
    case SummaryType.LAST_YEAR:
      return 'lastYear';
    default:
      return 'last7Days';
  }
}

export function parseInsightSeries(payload: unknown): MeterSeries | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as {values?: unknown; step?: unknown};
  if (!Array.isArray(record.values) || typeof record.step !== 'number' || record.step <= 0) {
    return null;
  }
  const samples: MeterSample[] = [];
  for (const entry of record.values) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const point = entry as {t?: unknown; v?: unknown};
    if (typeof point.t !== 'string' || typeof point.v !== 'number' || !Number.isFinite(point.v)) {
      continue;
    }
    const t = Date.parse(point.t);
    if (!Number.isFinite(t)) {
      continue;
    }
    samples.push({t, v: point.v});
  }
  return {samples, stepMs: record.step};
}

/** Last finite sample at or before the boundary. Null when the gap is larger than one step. */
export function meterAtOrBefore(samples: MeterSample[], boundaryMs: number, stepMs: number): number | null {
  let bestT = -Infinity;
  let bestV: number | null = null;
  for (const sample of samples) {
    if (sample.t <= boundaryMs && sample.t > bestT) {
      bestT = sample.t;
      bestV = sample.v;
    }
  }
  if (bestV == null || !Number.isFinite(bestT)) {
    return null;
  }
  if (boundaryMs - bestT > stepMs) {
    return null;
  }
  return bestV;
}

/** Rise of a lifetime counter. Null when the counter went backwards. */
export function counterDeltaKwh(startKwh: number, endKwh: number): number | null {
  if (!Number.isFinite(startKwh) || !Number.isFinite(endKwh)) {
    return null;
  }
  if (endKwh + 0.05 < startKwh) {
    return null;
  }
  return Math.max(0, endKwh - startKwh);
}

export function houseWithoutWallboxKwh(totalKwh: number, wallboxKwh: number): number | null {
  if (!Number.isFinite(totalKwh) || !Number.isFinite(wallboxKwh) || wallboxKwh < 0) {
    return null;
  }
  if (wallboxKwh > totalKwh + 1) {
    return null;
  }
  return Math.max(0, totalKwh - wallboxKwh);
}

export function wallboxPeriodKwh(series: MeterSeries, bounds: SummaryPeriodBounds, nowMs: number): number | null {
  const startKwh = meterAtOrBefore(series.samples, bounds.start.getTime(), series.stepMs);
  if (startKwh == null) {
    return null;
  }
  let endKwh: number | null;
  if (bounds.open && series.liveKwh != null && Number.isFinite(series.liveKwh)) {
    endKwh = series.liveKwh;
  } else {
    const endBoundary = bounds.open ? Math.min(nowMs, bounds.end.getTime()) : bounds.end.getTime();
    endKwh = meterAtOrBefore(series.samples, endBoundary, series.stepMs);
  }
  if (endKwh == null) {
    return null;
  }
  return counterDeltaKwh(startKwh, endKwh);
}

export function houseWithoutWallboxFromSeries(
  totalKwh: number,
  seriesList: MeterSeries[],
  bounds: SummaryPeriodBounds,
  nowMs: number,
): number | null {
  let wallboxKwh = 0;
  for (const series of seriesList) {
    const delta = wallboxPeriodKwh(series, bounds, nowMs);
    if (delta == null) {
      return null;
    }
    wallboxKwh += delta;
  }
  return houseWithoutWallboxKwh(totalKwh, wallboxKwh);
}

const HOMEY_DEVICE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function wallboxBelongsToStation(wallbox: WallboxMeterSource, stationId: string): boolean {
  if (wallbox.stationId === stationId) {
    return true;
  }
  return !!wallbox.dataId && wallbox.dataId.startsWith('wb-' + stationId + '-');
}

export function wallboxMeterSource(device: {
  id?: string;
  getData?: () => {id?: string} | undefined;
  getStoreValue(key: string): unknown;
  getCapabilityValue(capabilityId: string): unknown;
}): WallboxMeterSource | undefined {
  const settings = device.getStoreValue('settings') as {stationId?: string} | null;
  const live = device.getCapabilityValue('meter_power');
  const rawId = device.id;
  const dataId = device.getData?.()?.id;
  const id = typeof rawId === 'string' && HOMEY_DEVICE_UUID.test(rawId) ? rawId : '';
  if (!id && typeof dataId !== 'string') {
    return undefined;
  }
  return {
    id,
    dataId: typeof dataId === 'string' ? dataId : undefined,
    stationId: settings?.stationId,
    liveKwh: typeof live === 'number' && Number.isFinite(live) ? live : undefined,
  };
}

export async function readHouseConsumptionWithoutWallboxKwh(args: {
  homey: HomeyInsightsHost;
  wallboxes: WallboxMeterSource[];
  stationId: string;
  summaryType: SummaryType;
  totalWh: number;
  timezone: string;
  now?: Date;
  log?: (message: string) => void;
}): Promise<number | null> {
  const totalKwh = args.totalWh / 1000;
  if (!Number.isFinite(totalKwh)) {
    return null;
  }
  const matched = args.wallboxes.filter(wallbox => wallboxBelongsToStation(wallbox, args.stationId));
  if (matched.length === 0) {
    args.log?.('No wallbox for this station, house consumption without wallbox equals the total');
    return houseWithoutWallboxKwh(totalKwh, 0);
  }
  const resolved = await resolveWallboxUuids(args.homey, matched, args.log);
  if (resolved == null) {
    return null;
  }

  const now = args.now ?? new Date();
  const bounds = summaryPeriodBounds(args.summaryType, args.timezone, now);
  const resolution = insightResolutionForSummary(args.summaryType);
  const seriesList: MeterSeries[] = [];
  for (const wallbox of resolved) {
    let parsed: MeterSeries | null;
    try {
      parsed = await fetchMeterSeries(args.homey, wallbox.id, resolution);
    } catch (error) {
      args.log?.('Wallbox insight read failed for ' + wallbox.id + ': ' + (error instanceof Error ? error.message : 'unknown'));
      return null;
    }
    if (!parsed || parsed.samples.length === 0) {
      args.log?.('Wallbox insight series empty for ' + resolution);
      return null;
    }
    seriesList.push({...parsed, liveKwh: wallbox.liveKwh});
  }
  const houseKwh = houseWithoutWallboxFromSeries(totalKwh, seriesList, bounds, now.getTime());
  if (houseKwh == null) {
    args.log?.('Wallbox meter does not cover this statistics period (' + resolution + ')');
  }
  return houseKwh;
}

async function resolveWallboxUuids(
  homey: HomeyInsightsHost,
  wallboxes: WallboxMeterSource[],
  log?: (message: string) => void,
): Promise<WallboxMeterSource[] | null> {
  if (wallboxes.every(wallbox => wallbox.id)) {
    return wallboxes;
  }
  let listed: Array<{id: string; dataId?: string}>;
  try {
    listed = await listHomeyDeviceIds(homey);
  } catch (error) {
    log?.('Wallbox device list failed: ' + (error instanceof Error ? error.message : 'unknown'));
    return null;
  }
  const resolved = wallboxes.map(wallbox => {
    if (wallbox.id) {
      return wallbox;
    }
    const found = listed.find(device => device.dataId === wallbox.dataId);
    return found ? {...wallbox, id: found.id} : wallbox;
  });
  if (resolved.some(wallbox => !wallbox.id)) {
    log?.('Wallbox insight id missing');
    return null;
  }
  return resolved;
}

let cachedDeviceIds: {at: number; list: Array<{id: string; dataId?: string}>} | undefined;

async function listHomeyDeviceIds(homey: HomeyInsightsHost): Promise<Array<{id: string; dataId?: string}>> {
  const now = Date.now();
  if (cachedDeviceIds && now - cachedDeviceIds.at < SERIES_TTL_MS) {
    return cachedDeviceIds.list;
  }
  const auth = await getApiAuth(homey);
  const res = await fetch(auth.baseUrl + '/api/manager/devices/device', {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + auth.token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      cachedAuth = undefined;
    }
    throw new Error('devices HTTP ' + res.status);
  }
  const data = await res.json() as Record<string, {id?: string; data?: {id?: string}}> | Array<{id?: string; data?: {id?: string}}>;
  const values = Array.isArray(data) ? data : Object.values(data);
  const list = values.flatMap(device => {
    if (!device || typeof device.id !== 'string' || !HOMEY_DEVICE_UUID.test(device.id)) {
      return [];
    }
    const dataId = device.data && typeof device.data.id === 'string' ? device.data.id : undefined;
    return [{id: device.id, dataId}];
  });
  cachedDeviceIds = {at: now, list};
  return list;
}

async function fetchMeterSeries(
  homey: HomeyInsightsHost,
  deviceId: string,
  resolution: string,
): Promise<MeterSeries | null> {
  const key = deviceId + ':' + resolution;
  const now = Date.now();
  const hit = seriesCache.get(key);
  if (hit && now - hit.at < SERIES_TTL_MS) {
    return hit.promise;
  }
  const promise = fetchMeterSeriesUncached(homey, deviceId, resolution).catch(error => {
    seriesCache.delete(key);
    throw error;
  });
  seriesCache.set(key, {at: now, promise});
  return promise;
}

async function fetchMeterSeriesUncached(
  homey: HomeyInsightsHost,
  deviceId: string,
  resolution: string,
): Promise<MeterSeries | null> {
  const auth = await getApiAuth(homey);
  const uri = 'homey:device:' + deviceId;
  const id = uri + ':meter_power';
  const url = auth.baseUrl + '/api/manager/insights/log/' + uri + '/' + id + '/entry?resolution=' + encodeURIComponent(resolution);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: 'Bearer ' + auth.token,
      Accept: 'application/json',
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      cachedAuth = undefined;
    }
    throw new Error('insights HTTP ' + res.status);
  }
  return parseInsightSeries(await res.json());
}

async function getApiAuth(homey: HomeyInsightsHost): Promise<{token: string; baseUrl: string}> {
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

export function clearHouseWithoutWallboxCache(): void {
  cachedAuth = undefined;
  seriesCache.clear();
  cachedDeviceIds = undefined;
}
