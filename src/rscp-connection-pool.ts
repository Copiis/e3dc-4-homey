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
 * - Connections are cached while connected; callers still own open/close policy via RscpApi.
 */
import type {
  Frame,
  HomePowerPlantConnection,
  HomePowerPlantConnectionFactory,
} from 'easy-rscp';

const SERIAL_FLAG = '__e3dcSerialSendWrapped';

export class RscpConnectionPool {
  private readonly connections = new Map<string, HomePowerPlantConnection>();
  private readonly factories = new Map<string, HomePowerPlantConnectionFactory>();
  private readonly pendingOpen = new Map<string, Promise<HomePowerPlantConnection>>();
  private readonly exclusiveTail = new Map<string, Promise<unknown>>();

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

  /**
   * Run `task` after any previous exclusive work for `key` finished (success or failure).
   */
  runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.exclusiveTail.get(key) ?? Promise.resolve();
    const run = previous.then(
      () => task(),
      () => task(),
    );
    // Keep the chain alive regardless of task outcome
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
}

/** Process-wide singleton — one pool for all RscpApi instances. */
export const sharedRscpConnectionPool = new RscpConnectionPool();
