import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RscpTagRegistry, getRscpTag } from '../src/model/rscp-tag-registry';

describe('RscpTagRegistry', () => {
  it('contains expected tags', () => {
    assert.ok(RscpTagRegistry.EMS_REQ_SET_POWER);
    assert.ok(RscpTagRegistry.WB_REQ_GET_CHARGE_PLAN_TEXT);
  });

  it('getRscpTag works', () => {
    assert.strictEqual(getRscpTag('EMS_REQ_SET_POWER'), RscpTagRegistry.EMS_REQ_SET_POWER);
  });
});
