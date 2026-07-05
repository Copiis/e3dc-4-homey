import { describe, it } from 'node:test';
import assert from 'node:assert';
import { LiveDataPoller } from '../src/polling/live-data-poller';

describe('LiveDataPoller', () => {
  it('can be instantiated', () => {
    const logger = { log: () => {}, error: () => {} };
    const poller = new LiveDataPoller(() => ({} as any), logger, () => true);
    assert.ok(poller);
  });

  it('stops without error', () => {
    const logger = { log: () => {}, error: () => {} };
    const poller = new LiveDataPoller(() => ({} as any), logger, () => true);
    poller.stop();
    assert.ok(true);
  });
});
