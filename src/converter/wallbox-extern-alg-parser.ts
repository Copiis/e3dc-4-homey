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