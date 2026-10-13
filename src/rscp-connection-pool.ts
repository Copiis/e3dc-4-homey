/**
 * Shared RSCP connection pool + per-plant request serialization.
 *
 * Why this exists:
 * - Multiple RscpApi instances historically shared module-level Maps without clear ownership.
 * - Concurrent send() on the same TCP/RSCP session causes flaky timeouts and odd errors.
 * - One plant (host:port) should have at most one in-flight RSCP exchange at a time.
 *
 * Design:
 * - One pool for the whole app process (same address:port → same TCP session).
 * - runExclusive(key) chains promises so open/send/disconnect don't interleave.
 * - Re-entry on the same async context runs inline (disconnect from inside send must not deadlock).
 * - Connections are cached while connected; callers still own open/close policy via RscpApi.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type {
  Frame,
  HomePowerPlantConnection,
  HomePowerPlantConnectionFactory,
} from 'easy-rscp';

const SERIAL_FLAG = '__e3dcSerialSendWrapped';

const exclusiveContext = new AsyncLocalStorage<Set<string>>();

/** Credentials that belong to the socket cached for a host:port key. Never log this. */
export interface PooledCredentialIdentity {
  address: string;
  port: number;
  portalUser: string;
  portalPassword: string;
  rscpPassword: string;
}

export function pooledSessionKey(address: unknown, port: unknown): string | undefined {
  if (address === null || address === undefined) {
    return undefined;
  }
  const host = String(address).trim();
  if (!host || host === 'undefined' || host === 'null') {
    return undefined;
  }
  if (port === null || port === undefined || port === '') {
    return undefined;
  }
  const portText = String(port).trim();
  if (!portText || portText === 'undefined' || portText === 'NaN') {
    return undefined;
  }
  return `${host}:${portText}`;
}

export function credentialsMatch(a: PooledCredentialIdentity, b: PooledCredentialIdentity): boolean {
  return a.address === b.address
    && a.port === b.port
    && a.portalUser === b.portalUser
    && a.portalPassword === b.portalPassword
    && a.rscpPassword === b.rscpPassword;
}

export class RscpConnectionPool {
  private readonly connections = new Map<string, HomePowerPlantConnection>();
  private readonly factories = new Map<string, HomePowerPlantConnectionFactory>();
  private readonly pendingOpen = new Map<string, Promise<HomePowerPlantConnection>>();
  private readonly exclusiveTail = new Map<string, Promise<unknown>>();
  private readonly exclusiveDepth = new Map<string, number>();
  private readonly identities = new Map<string, PooledCredentialIdentity>();
  private readonly epochs = new Map<string, number>();

  setFactory(key: string, factory: HomePowerPlantConnectionFactory): void {
    this.factories.set(key, factory);
  }

  getFactory(key: string): HomePowerPlantConnectionFactory | undefined {
    return this.factories.get(key);
  }

  deleteFactory(key: string): void {
    this.factories.delete(key);
  }

  getConnection(key: string): HomePowerPlantConnection | undefined {
    return this.connections.get(key);
  }

  setConnection(key: string, connection: HomePowerPlantConnection): void {
    this.connections.set(key, connection);
  }

  /**
   * Remove cached connection if it matches (or always if `connection` omitted).
   */
  evictConnection(key: string, connection?: HomePowerPlantConnection): void {
    if (!connection || this.connections.get(key) === connection) {
      this.connections.delete(key);
    }
  }

  getPendingOpen(key: string): Promise<HomePowerPlantConnection> | undefined {
    return this.pendingOpen.get(key);
  }

  setPendingOpen(key: string, openPromise: Promise<HomePowerPlantConnection>): void {
    this.pendingOpen.set(key, openPromise);
  }

  clearPendingOpen(key: string): void {
    this.pendingOpen.delete(key);
  }

  getIdentity(key: string): PooledCredentialIdentity | undefined {
    return this.identities.get(key);
  }

  setIdentity(key: string, identity: PooledCredentialIdentity): void {
    this.identities.set(key, identity);
  }

  getEpoch(key: string): number {
    return this.epochs.get(key) ?? 0;
  }

  bumpEpoch(key: string): number {
    const next = (this.epochs.get(key) ?? 0) + 1;
    this.epochs.set(key, next);
    return next;
  }

  /**
   * Drop cached socket, factory, pending open and credential identity.
   * Epoch bump makes an in-flight open refuse to install its socket.
   * Returns the socket that was cached, so the caller can disconnect it.
   */
  invalidateSession(key: string): HomePowerPlantConnection | undefined {
    const existing = this.connections.get(key);
    this.connections.delete(key);
    this.pendingOpen.delete(key);
    this.factories.delete(key);
    this.identities.delete(key);
    this.bumpEpoch(key);
    return existing;
  }

  /**
   * Run `task` after any previous exclusive work for `key` finished (success or failure).
   * If this async context already holds `key`, run inline so disconnect-from-send cannot deadlock.
   */
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    if (exclusiveContext.getStore()?.has(key)) {
      this.exclusiveDepth.set(key, (this.exclusiveDepth.get(key) ?? 0) + 1);
      return Promise.resolve()
        .then(() => task())
        .finally(() => this.releaseDepth(key));
    }

    const previous = this.exclusiveTail.get(key) ?? Promise.resolve();
    const run = previous.then(
      () => this.enterExclusive(key, task),
      () => this.enterExclusive(key, task),
    );
    this.exclusiveTail.set(
      key,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  /**
   * Ensure connection.send is serialized through this pool for the plant key.
   * Idempotent: wrapping twice is a no-op.
   */
  wrapSerialSend(key: string, connection: HomePowerPlantConnection): HomePowerPlantConnection {
    const flagged = connection as HomePowerPlantConnection & {
      [SERIAL_FLAG]?: boolean;
      send: (frame: Frame) => Promise<Frame>;
    };
    if (flagged[SERIAL_FLAG]) {
      return connection;
    }

    const originalSend = flagged.send.bind(connection);
    flagged.send = (frame: Frame) =>
      this.runExclusive(key, () => originalSend(frame));
    flagged[SERIAL_FLAG] = true;
    return connection;
  }

  private enterExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const parent = exclusiveContext.getStore();
    const store = new Set(parent ?? []);
    store.add(key);
    this.exclusiveDepth.set(key, (this.exclusiveDepth.get(key) ?? 0) + 1);
    return exclusiveContext.run(store, () =>
      Promise.resolve()
        .then(() => task())
        .finally(() => this.releaseDepth(key)),
    );
  }

  private releaseDepth(key: string): void {
    const next = (this.exclusiveDepth.get(key) ?? 1) - 1;
    if (next <= 0) {
      this.exclusiveDepth.delete(key);
    } else {
      this.exclusiveDepth.set(key, next);
    }
  }
}

/** Process-wide singleton — one pool for all RscpApi instances. */
export const sharedRscpConnectionPool = new RscpConnectionPool();
