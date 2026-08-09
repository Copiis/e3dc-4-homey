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

      // Persist credentials when the user finishes the repair wizard.
      // Homey does not auto-emit "done" for the system done template — save on
      // showView("done") and as a fallback when the session disconnects after connect.
      let saved = false;
      const saveRepairSettings = async (reason: string) => {
        if (saved) {
          return true;
        }
        try {
          repairSettings.stationPort = parseInt(String(repairSettings.stationPort), 10);
          if (repairSettings.timeout == undefined || Number.isNaN(Number(repairSettings.timeout))) {
            repairSettings.timeout = 5;
          } else {
            repairSettings.timeout = parseInt(String(repairSettings.timeout), 10);
          }
          await device.setSettings(repairSettings);

          if (!device.getAvailable()) {
            await device.setAvailable().catch(() => {});
          }

          // Force a sync after repair so data comes back quickly
          const maybeSync = (device as Homey.Device & { sync?: () => Promise<void> }).sync;
          if (typeof maybeSync === 'function') {
            maybeSync.call(device).catch(() => {});
          }

          saved = true;
          this.log(`Repair completed (${reason}) for device ${device.getName()}`);
          return true;
        } catch (e) {
          this.error(`Repair save (${reason}) failed: ` + formatError(e));
          await device.setAvailable().catch(() => {});
          return true; // don't let the flow crash
        }
      };

      session.setHandler('showView', async (viewId: string) => {
        if (viewId === 'done') {
          await saveRepairSettings('showView:done');
        }
      });

      // Some Homey clients emit "done" explicitly; keep as secondary path.
      session.setHandler('done', async () => saveRepairSettings('done'));
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
