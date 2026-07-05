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
        const emergencyPowerState = emergencyPowerConverter.convert(frame)
        const externalPowerConnected = frame.numberByTag(EMSTag.EXT_SRC_AVAILABLE) >= 1
        let externalPower = 0
        if (externalPowerConnected) {
            externalPower = frame.numberByTag(EMSTag.POWER_ADD) * -1
        }
        return {
            pvDelivery: frame.numberByTag(EMSTag.POWER_PV),
            gridDelivery: frame.numberByTag(EMSTag.POWER_GRID),
            // app convention: positive = charging the battery (power into battery), negative = discharging (power out)
            batteryDelivery: -frame.numberByTag(EMSTag.POWER_BAT),
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
