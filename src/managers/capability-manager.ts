import { LiveData } from '../model/live-data';
import { updateCapabilityValue } from '../utils/capability-utils';
import { EnergyMeterIntegrator } from '../utils/energy-meter-integrator';
import { formatError } from '../utils/error-utils';
import { IHpsDevice } from '../types/hps-device';
import type { ChargingConfiguration, EmergencyPowerState, ManualChargeState } from 'easy-rscp';
import { ValueChanged } from '../model/value-changed';

/**
 * Result of processing live power data (used by HKW device for EMS triggers).
 */
export interface PowerDataChanges {
  batteryLevelChange?: ValueChanged<number>;
  gridDeliveryChange?: ValueChanged<number>;
  batteryDeliveryChange?: ValueChanged<number>;
}

/**
 * CapabilityManager / Synchronizer
 *
 * Extracted from the original monolithic HomePowerStationDevice to improve
 * maintainability and testability (Athom Beauty initiative).
 *
 * Responsibilities:
 * - Translate LiveData from RSCP into Homey capability values
 * - Fire value-changed triggers for power flows (grid / battery / house)
 * - Manage linked sub-devices (grid-meter, battery-module) updates
 * - Track current charging / manual charge / emergency power state
 *
 * All updates go through typed IHpsDevice – no more casts at call site.
 */
export class CapabilityManager {
  currentChargingConfig: ChargingConfiguration | null = null;
  currentManualChargeState: ManualChargeState | null = null;
  currentEmergencyPowerState: EmergencyPowerState | null = null;

  constructor(private readonly device: IHpsDevice, private readonly energyMeter: EnergyMeterIntegrator) {}

  /**
   * Main entry for live power values.
   * Updates PV, grid, battery, house consumption capabilities and returns
   * the delta information used by EMS schedule triggers.
   */
  processLivePowerData(result: LiveData): PowerDataChanges {
    updateCapabilityValue('measure_power', result.pvDelivery, this.device);
    const generatedKwh = this.energyMeter.integrateGeneration(result.pvDelivery);
    updateCapabilityValue('meter_power', generatedKwh, this.device);

    const gridDeliveryChange = updateCapabilityValue('measure_grid_delivery', result.gridDelivery, this.device);
    const batteryDeliveryChange = updateCapabilityValue('measure_battery_delivery', result.batteryDelivery * -1, this.device);
    const houseConsumptionChange = updateCapabilityValue('measure_house_consumption', result.houseConsumption, this.device);

    // Triggers are now properly typed on IHpsDevice (optional)
    this.device.gridPowerHasChangedTrigger?.runIfChanged(gridDeliveryChange);
    this.device.batteryPowerHasChangedTrigger?.runIfChanged(batteryDeliveryChange);
    this.device.houseConsumptionHasChangedTrigger?.runIfChanged(houseConsumptionChange);

    const batteryLevelChange = updateCapabilityValue('measure_battery', result.batteryChargingLevel * 100, this.device);
    return { batteryLevelChange, gridDeliveryChange, batteryDeliveryChange };
  }

  updateExternalPower(result: LiveData) {
    updateCapabilityValue('external_power_delivery_connected', result.externalPowerConnected, this.device);
    if (result.externalPowerConnected) {
      updateCapabilityValue('measure_external_power_delivery', result.externalPowerDelivery, this.device);
    } else {
      if (this.device.hasCapability('measure_external_power_delivery')) {
        this.device.removeCapability('measure_external_power_delivery').then().catch(() => {});
      }
    }
  }

  handleChargeTime(result: LiveData) {
    this.device.getBatteryCapacity()
        .then((capacityWh: number) => {
          let targetWh = 0;
          if (result.batteryDelivery > 0) {
            targetWh = Math.abs(capacityWh * result.batteryChargingLevel);
          } else {
            targetWh = Math.abs(capacityWh * (1 - result.batteryChargingLevel));
          }

          const batteryPowerFromCap = Math.abs( Number(this.device.getCapabilityValue('measure_battery_delivery')) || 0 );
          const batteryPowerW = batteryPowerFromCap > 0 ? batteryPowerFromCap : Math.abs(result.batteryDelivery);

          let finalValue: string;
          if (batteryPowerW <= 0) {
            finalValue = '> 24h';
          } else {
            const minutes = targetWh / batteryPowerW * 60;
            const batteryRemainingHours = Math.floor(minutes / 60);
            let batteryRemainingMin = Math.floor(minutes % 60);
            let hoursAsString = '' + batteryRemainingHours;
            let minAsString = '' + batteryRemainingMin;
            if (hoursAsString.length == 1) {
              hoursAsString = '0' + hoursAsString;
            }
            if (minAsString.length == 1) {
              minAsString = '0' + minAsString;
            }

            if (batteryRemainingHours > 24) {
              finalValue = '> 24h';
            }
            else if (batteryRemainingHours == 0 && batteryRemainingMin < 10) {
              finalValue = '< 10min';
            }
            else {
              finalValue = hoursAsString + ':' + minAsString;
            }
          }

          updateCapabilityValue('charge_time', finalValue, this.device);
        })
        .catch((reason: unknown) => {
          this.device.log('handleChargeTimeCapability: ' + formatError(reason));
        });
  }

  updateLinkedBattery(result: LiveData) {
    // basic delegation, full logic can be here
    this.device.updateLinkedBatteryLiveData?.(result);
  }

  updateBatteryDataIfNeeded() {
    // moved from device to reduce monolith
    // the flag logic is now here
    if (this.device.updateBatteryData) {
      this.device.updateBatteryData = false;
      this.device.getBatteryCapacity().catch(() => {});
    }
  }

  handleFirmwareChange(result: LiveData) {
    const firmwareChange = updateCapabilityValue('firmware_version', result.firmwareVersion, this.device);
    this.device.firmwareChangedTrigger?.runIfChanged(firmwareChange);
    if (firmwareChange?.oldValue) {
      this.device.postTimelineNotification(this.device.homey.__('timeline.firmware-updated', {
        OLD: String(firmwareChange.oldValue),
        NEW: String(firmwareChange.newValue),
      }));
    }
  }

  handleChargingConfigurationChanges(result: LiveData) {
    const change = updateCapabilityValue('charging_configuration', result.chargingConfig, this.device);
    if (change) {
      this.currentChargingConfig = result.chargingConfig;
    }
  }

  handleManualChargeStateChanges(result: LiveData) {
    const change = updateCapabilityValue('manual_charge_state', result.manualChargeState, this.device);
    if (change) {
      this.currentManualChargeState = result.manualChargeState;
      if (result.manualChargeState && result.manualChargeState.active) {
        try {
          this.device.manualBatteryChargingStartedTrigger?.trigger(result.manualChargeState.chargedEnergyWh);
        } catch (e) {
          this.device.error('manualBatteryChargingStartedTrigger failed: ' + formatError(e));
        }
      }
    }
  }

  handleEmergencyPowerStateChanges(result: LiveData) {
    const change = updateCapabilityValue('emergency_power_state', result.emergencyPowerState, this.device);
    if (change) {
      this.currentEmergencyPowerState = result.emergencyPowerState;
      if (result.emergencyPowerState?.island) {
        this.device.islandModeStartedTrigger?.trigger(undefined);
      }
    }
    this.currentEmergencyPowerState = result.emergencyPowerState;
  }

  handleAvailability() {
    const wasUnavailable = !this.device.getAvailable();
    this.device.syncErrorCount = 0;
    if (wasUnavailable) {
      this.device.recordAnalysisEvent('info', 'HKW wieder verfügbar / available again');
      if (!this.device.getAvailable()) {
        this.device.setAvailable(true).catch((reason: unknown) => this.device.error('Failed to set available: ' + formatError(reason)));
      }
      this.device.publishDiagnosticReport().catch(() => undefined);
    }
  }

  updateLinkedGridMeter(result: LiveData): void {
    const gridMeterDevices = this.device.homey.drivers.getDriver('grid-meter').getDevices();
    const stationId = this.device.getId();
    gridMeterDevices.forEach((currentDevice: unknown) => {
      // Linked grid-meter devices expose a sync() method (duck-typed)
      const gridConfig = (currentDevice as { getStoreValue: (k: string) => unknown }).getStoreValue('settings') as { stationId?: string } | undefined;
      if (!gridConfig?.stationId) {
        return;
      }
      if (gridConfig.stationId === stationId) {
        (currentDevice as { sync?: (v: number) => void }).sync?.(result.gridDelivery);
      }
    });
  }

  updateLinkedBatteryLiveData(result: LiveData) {
    const batteryDevices = this.device.homey.drivers.getDriver('battery-module').getDevices();
    const stationId = this.device.getId();
    batteryDevices.forEach((currentDevice: unknown) => {
      const batteryConfig = (currentDevice as { getStoreValue: (k: string) => unknown }).getStoreValue('settings') as { stationId?: string } | undefined;
      if (!batteryConfig?.stationId) {
        return;
      }
      if (batteryConfig.stationId == stationId) {
        const linked = currentDevice as {
          syncLive?: (level: number, delivery: number, config: unknown, eps: unknown) => void
        };
        linked.syncLive?.(
          result.batteryChargingLevel * 100,
          result.batteryDelivery * -1,
          result.chargingConfig,
          result.emergencyPowerState);
      }
    });
  }
}
