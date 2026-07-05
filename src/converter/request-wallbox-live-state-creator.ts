import {DataBuilder, Frame, FrameBuilder, FrameCreator, WBTag} from 'easy-rscp';
import { RscpTagRegistry } from '../model/rscp-tag-registry';
const EMS_REQ_GET_RUNSCREENVALUES = RscpTagRegistry.EMS_REQ_GET_RUNSCREENVALUES;
const WB_REQ_GET_CHARGE_PLAN_TEXT = RscpTagRegistry.WB_REQ_GET_CHARGE_PLAN_TEXT;

/** Like easy-rscp RequestWallboxLiveDataCreator, but also requests EXTERN_DATA_ALG + GUI tags. */
export class RequestWallboxLiveStateCreator implements FrameCreator<number[]> {
    create(ids: number[]): Frame {
        const content = ids.map(id => new DataBuilder()
            .tag(WBTag.REQ_DATA)
            .container(
                new DataBuilder().tag(WBTag.INDEX).uchar8(id).build(),
                new DataBuilder().tag(WBTag.REQ_EXTERN_DATA_SUN).build(),
                new DataBuilder().tag(WBTag.REQ_EXTERN_DATA_NET).build(),
                new DataBuilder().tag(WBTag.REQ_EXTERN_DATA_ALL).build(),
                new DataBuilder().tag(WBTag.REQ_EXTERN_DATA_ALG).build(),
                new DataBuilder().tag(WBTag.REQ_SOC).build(),
                new DataBuilder().tag(WB_REQ_GET_CHARGE_PLAN_TEXT).build(),
            )
            .build());
        return new FrameBuilder()
            .addData(...content)
            .addData(new DataBuilder().tag(EMS_REQ_GET_RUNSCREENVALUES).build())
            .build();
    }
}