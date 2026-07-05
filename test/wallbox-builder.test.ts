import { describe, it } from 'node:test';
import assert from 'node:assert';
import { WallboxExternDataBuilder } from '../src/converter/wallbox-extern-alg-parser';

describe('WallboxExternDataBuilder', () => {
  it('builds buffer', () => {
    const b = new WallboxExternDataBuilder();
    b.setCurrentLimit(16);
    const buf = b.build();
    assert.equal(buf.length, 5);
  });
});
