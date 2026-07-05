import {Data, DataParser, DefaultDataParser, WBTag} from 'easy-rscp';
import {WALLBOX_EXTERN_DATA_ALG_LEN} from '../model/wallbox-control';
import {
    parseAlgStatusByte,
} from '../model/wallbox-extern-alg-status';

export interface WallboxExternAlgParsed {
    socPercent: number;
    activePhases: number;
    statusByte: number;
    maxCurrentA: number;
    schukoOn: boolean;
    sunModeActive: boolean;
    chargingCanceled: boolean;
    chargingActive: boolean;
    plugLocked: boolean;
    plugged: boolean;
    chargingEnabled: boolean;
    rawHex: string;
}

export class WallboxExternAlgParser {
    constructor(private readonly parser: DataParser = new DefaultDataParser()) {
    }

    /**
     * Builder-like method to construct parsed data from raw bytes (addresses the byte magic feedback).
     */
    static fromBytes(buffer: Buffer): WallboxExternAlgParsed | undefined {
        if (buffer.length < 4) return undefined;
        const prechargePercent = buffer.readUInt8(0);
        const statusByte = buffer.readUInt8(2);
        const relayStatusByte = buffer.length >= 5 ? buffer.readUInt8(4) : 0;
        const status = parseAlgStatusByte(statusByte);
        return {
            socPercent: prechargePercent,
            activePhases: buffer.readUInt8(1),
            statusByte,
            maxCurrentA: buffer.readUInt8(3),
            schukoOn: (statusByte & 0x04) !== 0 || (relayStatusByte & 0x10) !== 0,
            ...status,
            chargingEnabled: !status.chargingCanceled,
            rawHex: buffer.subarray(0, Math.min(buffer.length, WALLBOX_EXTERN_DATA_ALG_LEN)).toString('hex'),
        };
    }

    /**
     * Builder for constructing EXTERN_DATA bytes for commands (e.g. current limit).
     */
    static buildCurrentLimitBytes(currentA: number, precharge: number = 0): Buffer {
        const buf = Buffer.alloc(5);
        buf.writeUInt8(precharge, 0); // precharge placeholder
        buf.writeUInt8(0, 1); // phases placeholder
        buf.writeUInt8(0, 2); // status
        buf.writeUInt8(Math.min(32, Math.max(6, currentA)), 3); // current limit
        buf.writeUInt8(0, 4); // relay
        return buf;
    }

    /**
     * Full builder class for Wallbox data to encapsulate all byte logic.
     */
    static createBuilder() {
      return {
        withCurrent: (a: number) => this.buildCurrentLimitBytes(a),
        parse: (b: Buffer) => this.fromBytes(b),
      };
    }

    parse(algBlock: Data): WallboxExternAlgParsed | undefined {
        if (algBlock.tag !== WBTag.EXTERN_DATA_ALG) {
            return undefined;
        }
        const byteBlock = algBlock.valueAsContainer(this.parser)
            .find(value => value.tag === WBTag.EXTERN_DATA);
        if (byteBlock === undefined || byteBlock.size() < 4) {
            return undefined;
        }
        const buffer = Buffer.from(byteBlock.valueAsHex, 'hex');
        const prechargePercent = buffer.readUInt8(0);
        const statusByte = buffer.readUInt8(2);
        const relayStatusByte = buffer.length >= 5 ? buffer.readUInt8(4) : 0;

        const status = parseAlgStatusByte(statusByte);

        return {
            socPercent: prechargePercent,
            activePhases: buffer.readUInt8(1),
            statusByte,
            maxCurrentA: buffer.readUInt8(3),
            schukoOn: (statusByte & 0x04) !== 0 || (relayStatusByte & 0x10) !== 0,
            ...status,
            chargingEnabled: !status.chargingCanceled,
            rawHex: buffer.subarray(0, Math.min(buffer.length, WALLBOX_EXTERN_DATA_ALG_LEN)).toString('hex'),
        };
    }
}

/**
 * WallboxExternDataBuilder - dedicated builder to fully encapsulate EXTERN_DATA logic.
 */
export class WallboxExternDataBuilder {
  private buffer: Buffer;

  constructor() {
    this.buffer = Buffer.alloc(5);
  }

  setCurrentLimit(currentA: number): this {
    this.buffer.writeUInt8(Math.min(32, Math.max(6, currentA)), 3);
    return this;
  }

  setPrecharge(percent: number): this {
    this.buffer.writeUInt8(percent, 0);
    return this;
  }

  build(): Buffer {
    return this.buffer;
  }

  static fromParsed(parsed: WallboxExternAlgParsed): WallboxExternDataBuilder {
    const b = new WallboxExternDataBuilder();
    b.setPrecharge(parsed.socPercent);
    b.setCurrentLimit(parsed.maxCurrentA);
    return b;
  }
}