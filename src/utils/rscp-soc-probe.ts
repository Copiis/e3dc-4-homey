import {Data, DataParser, DataType, DefaultDataParser, WBTag} from 'easy-rscp';
import { RscpTagRegistry } from '../model/rscp-tag-registry';
const WB_GET_CHARGE_PLAN_TEXT = RscpTagRegistry.WB_GET_CHARGE_PLAN_TEXT;
import {findDataByTag} from './rscp-data-utils';
import {normalizeVehicleSocPercent} from './vehicle-soc';

const SOC_PERCENT_IN_TEXT = /(\d{1,3})\s*%/;

export function parseSocFromChargePlanText(text: string | undefined): number | undefined {
    if (!text) {
        return undefined;
    }
    const match = text.match(SOC_PERCENT_IN_TEXT);
    if (!match) {
        return undefined;
    }
    return normalizeVehicleSocPercent(Number.parseInt(match[1], 10));
}

export function readChargePlanTextFromBlocks(
    blocks: Data[],
    parser: DataParser = new DefaultDataParser(),
): string | undefined {
    const block = findDataByTag(blocks, WB_GET_CHARGE_PLAN_TEXT, parser);
    if (!block) {
        return undefined;
    }
    if (block.type === DataType.STRING) {
        return block.valueAsString();
    }
    const raw = block.valueAsString();
    return raw && raw.length > 0 ? raw : undefined;
}

/** Recursively collect human-readable strings that contain a percentage. */
export function findPercentStringsInTree(
    blocks: Data[],
    parser: DataParser = new DefaultDataParser(),
): string[] {
    const results: string[] = [];
    walkDataTree(blocks, parser, data => {
        if (data.type === DataType.STRING) {
            const text = data.valueAsString();
            if (text && SOC_PERCENT_IN_TEXT.test(text)) {
                results.push(text);
            }
        }
    });
    return results;
}

/**
 * Untersucht RSCP-Daten nach Vehicle-SOC Quellen.
 *
 * Gibt verschiedene Kandidaten zurück (RSCP, ALG, Charge-Plan, % Strings).
 * Wird verwendet, um Vehicle SOC zu schätzen, wenn kein direkter Wert verfügbar ist
 * (z. B. für Flow-Karten und Diagnose).
 *
 * Wird von WallboxManager und anderen Komponenten genutzt.
 */
export function probeVehicleSocSources(
    blocks: Data[],
    parser: DataParser = new DefaultDataParser(),
): {
    rscpSoc?: number;
    algPrecharge?: number;
    chargePlanText?: string;
    chargePlanSoc?: number;
    percentStrings: string[];
} {
    const rscpSoc = findDataByTag(blocks, WBTag.SOC, parser)?.valueAsNumber();
    const chargePlanText = readChargePlanTextFromBlocks(blocks, parser);
    const percentStrings = findPercentStringsInTree(blocks, parser);
    const chargePlanSoc = parseSocFromChargePlanText(chargePlanText);
    const percentSoc = percentStrings
        .map(parseSocFromChargePlanText)
        .find(value => value !== undefined && value > 0);

    return {
        rscpSoc: Number.isNaN(rscpSoc) ? undefined : rscpSoc,
        chargePlanText,
        chargePlanSoc: chargePlanSoc ?? percentSoc,
        percentStrings,
    };
}

function walkDataTree(
    blocks: Data[],
    parser: DataParser,
    visit: (data: Data) => void,
): void {
    for (const block of blocks) {
        visit(block);
        if (block.type === DataType.CONTAINER) {
            walkDataTree(block.valueAsContainer(parser), parser, visit);
        }
    }
}