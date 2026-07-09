import {RscpApi} from '../rscp-api';
import {CardUnit} from '../../drivers/home-power-station/device';
import {InternalDevice} from '../internal-api/internal-device';
import {BatteryData} from './battery-data';
import {ChargingConfiguration, EmergencyPowerState} from 'easy-rscp';

export interface BatteryModule extends InternalDevice{
    syncLive(
        rsoc: number,
        batteryPowerW: number,
        chargingConfiguration: ChargingConfiguration,
        emergencyPower: EmergencyPowerState): void

    sync(
        batteryData: BatteryData,
        rsoc: number,
        capacity: number,
        batteryPowerW: number,
        chargingConfiguration: ChargingConfiguration,
        emergencyPower: EmergencyPowerState): void

    /**
     * Update spec/monitoring fields (capacity, temps, etc.) from full battery data readout.
     */
    updateBatteryInfo(batteryData: BatteryData, capacityKwh: number): void
}
