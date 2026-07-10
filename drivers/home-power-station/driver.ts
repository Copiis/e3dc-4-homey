import Homey from 'homey';
import {PowerStationConfig} from '../../src/model/power-station.config';
import PairSession from 'homey/lib/PairSession';
import {
  E3dcConnectionData,
} from 'easy-rscp';
import {RscpApi} from '../../src/rscp-api';
import {formatError} from '../../src/utils/error-utils';

class HomePowerStationDriver extends Homey.Driver {

  private settings: PowerStationConfig = {
    portalUsername: '',
    portalPassword: '',
    rscpKey: '',
    stationAddress: '',
    stationPort: 5033,
    timeout: 5,
    batteryInfo: '',
    rscpCapacity: '0',
    rscpAsoc: '0',
    rscpSoh: '—',
  }

  async onInit() {
    this.log('HomePowerStationDriver has been initialized');
    this.setupEmsTriggerCards();
  }

  private setupEmsTriggerCards() {
    const pvSurplusCard = this.homey.flow.getDeviceTriggerCard('pv_surplus_exceeds');
    pvSurplusCard.registerRunListener(async (args: { threshold: number }, state: { surplus: number, previousSurplus: number }) => {
      return state.surplus >= args.threshold && state.previousSurplus < args.threshold;
    });

    const socBelowCard = this.homey.flow.getDeviceTriggerCard('battery_soc_below');
    socBelowCard.registerRunListener(async (args: { percent: number }, state: { soc: number, previousSoc: number }) => {
      return state.soc < args.percent && state.previousSoc >= args.percent;
    });
  }

  onPair(session: PairSession): Promise<void> {
    try {
      this.registerConnectionHandlers(session, () => this.settings);
      session.setHandler('list_devices', async () => {
        try {
          return await this.onPairListDevices();
        } catch (e) {
          this.error('onPair list_devices failed: ' + formatError(e));
          // Return empty list instead of crashing the flow
          return [];
        }
      });
    } catch (e) {
      this.error('onPair setup failed: ' + formatError(e));
    }
    return Promise.resolve();
  }

  onRepair(session: PairSession, device: Homey.Device): Promise<void> {
    try {
      const repairSettings: PowerStationConfig = {
        ...(device.getSettings() as PowerStationConfig),
      };

      this.registerConnectionHandlers(session, () => repairSettings);

      session.setHandler('done', async () => {
        try {
          repairSettings.stationPort = parseInt(repairSettings.stationPort.toString());
          if (repairSettings.timeout == undefined) {
            repairSettings.timeout = 5;
          }
          await device.setSettings(repairSettings);

          // Try to recover the device even if it was in bad state
          if (!device.getAvailable()) {
            await device.setAvailable().catch(() => {});
          }

          // Force a sync after repair so data comes back quickly
          if (typeof (device as any).sync === 'function') {
            (device as any).sync().catch(() => {});
          }

          this.log('Repair completed successfully for device ' + device.getName());
          return true;
        } catch (e) {
          this.error('Repair "done" handler failed: ' + formatError(e));
          // Still try to mark available
          await device.setAvailable().catch(() => {});
          return true; // don't let the flow crash
        }
      });
    } catch (e) {
      this.error('onRepair setup failed: ' + formatError(e));
    }
    return Promise.resolve();
  }

  private registerConnectionHandlers(session: PairSession, getSettings: () => PowerStationConfig) {
    // Wrap every handler so one bad emit doesn't kill the entire pair/repair flow
    session.setHandler('settingsChanged', async (data: PowerStationConfig) => {
      try {
        return await this.onSettingsChanged(data, getSettings);
      } catch (e) {
        this.error('settingsChanged handler error: ' + formatError(e));
        return true; // don't break the UI
      }
    });

    session.setHandler('checkConnection', async (data: PowerStationConfig) => {
      try {
        return await this.onCheckConnection(data, getSettings);
      } catch (e) {
        this.error('checkConnection handler error: ' + formatError(e));
        return 'Unexpected error during connection check';
      }
    });

    session.setHandler('getSettings', async () => {
      try {
        return getSettings();
      } catch (e) {
        this.error('getSettings handler error: ' + formatError(e));
        return {};
      }
    });
  }

  async onCheckConnection(data: PowerStationConfig, settingsTarget?: { (): PowerStationConfig }) {
    return new Promise<string>(async (resolve) => {
      try {
        this.settings = data;
        if (settingsTarget) {
          Object.assign(settingsTarget(), data);
        }

        const validationError = this.validateSettings();
        if (validationError) {
          resolve(validationError);
          return;
        }

        if (this.settings.timeout == undefined) {
          this.settings.timeout = 5;
        }

        const easyRscpConnectionData: E3dcConnectionData = {
          address: this.settings.stationAddress,
          port: this.settings.stationPort,
          portalUser: this.settings.portalUsername,
          portalPassword: this.settings.portalPassword,
          rscpPassword: this.settings.rscpKey,
          connectionTimeoutMillis: this.settings.timeout * 1000,
          readTimeoutMillis: this.settings.timeout * 1000
        };

        const api = new RscpApi();
        api.init(easyRscpConnectionData, this);

        // More defensive: don't let a bad connection crash the whole pair flow
        try {
          await api.readLiveData(true, this);
          resolve(this.homey.__('setup.connection-test.success'));
        } catch (e) {
          resolve(this.homey.__('setup.connection-test.failed-detail', { detail: formatError(e) }));
        }
      } catch (e) {
        this.error('onCheckConnection crashed: ' + formatError(e));
        resolve('Unexpected error during connection test: ' + formatError(e));
      }
    });
  }

  async onSettingsChanged(data: PowerStationConfig, settingsTarget?: { (): PowerStationConfig }) {
    this.settings = data
    if (settingsTarget) {
      Object.assign(settingsTarget(), data);
    }
    return true
  }

  private validateSettings(): string | undefined {
    if (this.settings.portalUsername === null || this.settings.portalUsername.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.portal-username.title')})
    }
    if (this.settings.portalPassword === null || this.settings.portalPassword.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.portal-password.title')})
    }
    if (this.settings.rscpKey === null || this.settings.rscpKey.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.rscp-key.title')})
    }
    if (this.settings.stationAddress === null || this.settings.stationAddress.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.station-address.title')})
    }
    if (this.settings.stationPort == null || this.settings.stationPort < 0 || this.settings.stationPort > 65535) {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.station-port.title')})
    }
    if (this.settings.timeout == null || this.settings.timeout < 5 || this.settings.timeout > 30) {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.timeout.title')})
    }
    return undefined
  }

  async onPairListDevices() {
    try {
      this.settings.stationPort = parseInt(this.settings.stationPort.toString());
      return [
        {
          name: 'HPS - ' + this.settings.stationAddress,
          data: {
            id: 'rscp-device-' + this.settings.stationAddress + '-' + Date.now(),
          },
          store: {
            settings: this.settings
          },
        },
      ];
    } catch (e) {
      this.error('onPairListDevices failed: ' + formatError(e));
      // Return something so the flow doesn't completely die
      return [];
    }
  }

}

module.exports = HomePowerStationDriver;
