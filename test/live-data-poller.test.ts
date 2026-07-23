import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LiveDataPoller } from '../src/polling/live-data-poller';
import type { RscpApi } from '../src/rscp-api';
import type { LiveData } from '../src/model/live-data';

describe('LiveDataPoller', () => {
  it('can be instantiated', () => {
    const logger = { log: () => {}, error: () => {} };
    const poller = new LiveDataPoller(() => ({} as RscpApi), logger, () => true);
    assert.ok(poller);
  });

  it('stops without error', () => {
    const logger = { log: () => {}, error: () => {} };
    const poller = new LiveDataPoller(() => ({} as RscpApi), logger, () => true);
    poller.stop();
    assert.ok(true);
  });

  it('stop cancels delayed initial fetch', async () => {
    const logger = { log: () => {}, error: () => {} };
    let fetches = 0;
    const api = {
      readLiveData: async () => {
        fetches += 1;
        return { pvDelivery: 1 } as LiveData;
      },
    } as unknown as RscpApi;

    const poller = new LiveDataPoller(() => api, logger, () => false);
    poller.start(60_000);
    poller.stop();
    await new Promise((r) => setTimeout(r, 50));
    // initial fetch is scheduled at 2000ms — must not run after stop
    await new Promise((r) => setTimeout(r, 2200));
    assert.strictEqual(fetches, 0);
  });

  it('notifies onError when fetch fails', async () => {
    const logger = { log: () => {}, error: () => {} };
    const failingApi = {
      readLiveData: async () => {
        throw new Error('connect EHOSTUNREACH 192.168.178.119:5033');
      },
    } as unknown as RscpApi;

    const poller = new LiveDataPoller(() => failingApi, logger, () => false);
    const errors: unknown[] = [];
    poller.onError((err) => errors.push(err));

    const result = await poller.forceFetch();
    assert.strictEqual(result, undefined);
    assert.strictEqual(errors.length, 1);
    assert.ok(String((errors[0] as Error).message).includes('EHOSTUNREACH'));
  });

  it('notifies onData when fetch succeeds', async () => {
    const logger = { log: () => {}, error: () => {} };
    const sample = { pvDelivery: 100 } as LiveData;
    const okApi = {
      readLiveData: async () => sample,
    } as unknown as RscpApi;

    const poller = new LiveDataPoller(() => okApi, logger, () => false);
    const received: LiveData[] = [];
    poller.onData((d) => received.push(d));

    const result = await poller.forceFetch();
    assert.strictEqual(result, sample);
    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].pvDelivery, 100);
  });
});
