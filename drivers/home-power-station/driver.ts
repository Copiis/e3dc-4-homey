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
    this.registerConnectionHandlers(session, () => this.settings);
    session.setHandler('list_devices', async () => this.onPairListDevices());
    return Promise.resolve();
  }

  onRepair(session: PairSession, device: Homey.Device): Promise<void> {
    const repairSettings: PowerStationConfig = {
      ...(device.getSettings() as PowerStationConfig),
    };
    this.registerConnectionHandlers(session, () => repairSettings);
    session.setHandler('done', async () => {
      repairSettings.stationPort = parseInt(repairSettings.stationPort.toString());
      if (repairSettings.timeout == undefined) {
        repairSettings.timeout = 5;
      }
      await device.setSettings(repairSettings);
      if (!device.getAvailable()) {
        await device.setAvailable();
      }
      return true;
    });
    return Promise.resolve();
  }

  private registerConnectionHandlers(session: PairSession, getSettings: () => PowerStationConfig) {
    session.setHandler('settingsChanged', async (data: PowerStationConfig) => {
      return await this.onSettingsChanged(data, getSettings);
    });

    session.setHandler('checkConnection', async (data: PowerStationConfig) => {
      return await this.onCheckConnection(data, getSettings);
    });

    session.setHandler('getSettings', async () => getSettings());
  }

  async onCheckConnection(data: PowerStationConfig, settingsTarget?: { (): PowerStationConfig }) {
    return new Promise<string>(async (resolve, reject) => {
      this.settings = data
      if (settingsTarget) {
        Object.assign(settingsTarget(), data);
      }
      const validationError = this.validateSettings()
      if (validationError) {
        resolve(validationError)
      }
      else {
        if (this.settings.timeout == undefined) {
          this.settings.timeout = 5
        }
        const easyRscpConnectionData: E3dcConnectionData = {
          address: this.settings.stationAddress,
          port: this.settings.stationPort,
          portalUser: this.settings.portalUsername,
          portalPassword: this.settings.portalPassword,
          rscpPassword: this.settings.rscpKey,
          connectionTimeoutMillis: this.settings.timeout * 1000,
          readTimeoutMillis: this.settings.timeout * 1000
        }

        const api = new RscpApi()
        api.init(easyRscpConnectionData, this)
        api.readLiveData(true, this)
            .then(e => resolve(this.homey.__('setup.connection-test.success')))
            .catch(e => {
              resolve(this.homey.__('setup.connection-test.failed-detail', {detail: formatError(e)}))
            })
      }
    })
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
    if (this.settings.timeout == null || this.settings.timeout < 5 || this.settings.stationPort > 30) {
      return this.homey.__('setup.validation.required', {input: this.homey.__('setup.field.timeout.title')})
    }
    return undefined
  }

  async onPairListDevices() {
    this.settings.stationPort = parseInt(this.settings.stationPort.toString())
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
  }

}

module.exports = HomePowerStationDriver;
