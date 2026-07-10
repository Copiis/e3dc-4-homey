import { LiveData } from '../model/live-data';
import { updateCapabilityValue } from '../utils/capability-utils';
import { EnergyMeterIntegrator } from '../utils/energy-meter-integrator';
import { formatError } from '../utils/error-utils';
import { IHpsDevice } from '../types/hps-device';
import type { ChargingConfiguration, EmergencyPowerState, ManualChargeState } from 'easy-rscp';
import { ValueChanged } from '../model/value-changed';
import { calculatePvSurplusW } from '../utils/pv-surplus';

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
 * Extrahiert aus dem HKW-Monolithen. Verantwortlich für die Synchronisation
 * von LiveData auf Homey-Capabilities und verknüpfte Geräte.
 *
 * Aufgaben:
 * - Übersetzung von RSCP-LiveData in Capability-Werte (Power, Energy, States)
 * - Auslösen von Value-Changed-Triggers für Grid/Battery/House
 * - Update von verknüpften Sub-Devices (Grid-Meter, Battery-Module)
 * - Tracken transienter States (ChargingConfig, ManualCharge, EmergencyPower)
 * - Berechnung von Charge-Time und Energy-Integration
 *
 * Vollkommen entkoppelt über IHpsDevice. Keine Casts mehr.
 */
export class CapabilityManager {
  currentChargingConfig: ChargingConfiguration | null = null;
  currentManualChargeState: ManualChargeState | null = null;
  currentEmergencyPowerState: EmergencyPowerState | null = null;
  lastPvSurplusW = 0;

  // Short in-memory caches for linked sub-devices to avoid repeated getDriver().getDevices() + getStoreValue
  // every 30s poll (addresses repeated device lookups / sync store reads).
  private gridCache: { timestamp: number; devices: unknown[] } | null = null;
  private batteryCache: { timestamp: number; devices: unknown[] } | null = null;
  private static readonly LINKED_CACHE_TTL_MS = 60_000;

  constructor(private readonly device: IHpsDevice, private readonly energyMeter: EnergyMeterIntegrator) {}

  private getLinkedGridMeters(): unknown[] {
    const now = Date.now();
    if (this.gridCache && now - this.gridCache.timestamp < CapabilityManager.LINKED_CACHE_TTL_MS) {
      return this.gridCache.devices;
    }
    const devices = this.device.homey.drivers.getDriver('grid-meter').getDevices();
    this.gridCache = { timestamp: now, devices };
    return devices;
  }

  private getLinkedBatteryModules(): unknown[] {
    const now = Date.now();
    if (this.batteryCache && now - this.batteryCache.timestamp < CapabilityManager.LINKED_CACHE_TTL_MS) {
      return this.batteryCache.devices;
    }
    const devices = this.device.homey.drivers.getDriver('battery-module').getDevices();
    this.batteryCache = { timestamp: now, devices };
    return devices;
  }

  /**
   * Haupteinstiegspunkt für Live-Power-Daten.
   * Aktualisiert alle relevanten Capabilities und liefert Delta-Infos
   * für EMS-Schedule-Trigger zurück.
   */
  processLivePowerData(result: LiveData): PowerDataChanges {
    updateCapabilityValue('measure_power', result.pvDelivery, this.device);
    const generatedKwh = this.energyMeter.integrateGeneration(result.pvDelivery);
    updateCapabilityValue('meter_power', generatedKwh, this.device);

    const gridDeliveryChange = updateCapabilityValue('measure_grid_delivery', result.gridDelivery, this.device);
    // Force set for battery power to ensure tiles (especially after re-adding the capability to the device tile) get the current value
    const batteryDeliveryChange = updateCapabilityValue('measure_battery_delivery', result.batteryDelivery, this.device, { force: true });
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
          // Correct remaining time under current conditions:
          // - charging (batteryDelivery > 0): time to full = capacity * (1 - SoC)
          // - discharging: time to empty = capacity * SoC
          // Matches E3DC sign convention (positive batteryDelivery = charging).
          let targetWh = 0;
          const soc = result.batteryChargingLevel || 0;
          if (result.batteryDelivery > 0) { // positive = charging (E3DC sign) → remaining to full
            targetWh = capacityWh * (1 - soc);
          } else {
            targetWh = capacityWh * soc; // discharging (or zero) → remaining to empty
          }
          targetWh = Math.max(0, targetWh);

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
    // delegate to the actual implementation (was moved here for monolith reduction)
    this.updateLinkedBatteryLiveData(result);
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
    const gridMeterDevices = this.getLinkedGridMeters();
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
    const batteryDevices = this.getLinkedBatteryModules();
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
        // Note: We pass the *total* station battery power here.
        // Individual battery-module tiles show the system total (not per-module split).
        // This is by design for simplicity and matches E3DC portal behavior for many users.
        linked.syncLive?.(
          result.batteryChargingLevel * 100,
          result.batteryDelivery,
          result.chargingConfig,
          result.emergencyPowerState);
      }
    });
  }

  /**
   * Handles PV surplus and battery SoC triggers.
   * Moved here from EmsScheduleManager as it is general trigger logic, not schedule specific.
   */
  handleEmsTriggers(result: LiveData, batteryLevelChange?: ValueChanged<number>) {
    const batteryPowerW = result.batteryDelivery;
    const surplus = calculatePvSurplusW(result.pvDelivery, result.houseConsumption, batteryPowerW);
    const previousSurplus = this.lastPvSurplusW || 0;
    this.lastPvSurplusW = surplus;

    try {
      const pvSurplusCard = this.device.homey.flow.getDeviceTriggerCard('pv_surplus_exceeds');
      pvSurplusCard.trigger(this.device, { surplus }, { surplus, previousSurplus })
        .catch((reason: unknown) => this.device.error('PV surplus trigger failed: ' + formatError(reason)));
    } catch (e) {
      this.device.error('PV surplus trigger card unavailable: ' + formatError(e));
    }

    if (batteryLevelChange?.oldValue != null && batteryLevelChange.newValue != null) {
      try {
        const socCard = this.device.homey.flow.getDeviceTriggerCard('battery_soc_below');
        socCard.trigger(this.device, { soc: batteryLevelChange.newValue }, {
          soc: batteryLevelChange.newValue,
          previousSoc: batteryLevelChange.oldValue,
        }).catch((reason: unknown) => this.device.error('Battery SoC trigger failed: ' + formatError(reason)));
      } catch (e) {
        this.device.error('Battery SoC trigger card unavailable: ' + formatError(e));
      }
    }
  }
}
