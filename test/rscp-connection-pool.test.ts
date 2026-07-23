import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RscpConnectionPool } from '../src/rscp-connection-pool';
import type { Frame, HomePowerPlantConnection } from 'easy-rscp';

describe('RscpConnectionPool', () => {
  it('runExclusive serializes tasks for the same key', async () => {
    const pool = new RscpConnectionPool();
    const order: number[] = [];

    const a = pool.runExclusive('plant', async () => {
      order.push(1);
      await new Promise((r) => setTimeout(r, 30));
      order.push(2);
      return 'a';
    });
    const b = pool.runExclusive('plant', async () => {
      order.push(3);
      return 'b';
    });

    const [ra, rb] = await Promise.all([a, b]);
    assert.strictEqual(ra, 'a');
    assert.strictEqual(rb, 'b');
    assert.deepStrictEqual(order, [1, 2, 3]);
  });

  it('wrapSerialSend serializes concurrent send calls', async () => {
    const pool = new RscpConnectionPool();
    const order: number[] = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const fakeCon = {
      isConnected: () => true,
      disconnect: async () => undefined,
      send: async (_frame: Frame) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        order.push(inFlight);
        await new Promise((r) => setTimeout(r, 20));
        inFlight -= 1;
        return {} as Frame;
      },
    } as unknown as HomePowerPlantConnection;

    const serial = pool.wrapSerialSend('h:1', fakeCon);
    await Promise.all([
      serial.send({} as Frame),
      serial.send({} as Frame),
      serial.send({} as Frame),
    ]);

    assert.strictEqual(maxInFlight, 1, 'sends must not overlap');
    assert.strictEqual(order.length, 3);
  });

  it('wrapSerialSend is idempotent', () => {
    const pool = new RscpConnectionPool();
    const fakeCon = {
      isConnected: () => true,
      disconnect: async () => undefined,
      send: async () => ({} as Frame),
    } as unknown as HomePowerPlantConnection;

    const once = pool.wrapSerialSend('h:1', fakeCon);
    const twice = pool.wrapSerialSend('h:1', once);
    assert.strictEqual(once, twice);
  });
});
