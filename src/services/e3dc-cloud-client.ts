import * as crypto from 'crypto';
import { isPlausibleVehicleSocPercent } from '../utils/vehicle-soc';

/**
 * E3DC Cloud Client (opt-in)
 *
 * Uses the official Cloud2Cloud API at api.e3dc.com to fetch additional / fallback data
 * (e.g. when local RSCP does not deliver vehicle SOC for cloud-paired cars).
 *
 * IMPORTANT:
 * - Portal credentials (already collected for RSCP auth) are reused.
 * - Password is sent as MD5 hash for /api/auth/.
 * - Completely optional. Local RSCP remains the primary and preferred source.
 * - JWT is cached for the session lifetime.
 * - Errors are logged but never break local operation.
 */

export interface E3dcCloudConfig {
  portalUsername: string;
  portalPassword: string;
  enabled: boolean;
  systemSn?: number; // optional override / cached
}

export interface E3dcCloudState {
  lastFetch?: Date;
  systemList?: number[];
  systemState?: Record<string, unknown>;
  vehicleSoc?: number; // best-effort extraction
  error?: string;
}

export class E3dcCloudClient {
  private jwt: string | null = null;
  private lastLoginAttempt = 0;
  private jwtExpiry: number = 0;
  /** After auth 403, stop retrying until this timestamp (C2C is often partner-only). */
  private authBlockedUntil = 0;
  private lastFetchAt = 0;

  private state: E3dcCloudState = {};

  constructor(private readonly logger: { log: (msg: string) => void; error: (msg: string) => void }) {}

  isEnabled(config: E3dcCloudConfig): boolean {
    return !!config.enabled && !!config.portalUsername && !!config.portalPassword;
  }

  /**
   * Main entry: ensure login + fetch latest system state.
   * Returns a best-effort vehicle SOC if we can find one.
   *
   * Note: Official systemState schema has house battery SOC + wallbox power only —
   * no dedicated vehicle SOC field. Many end-user accounts also get HTTP 403 on
   * api.e3dc.com (Cloud2Cloud partner API). Prefer Homey-car fallback on the wallbox.
   */
  async fetchVehicleSocFallback(config: E3dcCloudConfig): Promise<number | undefined> {
    if (!this.isEnabled(config)) {
      return undefined;
    }

    const now = Date.now();
    if (now < this.authBlockedUntil) {
      return undefined;
    }
    // Throttle: at most once per 15 minutes (was every live poll → log spam / rate limits)
    if (this.lastFetchAt && now - this.lastFetchAt < 15 * 60 * 1000) {
      return this.state.vehicleSoc;
    }

    try {
      await this.ensureAuthenticated(config);

      const sn = await this.resolveSystemSn(config);
      if (!sn) {
        this.logger.log('E3DC Cloud: no system serial number available');
        this.lastFetchAt = now;
        return undefined;
      }

      const systemState = await this.getSystemState(sn);
      this.state.systemState = systemState as Record<string, unknown>;
      this.state.lastFetch = new Date();
      this.lastFetchAt = now;

      const rootForDebug = (systemState as any)?.result || systemState;

      // Official C2C model primarily exposes power values (WBx_L1 etc.) + house SOC.
      // Vehicle SOC may appear only if portal "Fahrzeugintegration" adds extra fields.
      const soc = this.extractVehicleSoc(systemState);
      if (soc !== undefined) {
        this.state.vehicleSoc = soc;
        this.logger.log(`E3DC Cloud: vehicle SOC fallback = ${soc}% (sn=${sn})`);
      } else {
        this.logger.log(
          'E3DC Cloud: no vehicle SOC in systemState '
          + '(C2C schema has house SOC + wallbox power only — use Homey-car fallback on wallbox)',
        );
        try {
          const top = rootForDebug ? Object.keys(rootForDebug).slice(0, 8).join(', ') : 'no root';
          this.logger.log(`E3DC Cloud debug: systemState top keys: ${top}`);
        } catch {}
      }

      return soc;
    } catch (e: any) {
      const msg = `E3DC Cloud fetch failed: ${e?.message || e}`;
      this.logger.error(msg);
      this.state.error = msg;
      this.lastFetchAt = now;
      if (String(e?.message || e).includes('403') || String(e?.message || e).includes('Auth failed: 403')) {
        // Partner C2C API often rejects portal end-user credentials
        this.authBlockedUntil = now + 6 * 60 * 60 * 1000;
        this.logger.log(
          'E3DC Cloud: auth forbidden (403) — C2C API likely not available for this account. '
          + 'Use wallbox setting „Auto: Homey-Auto“ for Tesla SOC. Retry in 6h.',
        );
      }
      return undefined;
    }
  }

  getLastState(): E3dcCloudState {
    return { ...this.state };
  }

  private async ensureAuthenticated(config: E3dcCloudConfig): Promise<void> {
    const now = Date.now();
    if (this.jwt && now < this.jwtExpiry) {
      return;
    }

    // Throttle login attempts
    if (now - this.lastLoginAttempt < 30000) {
      throw new Error('Cloud login throttled');
    }
    this.lastLoginAttempt = now;

    const md5Password = crypto.createHash('md5').update(config.portalPassword).digest('hex');

    const form = new URLSearchParams({
      user: config.portalUsername,
      password: md5Password,
    });

    const res = await fetch('https://api.e3dc.com/api/auth/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: form.toString(),
    });

    if (!res.ok) {
      throw new Error(`Auth failed: ${res.status}`);
    }

    const data: any = await res.json();

    // JWT field name varies across C2C deployments
    const token =
      data?.token ||
      data?.jwt ||
      data?.access_token ||
      data?.result?.token ||
      data?.result?.jwt ||
      (typeof data?.result === 'string' ? data.result : null) ||
      (typeof data === 'string' ? data : null);

    if (!token) {
      throw new Error('No JWT returned from auth. Raw: ' + JSON.stringify(data).slice(0, 200));
    }

    this.jwt = token;
    // Conservative expiry (E3DC tokens are often short-lived; refresh on next use)
    this.jwtExpiry = now + (10 * 60 * 1000); // 10 min

    this.logger.log('E3DC Cloud: authenticated successfully');
  }

  private async resolveSystemSn(config: E3dcCloudConfig): Promise<number | undefined> {
    if (config.systemSn) {
      return config.systemSn;
    }

    if (this.state.systemList && this.state.systemList.length > 0) {
      return this.state.systemList[0];
    }

    const list = await this.getSystemList();
    this.state.systemList = list;
    return list.length > 0 ? list[0] : undefined;
  }

  private async getSystemList(): Promise<number[]> {
    if (!this.jwt) throw new Error('No JWT');

    const res = await fetch('https://api.e3dc.com/api/systemList/', {
      method: 'GET',
      headers: {
        authorization: this.jwt,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) throw new Error(`systemList failed: ${res.status}`);

    const data: any = await res.json();
    const list = data?.result || data?.systems || [];
    return Array.isArray(list) ? list.map(Number).filter(Boolean) : [];
  }

  private async getSystemState(sn: number): Promise<unknown> {
    if (!this.jwt) throw new Error('No JWT');

    const res = await fetch(`https://api.e3dc.com/api/systemState/${sn}`, {
      method: 'GET',
      headers: {
        authorization: this.jwt,
        'Accept': 'application/json',
      },
    });

    if (!res.ok) throw new Error(`systemState failed: ${res.status}`);

    return res.json();
  }

  /**
   * Best-effort extraction of a vehicle SOC from the systemState response.
   * The documented C2C model has power values (WBx_L1 etc.) but no dedicated vehicle SOC field.
   * If the user has activated "Fahrzeugintegration" in the portal, additional fields may appear.
   * We search common patterns and also keep the full response for diagnostics.
   * Returns only plausible values (>0), otherwise undefined (clean "no data").
   */
  private extractVehicleSoc(systemState: any): number | undefined {
    if (!systemState) return undefined;

    const root = systemState?.result || systemState;

    // Direct guesses based on common naming
    const candidates = [
      root?.vehicleSoc,
      root?.VehicleSOC,
      root?.fahrzeugSoc,
      root?.autoSoc,
      root?.WB_SOC,
      root?.wallboxSoc,
      root?.socVehicle,
      root?.fahrzeuge?.[0]?.soc,
      root?.fahrzeuge?.[0]?.ladestand,
      root?.vehicles?.[0]?.soc,
      root?.wallbox?.[0]?.vehicleSoc,
      root?.result?.vehicleSoc,
    ];

    for (const c of candidates) {
      const n = this.normalizeSoc(c);
      if (n !== undefined && isPlausibleVehicleSocPercent(n)) return n;
    }

    // Deep search for any plausible SOC field that is not the house battery "SOC"
    const found = this.deepFindPlausibleSoc(root, 3);
    if (found !== undefined && isPlausibleVehicleSocPercent(found)) {
      return found;
    }
    return undefined; // clean no data
  }

  private normalizeSoc(val: unknown): number | undefined {
    if (val === undefined || val === null) return undefined;
    const n = Number(val);
    if (Number.isNaN(n) || n < 0) return undefined;
    if (n <= 100) return Math.round(n);
    if (n <= 10000) return Math.round(n / 100);
    return undefined;
  }

  private deepFindPlausibleSoc(obj: any, depth: number): number | undefined {
    if (depth <= 0 || !obj || typeof obj !== 'object') return undefined;

    for (const [key, value] of Object.entries(obj)) {
      const lower = key.toLowerCase();
      if (lower.includes('soc') || lower.includes('ladestand') || (lower.includes('charge') && lower.includes('state')) || lower.includes('fahrzeug')) {
        // Skip main house battery SOC fields
        if (lower === 'soc' || lower === 'batsoc' || lower.includes('battery') && lower.includes('soc')) continue;

        const n = this.normalizeSoc(value);
        if (n !== undefined && n > 0 && n <= 100) {
          return n;
        }
      }

      if (typeof value === 'object') {
        const deeper = this.deepFindPlausibleSoc(value, depth - 1);
        if (deeper !== undefined) return deeper;
      }
    }
    return undefined;
  }
}
