import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RscpTagRegistry, getRscpTag } from '../src/model/rscp-tag-registry';

describe('RscpTagRegistry', () => {
  it('has expected tags', () => {
    assert.ok(RscpTagRegistry.EMS_REQ_SET_POWER);
    assert.ok(getRscpTag('EMS_REQ_SET_POWER'));
  });

  it('getRscpTag returns correct for known', () => {
    assert.strictEqual(getRscpTag('EMS_REQ_SET_POWER'), RscpTagRegistry.EMS_REQ_SET_POWER);
  });
});
