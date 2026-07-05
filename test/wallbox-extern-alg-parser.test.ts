import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Data, DataParser, DefaultDataParser, WBTag } from 'easy-rscp';
import { WallboxExternAlgParser } from '../src/converter/wallbox-extern-alg-parser';

describe('WallboxExternAlgParser', () => {
  const parser: DataParser = new DefaultDataParser();

  function makeAlgBlock(hex: string): Data {
    return {
      tag: WBTag.EXTERN_DATA_ALG,
      type: 0,
      value: Buffer.from(hex, 'hex'), // simplified
      // @ts-ignore - minimal mock
      valueAsContainer: () => [
        {
          tag: WBTag.EXTERN_DATA,
          type: 0,
          value: Buffer.from(hex, 'hex'),
          valueAsHex: hex,
          size: () => hex.length / 2,
        }
      ],
    } as any;
  }

  it('parses basic ALG data correctly', () => {
    // Example: precharge=50, phases=3, status with sun+active, current=16
    // statusByte with SUN_MODE + CHARGING_ACTIVE
    const hex = '32038010'; // simplified 4 bytes
    const block = makeAlgBlock(hex);
    const result = new WallboxExternAlgParser(parser).parse(block);

    assert.ok(result);
    assert.strictEqual(result.activePhases, 3);
    assert.strictEqual(result.maxCurrentA, 16);
  });

  it('returns undefined for too short data', () => {
    const block = makeAlgBlock('01');
    const result = new WallboxExternAlgParser(parser).parse(block);
    assert.strictEqual(result, undefined);
  });
});
