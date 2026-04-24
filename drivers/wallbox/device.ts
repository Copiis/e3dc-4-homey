import Homey from 'homey';
import { WallboxPowerState } from '../../src/model/wallbox-power-state';

class WallboxDevice extends Homey.Device {

  async onInit() {
    this.log('WallboxDevice has been initialized');

    // WENN-Karten (Triggers) vorbereiten
    this.homey.flow.getTriggerCard('wallbox_charging_started');
    this.homey.flow.getTriggerCard('wallbox_charging_stopped');
    this.homey.flow.getTriggerCard('wallbox_plugged_in');
    this.homey.flow.getTriggerCard('wallbox_unplugged');

    // Starte erste Synchronisation
    this.sync();
  }

  /**
   * Wird regelmäßig vom Home-Power-Station-Device aufgerufen
   * oder manuell bei Status-Änderungen
   */
  sync(state: WallboxPowerState): void {
    this.log('Wallbox sync called with state:', JSON.stringify(state));

    // Bestehende Capabilities aktualisieren
    this.updateCapabilityValue('measure_wallbox_consumption', state.powerW ?? 0);
    this.updateCapabilityValue('measure_wallbox_solarshare', state.solarPowerW ?? 0);

    // Neue Capabilities für UND-Karten
    this.updateCapabilityValue('wallbox_is_charging', state.charging ?? false);
    this.updateCapabilityValue('wallbox_is_plugged', state.pluggedIn ?? false);
    this.updateCapabilityValue('wallbox_is_sun_mode', state.sunMode ?? false);

    // === WENN-Karten (Triggers) bei Status-Änderung feuern ===
    const oldCharging = this.getCapabilityValue('wallbox_is_charging') ?? false;
    const newCharging = state.charging ?? false;

    if (!oldCharging && newCharging) {
      this.homey.flow.getTriggerCard('wallbox_charging_started')
        .trigger(this, { energy_total: state.energyTotal ?? 0 })
        .catch(this.error);
    }

    if (oldCharging && !newCharging) {
      this.homey.flow.getTriggerCard('wallbox_charging_stopped')
        .trigger(this, { energy_total: state.energyTotal ?? 0 })
        .catch(this.error);
    }

    // plugged/unplugged Trigger (kann später erweitert werden)
    const oldPlugged = this.getCapabilityValue('wallbox_is_plugged') ?? false;
    const newPlugged = state.pluggedIn ?? false;

    if (!oldPlugged && newPlugged) {
      this.homey.flow.getTriggerCard('wallbox_plugged_in').trigger(this).catch(this.error);
    }
    if (oldPlugged && !newPlugged) {
      this.homey.flow.getTriggerCard('wallbox_unplugged').trigger(this).catch(this.error);
    }
  }

  /**
   * Helper für Capability-Updates (wird im Projekt häufig so verwendet)
   */
  private updateCapabilityValue(capability: string, value: any) {
    if (this.hasCapability(capability)) {
      this.setCapabilityValue(capability, value)
        .catch(err => this.error(`Failed to set ${capability}:`, err));
    }
  }

  onDeleted() {
    this.log('WallboxDevice has been deleted');
  }

  // Falls du später weitere Methoden brauchst (z. B. setCapability oder custom commands)
  // können sie hier ergänzt werden
}

module.exports = WallboxDevice;
