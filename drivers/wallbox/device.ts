import Homey from 'homey';
import { WallboxPowerState } from '../../src/model/wallbox-power-state';

class WallboxDevice extends Homey.Device {

  async onInit() {
    this.log('✅ WallboxDevice has been initialized');
  }

  /**
   * Wird vom Home-Power-Station-Device aufgerufen – bleibt leer, damit keine Schleife entsteht
   */
  sync(state: WallboxPowerState): void {
    this.log('Wallbox sync called (no capabilities set to avoid loop)');
    // Nur die beiden sicheren Capabilities aktualisieren
    this.updateCapabilityValue('measure_wallbox_consumption', state.powerW ?? 0);
    this.updateCapabilityValue('measure_wallbox_solarshare', state.solarPowerW ?? 0);
  }

  private updateCapabilityValue(capability: string, value: any) {
    if (this.hasCapability(capability)) {
      this.setCapabilityValue(capability, value).catch(this.error);
    }
  }

  onDeleted() {
    this.log('WallboxDevice has been deleted');
  }
}

module.exports = WallboxDevice;