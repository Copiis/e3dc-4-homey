import {
    ChargingConfigurationConverter, EmergencyPowerStateConverter,
    EMSTag,
    Frame,
    FrameConverter,
    InfoTag,
    ManualChargeStateConverter
} from 'easy-rscp';
import {LiveData} from '../model/live-data';
import {WallboxLiveState} from '../model/wallbox-live-state';

export class SyncDataFrameConverter implements FrameConverter<LiveData> {

    constructor(private wbLiveData: WallboxLiveState[], private sysSpecResponse: Frame) {
    }

    convert(frame: Frame): LiveData {
        const chargingConfigConverter = new ChargingConfigurationConverter();
        const manualChargeConverter = new ManualChargeStateConverter()
        const chargingConfig = chargingConfigConverter.convert(this.sysSpecResponse)
        const manualChargeState = manualChargeConverter.convert(frame)
        const emergencyPowerConverter = new EmergencyPowerStateConverter();
        // easy-rscp ≤0.9.1 maps island ↔ invalidState to the wrong EPTags (swapped):
        //   island ← IS_INVALID_STATE, invalidState ← IS_ISLAND_GRID
        // Correct mapping: island = IS_ISLAND_GRID, invalidState = IS_INVALID_STATE.
        // Without this swap, Stromausfall / Inselbetrieb is never detected (flows + timeline silent).
        const rawEmergency = emergencyPowerConverter.convert(frame)
        const emergencyPowerState = {
            ...rawEmergency,
            island: rawEmergency.invalidState,
            invalidState: rawEmergency.island,
        }
        const externalPowerConnected = frame.numberByTag(EMSTag.EXT_SRC_AVAILABLE) >= 1
        let externalPower = 0
        if (externalPowerConnected) {
            externalPower = frame.numberByTag(EMSTag.POWER_ADD) * -1
        }
        return {
            pvDelivery: frame.numberByTag(EMSTag.POWER_PV),
            gridDelivery: frame.numberByTag(EMSTag.POWER_GRID),
            // matches E3DC native sign (as shown in portal): positive when charging the battery, negative when discharging
            batteryDelivery: frame.numberByTag(EMSTag.POWER_BAT),
            houseConsumption: frame.numberByTag(EMSTag.POWER_HOME),
            batteryChargingLevel: frame.numberByTag(EMSTag.BAT_SOC) / 100.0,
            firmwareVersion: frame.stringByTag(InfoTag.SW_RELEASE),
            chargingConfig: chargingConfig,
            manualChargeState: manualChargeState,
            emergencyPowerState: emergencyPowerState,
            wallboxPowerState: this.wbLiveData,
            wallboxCompleteConsumption: frame.numberByTag(EMSTag.POWER_WB_ALL),
            wallboxCompleteConsumptionSolarShare: frame.numberByTag(EMSTag.POWER_WB_SOLAR),
            externalPowerConnected: externalPowerConnected,
            externalPowerDelivery: externalPower,
        }
    }
}
