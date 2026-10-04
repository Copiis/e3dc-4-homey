import { describe, it } from 'node:test';
import assert from 'node:assert';
import { resolveAdditionalChargeWh } from '../src/utils/additional-charge';

describe('resolveAdditionalChargeWh', () => {
  it('keeps Wh and rounds', () => {
    assert.deepStrictEqual(resolveAdditionalChargeWh(1500.4, 'wh', 10000), { wh: 1500 });
    assert.deepStrictEqual(resolveAdditionalChargeWh(2500, undefined, 0), { wh: 2500 });
  });

  it('rejects Wh below 200', () => {
    assert.deepStrictEqual(resolveAdditionalChargeWh(199, 'wh', 10000), { error: 'too-low' });
    assert.deepStrictEqual(resolveAdditionalChargeWh(Number.NaN, 'wh', 10000), { error: 'too-low' });
  });

  it('converts percent of usable capacity into additional Wh', () => {
    assert.deepStrictEqual(resolveAdditionalChargeWh(10, 'percentage', 13000), { wh: 1300 });
    assert.deepStrictEqual(resolveAdditionalChargeWh(2.5, 'percentage', 10000), { wh: 250 });
  });

  it('rejects percent outside 0 to 100', () => {
    assert.deepStrictEqual(resolveAdditionalChargeWh(101, 'percentage', 10000), { error: 'invalid-percentage' });
    assert.deepStrictEqual(resolveAdditionalChargeWh(-1, 'percentage', 10000), { error: 'invalid-percentage' });
  });

  it('rejects percent when capacity is unknown or the result is under 200 Wh', () => {
    assert.deepStrictEqual(resolveAdditionalChargeWh(10, 'percentage', 0), { error: 'no-capacity' });
    assert.deepStrictEqual(resolveAdditionalChargeWh(1, 'percentage', 10000), { error: 'too-low' });
  });
});
