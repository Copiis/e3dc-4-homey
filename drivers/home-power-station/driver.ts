import Homey from 'homey';
import {PowerStationConfig} from '../../src/model/power-station.config';
import PairSession from 'homey/lib/PairSession';
import {
  E3dcConnectionData,
} from 'easy-rscp';
import {RscpApi} from '../../src/rscp-api';
import {pooledSessionKey} from '../../src/rscp-connection-pool';
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

      let connectionVerified = false;
      this.registerConnectionHandlers(session, () => repairSettings, {
        onSettingsChanged: () => {
          connectionVerified = false;
        },
        onConnectionChecked: (result: string) => {
          connectionVerified = result === this.homey.__('setup.connection-test.success');
        },
      });

      // Persist credentials when the user finishes the repair wizard.
      // Homey does not auto-emit "done" for the system done template — save on
      // showView("done") and as a fallback when the session disconnects after connect.
      let saved = false;
      const saveRepairSettings = async (reason: string) => {
        if (saved) {
          return true;
        }
        const validationError = this.validateSettings(repairSettings);
        if (validationError || !connectionVerified) {
          const message = validationError
            ?? this.homey.__('setup.connection-test.failed');
          this.error(`Repair save (${reason}) rejected: ` + message);
          throw new Error(message);
        }
        if (repairSettings.timeout == undefined || Number.isNaN(Number(repairSettings.timeout))) {
          repairSettings.timeout = 5;
        } else {
          repairSettings.timeout = parseInt(String(repairSettings.timeout), 10);
        }
        const previous = device.getSettings() as PowerStationConfig;
        await device.setSettings(repairSettings);
        const oldKey = pooledSessionKey(previous.stationAddress, previous.stationPort);
        const newKey = pooledSessionKey(repairSettings.stationAddress, repairSettings.stationPort);
        RscpApi.dropPooledSession(oldKey, this);
        if (newKey && newKey !== oldKey) {
          RscpApi.dropPooledSession(newKey, this);
        }

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

  private registerConnectionHandlers(
    session: PairSession,
    getSettings: () => PowerStationConfig,
    hooks?: {
      onSettingsChanged?: () => void;
      onConnectionChecked?: (result: string) => void;
    },
  ) {
    // Wrap every handler so one bad emit doesn't kill the entire pair/repair flow
    session.setHandler('settingsChanged', async (data: PowerStationConfig) => {
      try {
        hooks?.onSettingsChanged?.();
        return await this.onSettingsChanged(data, getSettings);
      } catch (e) {
        this.error('settingsChanged handler error: ' + formatError(e));
        return true; // don't break the UI
      }
    });

    session.setHandler('checkConnection', async (data: PowerStationConfig) => {
      try {
        const result = await this.onCheckConnection(data, getSettings);
        hooks?.onConnectionChecked?.(result);
        return result;
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
      let api: RscpApi | undefined;
      let result = 'Unexpected error during connection test';
      try {
        this.settings = data;
        if (settingsTarget) {
          Object.assign(settingsTarget(), data);
        }

        const validationError = this.validateSettings(this.settings);
        if (settingsTarget) {
          settingsTarget().stationPort = this.settings.stationPort;
        }
        if (validationError) {
          result = validationError;
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

        const key = pooledSessionKey(this.settings.stationAddress, this.settings.stationPort);
        RscpApi.dropPooledSession(key, this);
        api = new RscpApi();
        api.init(easyRscpConnectionData, this);

        // More defensive: don't let a bad connection crash the whole pair flow
        try {
          await api.readLiveData(true, this);
          result = this.homey.__('setup.connection-test.success');
        } catch (e) {
          result = this.homey.__('setup.connection-test.failed-detail', { detail: formatError(e) });
        }
      } catch (e) {
        this.error('onCheckConnection crashed: ' + formatError(e));
        result = 'Unexpected error during connection test: ' + formatError(e);
      } finally {
        if (api) {
          await api.closeOwnConnection(this).catch(reason => {
            this.log('onCheckConnection: closing test connection failed: ' + formatError(reason));
          });
        }
      }
      resolve(result);
    });
  }

  async onSettingsChanged(data: PowerStationConfig, settingsTarget?: { (): PowerStationConfig }) {
    this.settings = data
    if (settingsTarget) {
      Object.assign(settingsTarget(), data);
    }
    return true
  }

  private validateSettings(target?: PowerStationConfig): string | undefined {
    const settings = target ?? this.settings
    if (settings.portalUsername === null || settings.portalUsername.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.portal-username.title')})
    }
    if (settings.portalPassword === null || settings.portalPassword.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.portal-password.title')})
    }
    if (settings.rscpKey === null || settings.rscpKey.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.rscp-key.title')})
    }
    if (settings.stationAddress === null || settings.stationAddress.trim() === '') {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.station-address.title')})
    }
    const port = this.parseStationPort(settings.stationPort)
    if (port === undefined) {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.station-port.title')})
    }
    settings.stationPort = port
    if (settings === this.settings) {
      this.settings.stationPort = port
    }
    if (settings.timeout == null || settings.timeout < 5 || settings.timeout > 30) {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.timeout.title')})
    }
    return undefined
  }

  /** Integer TCP port 1..65535. Empty, NaN and text such as "abc" are rejected. */
  private parseStationPort(value: unknown): number | undefined {
    if (value === null || value === undefined) {
      return undefined
    }
    const text = String(value).trim()
    if (!/^\d+$/.test(text)) {
      return undefined
    }
    const port = parseInt(text, 10)
    if (!Number.isFinite(port) || !Number.isInteger(port) || port < 1 || port > 65535) {
      return undefined
    }
    return port
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
