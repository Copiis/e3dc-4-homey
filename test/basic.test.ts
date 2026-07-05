import { describe, it } from 'node:test';
import assert from 'node:assert';
import { formatWallboxAlgHexSummary } from '../src/utils/wallbox-charging-state';

describe('basic utils', () => {
  it('formatWallboxAlgHexSummary works', () => {
    // hex with status byte having sun mode etc.
    const hex = '00328010'; // minimal
    const summary = formatWallboxAlgHexSummary(hex);
    assert.ok(summary);
    assert.ok(summary.includes('Sonnenmodus'));
  });

  it('returns undefined for bad hex', () => {
    assert.strictEqual(formatWallboxAlgHexSummary('00'), undefined);
  });
});
