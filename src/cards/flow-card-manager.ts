/**
 * FlowCardManager - extracted to reduce device.ts monolith.
 * Handles registration of action/condition/trigger cards.
 * (Partial extraction as continuation of feedback points)
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

export class FlowCardManager {
  constructor(private readonly homey: any) {}

  setupActionCards() {
    // Power mode actions
    this.homey.flow.getActionCard('set_power_mode_auto').registerRunListener(new SetPowerModeAutoActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_idle').registerRunListener(new SetPowerModeIdleActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_charge').registerRunListener(new SetPowerModeChargeActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_discharge').registerRunListener(new SetPowerModeDischargeActionCard().run);
    this.homey.flow.getActionCard('set_power_mode_grid_charge').registerRunListener(new SetPowerModeGridChargeActionCard().run);

    // Other actions (excerpt)
    const exportCard = this.homey.flow.getActionCard('export_diagnostic_report');
    exportCard.registerRunListener(new ExportDiagnosticReportActionCard().run);

    this.homey.flow.getActionCard('remove_emergency_reserve').registerRunListener(new RemoveEmergencyReserveActionCard().run);
    this.homey.flow.getActionCard('configure_emergency_reserve').registerRunListener(new ConfigureEmergencyReserveActionCard().run);
    this.homey.flow.getActionCard('stop_manual_battery_charging').registerRunListener(new StopManualBatteryChargeActionCard().run);

    const startAmount = this.homey.flow.getActionCard('start_manual_battery_charging_amount');
    startAmount.registerRunListener(new StartManualBatteryChargeWhActionCard().run);

    const startPerc = this.homey.flow.getActionCard('start_manual_battery_charging_percentage');
    startPerc.registerRunListener(new StartManualBatteryChargeActionPercentageCard().run);

    this.homey.flow.getActionCard('activate_configured_power_limits').registerRunListener(new ActivatePowerLimitsActionCard().run);
    this.homey.flow.getActionCard('deactivate_configured_power_limits').registerRunListener(new DeactivatePowerLimitsActionCard().run);
  }

  // Condition and trigger setup can be moved similarly in future iterations
  setupConditionCards() {
    // TODO: extract from device.ts
  }

  setupTriggerCards() {
    // TODO: extract from device.ts
  }
}
