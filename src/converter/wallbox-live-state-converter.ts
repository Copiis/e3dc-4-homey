import {
    DefaultDataParser,
    DefaultWbExternalDataParser,
    Frame,
    FrameConverter,
    WBTag,
} from 'easy-rscp';
import { RscpTagRegistry } from '../model/rscp-tag-registry';
const EMS_GET_RUNSCREENVALUES = RscpTagRegistry.EMS_GET_RUNSCREENVALUES;
import {WallboxLiveState} from '../model/wallbox-live-state';
import {findDataByTag} from '../utils/rscp-data-utils';
import {findPercentStringsInTree, probeVehicleSocSources} from '../utils/rscp-soc-probe';
import {pickVehicleSocPercent, readVehicleSocFromBlocks} from '../utils/vehicle-soc';
import {WallboxExternAlgParser} from './wallbox-extern-alg-parser';

export class WallboxLiveStateConverter implements FrameConverter<WallboxLiveState[]> {
    private readonly parser = new DefaultDataParser();
    private readonly externalDataParser = new DefaultWbExternalDataParser(this.parser);
    private readonly algParser = new WallboxExternAlgParser(this.parser);

    convert(frame: Frame): WallboxLiveState[] {
        const result: WallboxLiveState[] = [];
        const runscreenBlock = findDataByTag(frame.data, EMS_GET_RUNSCREENVALUES, this.parser);
        const runscreenPercentTexts = runscreenBlock
            ? findPercentStringsInTree([runscreenBlock], this.parser)
            : [];
        const frameProbe = probeVehicleSocSources(frame.data, this.parser);

        frame.data
            .filter(value => value.tag === WBTag.DATA)
            .forEach(dataBlock => {
                const childs = dataBlock.valueAsContainer(this.parser);
                const index = childs.find(child => child.tag === WBTag.INDEX)?.valueAsNumber();
                const sunRaw = childs.find(child => child.tag === WBTag.EXTERN_DATA_SUN);
                const netRaw = childs.find(child => child.tag === WBTag.EXTERN_DATA_NET);
                const allRaw = childs.find(child => child.tag === WBTag.EXTERN_DATA_ALL);
                const algRaw = childs.find(child => child.tag === WBTag.EXTERN_DATA_ALG);
                if (index === undefined || sunRaw === undefined || allRaw === undefined) {
                    return;
                }
                try {
                    const sun = this.externalDataParser.parseEnergyData(sunRaw);
                    const net = netRaw ? this.externalDataParser.parseEnergyData(netRaw) : undefined;
                    const all = this.externalDataParser.parseEnergyData(allRaw);
                    const alg = algRaw ? this.algParser.parse(algRaw) : undefined;
                    const blockProbe = probeVehicleSocSources(childs, this.parser);
                    const rscpSoc = readVehicleSocFromBlocks(childs, this.parser) ?? blockProbe.rscpSoc;
                    result.push({
                        id: index,
                        powerW: all.powerW,
                        totalEnergyWh: all.totalEnergyWh,
                        solarPowerW: sun.powerW,
                        gridPowerW: net?.powerW,
                        socPercent: pickVehicleSocPercent(
                            rscpSoc,
                            blockProbe.chargePlanSoc,
                            frameProbe.chargePlanSoc,
                            alg?.socPercent,
                        ),
                        socDiagnostics: {
                            rscpSocRaw: rscpSoc,
                            algPrecharge: alg?.socPercent,
                            algHex: alg?.rawHex,
                            chargePlanText: blockProbe.chargePlanText ?? frameProbe.chargePlanText,
                            chargePlanSoc: blockProbe.chargePlanSoc ?? frameProbe.chargePlanSoc,
                            runscreenPercentTexts: runscreenPercentTexts.length > 0
                                ? runscreenPercentTexts
                                : frameProbe.percentStrings,
                        },
                        activePhases: alg?.activePhases,
                        maxCurrentA: alg?.maxCurrentA,
                        sunModeActive: alg?.sunModeActive ?? false,
                        chargingCanceled: alg?.chargingCanceled ?? false,
                        chargingActive: alg?.chargingActive ?? false,
                        chargingEnabled: alg?.chargingEnabled ?? false,
                        plugged: alg?.plugged ?? false,
                        plugLocked: alg?.plugLocked ?? false,
                        schukoOn: alg?.schukoOn ?? false,
                    });
                } catch {
                    // ignore unparsable wallbox blocks
                }
            });
        return result;
    }
}