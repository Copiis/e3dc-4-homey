/**
 * FlowCardManager - extracted to reduce device.ts monolith.
 * Handles registration of action/condition/trigger cards.
 */

import * as Homey from 'homey';
import {
  SetPowerModeAutoActionCard,
  SetPowerModeChargeActionCard,
  SetPowerModeDischargeActionCard,
  SetPowerModeGridChargeActionCard,
  SetPowerModeIdleActionCard,
} from './action/set-power-mode.action.card';
import {ExportDiagnosticReportActionCard} from './action/export-diagnostic-report.action.card';
import {RemoveEmergencyReserveActionCard} from './action/remove-emergency-reserve.action.card';
import {ConfigureEmergencyReserveActionCard} from './action/configure-emergency-reserve.action.card';
import {StopManualBatteryChargeActionCard} from './action/stop-manual-battery-charge.action.card';
import {
  StartManualBatteryChargeWhActionCard,
  StartManualBatteryChargeActionPercentageCard,
} from './action/start-manual-battery-charge.action.card';
import {ActivatePowerLimitsActionCard} from './action/activate-power-limits.action.card';
import {DeactivatePowerLimitsActionCard} from './action/deactivate-power-limits.action.card';
import { SetMaxChargingPowerActionCard } from './action/set-max-charging-power.action.card';
import { RemoveMaxChargingPowerLimitActionCard } from './action/remove-max-charging-power-limit.action.card';
import { SetMaxDischargingPowerActionCard } from './action/set-max-discharging-power.action.card';
import { RemoveMaxDischargingPowerLimitActionCard } from './action/remove-max-discharging-power-limit.action.card';
import { SetPowerLimitsToDefaultActionCard } from './action/set-power-limits-to-default.action.card';
import { ProvideChargingConfigurationActionCard } from './action/provide-charging-configuration.action.card';

import { IslandModeStartedTrigger } from './trigger/island-mode-started.trigger';
import { IslandModeStoppedTrigger } from './trigger/island-mode-stopped.trigger';
import { ManualBatteryChargingStartedTrigger } from './trigger/manual-battery-charging-started.trigger';
import { ManualBatteryChargingStoppedTrigger } from './trigger/manual-battery-charging-stopped.trigger';
import { SimpleValueChangedTrigger } from './trigger/simple-value-changed.trigger';

import { IsEmergencyPowerReserveGreaterThanConditionCard } from './condition/is-emergency-power-reserve-greater-than.condition.card';
import { IsIslandModeActiveConditionCard } from './condition/is-island-mode-active.condition.card';
import { IsIslandModePossibleConditionCard } from './condition/is-island-mode-possible.condition.card';
import { IsManualChargeActiveConditionCard } from './condition/is-manual-charge-active.condition.card';
import { IsMaxChargingLimitGreaterThanConditionCard } from './condition/is-max-charging-limit-greater-than.condition.card';
import { IsMaxDischargingLimitGreaterThanConditionCard } from './condition/is-max-discharging-limit-greater-than.condition.card';
import { IsMaxChargingLimitActiveConditionCard } from './condition/is-max-charging-limit-active.condition.card';
import { IsMaxDischargingLimitActiveConditionCard } from './condition/is-max-discharging-limit-active.condition.card';
import { IsAnyPowerLimitActiveConditionCard } from './condition/is-any-power-limit-active.condition.card';

export class FlowCardManager {
  constructor(private readonly device: any) {
    // device is the HomePowerStationDevice instance for triggers
  }

  get homey() {
    return this.device.homey;
  }

  setupTriggerCards() {
    const steps: Array<{ name: string, run: () => void }> = [
      { name: 'firmware_has_changed', run: () => this.setupFirmwareChangedCard() },
      { name: 'max_charging_limit_has_changed', run: () => this.setupMaxChargingLimitChangedCard() },
      { name: 'max_discharging_limit_has_changed', run: () => this.setupMaxDischargingLimitChangedCard() },
      { name: 'manual_charge_cards', run: () => this.setupStartManualChargeCards() },
      { name: 'manual_battery_charging_started', run: () => this.setupManualBatteryChargingStartedCard() },
      { name: 'manual_battery_charging_stopped', run: () => this.setupManualBatteryChargingStoppedCard() },
      { name: 'island_mode', run: () => this.setupIslandModeCards() },
      { name: 'emergency_power_reserve_has_changed', run: () => this.setupEmergencyPowerReserveChangedCard() },
      { name: 'house_consumption_has_changed', run: () => this.setupHouseConsumptionChangedCard() },
      { name: 'battery_power_has_changed', run: () => this.setupBatteryPowerChangedCard() },
      { name: 'grid_power_has_changed', run: () => this.setupGridPowerChangedCard() },
    ];
    steps.forEach(step => {
      try {
        step.run();
      } catch (e) {
        this.device.error(`Trigger card setup failed (${step.name}): ${e}`);
      }
    });
  }

  private setupIslandModeCards() {
    let card = this.homey.flow.getDeviceTriggerCard('island_mode_started');
    this.device.islandModeStartedTrigger = new IslandModeStartedTrigger(this.device, card, this.device);

    card = this.homey.flow.getDeviceTriggerCard('island_mode_stopped');
    this.device.islandModeStoppedTrigger = new IslandModeStoppedTrigger(this.device, card, this.device);
  }

  private setupManualBatteryChargingStoppedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('manual_battery_charging_stopped');
    this.device.manualBatteryChargingStoppedTrigger = new ManualBatteryChargingStoppedTrigger(this.device, card, this.device);
  }

  private setupManualBatteryChargingStartedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('manual_battery_charging_started');
    this.device.manualBatteryChargingStartedTrigger = new ManualBatteryChargingStartedTrigger(this.device, card, this.device);
  }

  private setupFirmwareChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('firmware_has_changed');
    this.device.firmwareChangedTrigger = new SimpleValueChangedTrigger<string>('Firmware', this.device, card, this.device);
  }

  private setupMaxChargingLimitChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('max_charging_limit_has_changed');
    this.device.maxChargingLimitHasChangedTrigger = new SimpleValueChangedTrigger<number>('Charging limit', this.device, card, this.device);
  }

  private setupMaxDischargingLimitChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('max_discharging_limit_has_changed');
    this.device.maxDischargingLimitHasChangedTrigger = new SimpleValueChangedTrigger<number>('Discharging limit', this.device, card, this.device);
  }

  private setupEmergencyPowerReserveChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('emergency_power_reserve_has_changed');
    this.device.emergencyPowerReserveChangedTrigger = new SimpleValueChangedTrigger<number>('Emergency power reserve', this.device, card, this.device);
  }

  private setupHouseConsumptionChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('house_consumption_has_changed');
    this.device.houseConsumptionHasChangedTrigger = new SimpleValueChangedTrigger<number>('House consumption', this.device, card, this.device);
  }

  private setupBatteryPowerChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('battery_power_has_changed');
    this.device.batteryPowerHasChangedTrigger = new SimpleValueChangedTrigger<number>('Battery power', this.device, card, this.device);
  }

  private setupGridPowerChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('grid_power_has_changed');
    this.device.gridPowerHasChangedTrigger = new SimpleValueChangedTrigger<number>('Grid power', this.device, card, this.device);
  }

  setupConditionCards() {
    this.setupIsMaxChargingPowerGreaterThan();
    this.setupIsMaxDischargingPowerGreaterThan();
    this.setupIsMaxChargingPowerLimitActive();
    this.setupIsMaxDischargingPowerLimitActive();
    this.setupIsAnyPowerLimitActive();
    this.setupIsManualChargeActive();
    this.setupEmergencyPowerConditionCards();
  }

  private setupEmergencyPowerConditionCards() {
    let card = this.homey.flow.getConditionCard('is_emergency_power_reserve_greater_than');
    card.registerRunListener(new IsEmergencyPowerReserveGreaterThanConditionCard().run);

    card = this.homey.flow.getConditionCard('is_island_mode_active');
    card.registerRunListener(new IsIslandModeActiveConditionCard().run);

    card = this.homey.flow.getConditionCard('is_island_mode_possible');
    card.registerRunListener(new IsIslandModePossibleConditionCard().run);
  }

  private setupIsManualChargeActive() {
    const card = this.homey.flow.getConditionCard('is_manual_charge_active');
    card.registerRunListener(new IsManualChargeActiveConditionCard().run);
  }

  private setupIsMaxChargingPowerGreaterThan() {
    const card = this.homey.flow.getConditionCard('is_max_charging_limit_greater_than');
    card.registerRunListener(new IsMaxChargingLimitGreaterThanConditionCard().run);
  }

  private setupIsMaxDischargingPowerGreaterThan() {
    const card = this.homey.flow.getConditionCard('is_max_discharging_limit_greater_than');
    card.registerRunListener(new IsMaxDischargingLimitGreaterThanConditionCard().run);
  }

  private setupIsMaxChargingPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_max_charging_limit_active');
    card.registerRunListener(new IsMaxChargingLimitActiveConditionCard().run);
  }

  private setupIsMaxDischargingPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_max_discharging_limit_active');
    card.registerRunListener(new IsMaxDischargingLimitActiveConditionCard().run);
  }

  private setupIsAnyPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_any_power_limit_active');
    card.registerRunListener(new IsAnyPowerLimitActiveConditionCard().run);
  }

  setupActionCards() {
    this.setupConfigureMaxChargingLimitActionCard();
    this.setupRemoveMaxChargingLimitActionCard();
    this.setupConfigureMaxDischargingLimitActionCard();
    this.setupRemoveMaxDischargingLimitActionCard();
    this.setupRemoveAllLimitsActionCard();
    this.setupReadChargingConfiguration();
    this.setupActivatePowerLimitsCard();
    this.setupDeactivatePowerLimitsCard();
    this.setupStartManualChargeCards();
    this.setupStopManualChargeCards();
    this.setupConfigureEmergencyPowerReserve();
    this.setupRemoveEmergencyPowerReserve();
    this.setupExportDiagnosticReportCard();
    this.setupPowerModeActionCards();
  }

  private setupExportDiagnosticReportCard() {
    const card = this.homey.flow.getActionCard('export_diagnostic_report');
    card.registerRunListener(new ExportDiagnosticReportActionCard().run);
  }

  private setupPowerModeActionCards() {
    this.homey.flow.getActionCard('set_power_mode_auto').registerRunListener(new SetPowerModeAutoActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_idle').registerRunListener(new SetPowerModeIdleActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_charge').registerRunListener(new SetPowerModeChargeActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_discharge').registerRunListener(new SetPowerModeDischargeActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_grid_charge').registerRunListener(new SetPowerModeGridChargeActionCard().run);
  }

  private setupRemoveEmergencyPowerReserve() {
    const card = this.homey.flow.getActionCard('remove_emergency_reserve');
    card.registerRunListener(new RemoveEmergencyReserveActionCard().run);
  }

  private setupConfigureEmergencyPowerReserve() {
    const card = this.homey.flow.getActionCard('configure_emergency_reserve');
    card.registerRunListener(new ConfigureEmergencyReserveActionCard().run);
  }

  private setupStopManualChargeCards() {
    const card = this.homey.flow.getActionCard('stop_manual_battery_charging');
    card.registerRunListener(new StopManualBatteryChargeActionCard().run);
  }

  private setupStartManualChargeCards() {
    const card = this.homey.flow.getActionCard('start_manual_battery_charging_amount');
    card.registerRunListener(new StartManualBatteryChargeWhActionCard().run);

    const cardPercemtage = this.homey.flow.getActionCard('start_manual_battery_charging_percentage');
    cardPercemtage.registerRunListener(new StartManualBatteryChargeActionPercentageCard().run);
  }

  private setupActivatePowerLimitsCard() {
    const card = this.homey.flow.getActionCard('activate_configured_power_limits');
    card.registerRunListener(new ActivatePowerLimitsActionCard().run);
  }

  private setupDeactivatePowerLimitsCard() {
    const card = this.homey.flow.getActionCard('deactivate_configured_power_limits');
    card.registerRunListener(new DeactivatePowerLimitsActionCard().run);
  }

  private setupConfigureMaxChargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('configure_max_charging_power');
    card.registerRunListener(new SetMaxChargingPowerActionCard().run);
  }

  private setupRemoveMaxChargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('remove_max_charging_power');
    card.registerRunListener(new RemoveMaxChargingPowerLimitActionCard().run);
  }

  private setupConfigureMaxDischargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('configure_max_discharging_power');
    card.registerRunListener(new SetMaxDischargingPowerActionCard().run);
  }

  private setupRemoveMaxDischargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('remove_max_discharging_power');
    card.registerRunListener(new RemoveMaxDischargingPowerLimitActionCard().run);
  }

  private setupRemoveAllLimitsActionCard() {
    const card = this.homey.flow.getActionCard('remove_all_power_limits');
    card.registerRunListener(new SetPowerLimitsToDefaultActionCard().run);
  }

  private setupReadChargingConfiguration() {
    const card = this.homey.flow.getActionCard('provide_charging_configuration');
    card.registerRunListener(new ProvideChargingConfigurationActionCard().run);
  }
}
