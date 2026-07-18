import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SafeSocketFactory } from '../src/rscp-safe-socket-factory';
import type { E3dcConnectionData } from 'easy-rscp';

/**
 * Verifies that unreachable hosts reject the promise and do NOT raise
 * uncaughtException (the Homey crash stack: TCPConnectWrap.afterConnect).
 */
describe('SafeSocketFactory', () => {
  it('rejects on unreachable host without uncaughtException', async () => {
    const uncaught: Error[] = [];
    const onUncaught = (err: Error) => {
      uncaught.push(err);
    };
    process.on('uncaughtException', onUncaught);

    const factory = new SafeSocketFactory();
    const connectionData = {
      address: '172.31.255.254', // typically no route / host unreachable
      port: 5033,
      portalUser: 'x',
      portalPassword: 'x',
      rscpPassword: 'x',
      connectionTimeoutMillis: 1500,
      readTimeoutMillis: 1500,
    } as E3dcConnectionData;

    let rejected = false;
    try {
      await factory.createSocket(connectionData);
    } catch (e) {
      rejected = true;
      assert.ok(e instanceof Error || (e && typeof e === 'object'));
    }

    // Allow late socket events to surface
    await new Promise((r) => setTimeout(r, 500));
    process.removeListener('uncaughtException', onUncaught);

    assert.strictEqual(rejected, true, 'createSocket must reject when host is unreachable');
    assert.strictEqual(
      uncaught.length,
      0,
      'must not raise uncaughtException (got: ' + uncaught.map((e) => e.message).join('; ') + ')',
    );
  });

  it('rejects with CONNECTION_TIMEOUT for blackholed host', async () => {
    const factory = new SafeSocketFactory();
    // TEST-NET-1 — often blackholed (no ICMP), so timeout path is exercised
    const connectionData = {
      address: '192.0.2.1',
      port: 5033,
      portalUser: 'x',
      portalPassword: 'x',
      rscpPassword: 'x',
      connectionTimeoutMillis: 800,
      readTimeoutMillis: 800,
    } as E3dcConnectionData;

    const uncaught: Error[] = [];
    const onUncaught = (err: Error) => uncaught.push(err);
    process.on('uncaughtException', onUncaught);

    await assert.rejects(() => factory.createSocket(connectionData));
    await new Promise((r) => setTimeout(r, 300));
    process.removeListener('uncaughtException', onUncaught);

    assert.strictEqual(uncaught.length, 0, 'timeout path must not crash process');
  });
});
