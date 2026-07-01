import Homey, {FlowCardTriggerDevice, SimpleClass} from 'homey';
import {PowerStationConfig} from '../../src/model/power-station.config';
import {
  BatteryUnit,
  ChargingConfiguration,
  E3dcConnectionData,
  EmergencyPowerState,
  ManualChargeState
} from 'easy-rscp';
import {RscpApi} from '../../src/rscp-api';
import {HomePowerStation} from '../../src/model/home-power-station';
import {updateCapabilityValue} from '../../src/utils/capability-utils';
import {SetMaxChargingPowerActionCard} from '../../src/cards/action/set-max-charging-power.action.card';
import {clearTimeout} from 'node:timers';
import {
  RemoveMaxChargingPowerLimitActionCard
} from '../../src/cards/action/remove-max-charging-power-limit.action.card';
import {SetPowerLimitsToDefaultActionCard} from '../../src/cards/action/set-power-limits-to-default.action.card';
import {SetMaxDischargingPowerActionCard} from '../../src/cards/action/set-max-discharging-power.action.card';
import {
  RemoveMaxDischargingPowerLimitActionCard
} from '../../src/cards/action/remove-max-discharging-power-limit.action.card';
import {
  ProvideChargingConfigurationActionCard
} from '../../src/cards/action/provide-charging-configuration.action.card';
import {
  IsMaxChargingLimitGreaterThanConditionCard
} from '../../src/cards/condition/is-max-charging-limit-greater-than.condition.card';
import {
  IsMaxDischargingLimitGreaterThanConditionCard
} from '../../src/cards/condition/is-max-discharging-limit-greater-than.condition.card';
import {
  IsMaxChargingLimitActiveConditionCard
} from '../../src/cards/condition/is-max-charging-limit-active.condition.card';
import {
  IsMaxDischargingLimitActiveConditionCard
} from '../../src/cards/condition/is-max-discharging-limit-active.condition.card';
import {IsAnyPowerLimitActiveConditionCard} from '../../src/cards/condition/is-any-power-limit-active.condition.card';
import {SimpleValueChangedTrigger} from '../../src/cards/trigger/simple-value-changed.trigger';
import {ActivatePowerLimitsActionCard} from '../../src/cards/action/activate-power-limits.action.card';
import {ValueChanged} from '../../src/model/value-changed';
import {DeactivatePowerLimitsActionCard} from '../../src/cards/action/deactivate-power-limits.action.card';
import {BatteryModuleConfig} from '../../src/model/battery-module.config';
import {BatteryModule} from '../../src/model/battery-module';
import {TriggerCard} from '../../src/cards/trigger-card';
import {ManualBatteryChargingStartedTrigger} from '../../src/cards/trigger/manual-battery-charging-started.trigger';
import {ManualBatteryChargingStoppedTrigger} from '../../src/cards/trigger/manual-battery-charging-stopped.trigger';
import {IsManualChargeActiveConditionCard} from '../../src/cards/condition/is-manual-charge-active.condition.card';
import {LiveData} from '../../src/model/live-data';
import {StopManualBatteryChargeActionCard} from '../../src/cards/action/stop-manual-battery-charge.action.card';
import {
  StartManualBatteryChargeActionPercentageCard,
  StartManualBatteryChargeWhActionCard
} from '../../src/cards/action/start-manual-battery-charge.action.card';
import {ConfigureEmergencyReserveActionCard} from '../../src/cards/action/configure-emergency-reserve.action.card';
import {RemoveEmergencyReserveActionCard} from '../../src/cards/action/remove-emergency-reserve.action.card';
import {IslandModeStartedTrigger} from '../../src/cards/trigger/island-mode-started.trigger';
import {IslandModeStoppedTrigger} from '../../src/cards/trigger/island-mode-stopped.trigger';
import {
  IsEmergencyPowerReserveGreaterThanConditionCard
} from '../../src/cards/condition/is-emergency-power-reserve-greater-than.condition.card';
import {IsIslandModeActiveConditionCard} from '../../src/cards/condition/is-island-mode-active.condition.card';
import {IsIslandModePossibleConditionCard} from '../../src/cards/condition/is-island-mode-possible.condition.card';
import {WallboxConfig} from '../../src/model/wallbox.config';
import {Wallbox} from '../../src/model/wallbox';
import {GridMeterConfig} from '../../src/model/grid-meter.config';
import {GridMeter} from '../../src/model/grid-meter';
import {formatError} from '../../src/utils/error-utils';
import {formatSohPercent, resolveUsableCapacityWh} from '../../src/utils/battery-capacity';
import {BatteryData} from '../../src/model/battery-data';
import {
  DeviceDiagnostic,
  DiagnosticSnapshot,
  parseAnalysisLogFromStore,
  serializeAnalysisLog,
} from '../../src/utils/device-diagnostic';
import {ExportDiagnosticReportActionCard} from '../../src/cards/action/export-diagnostic-report.action.card';
import {EnergyMeterIntegrator} from '../../src/utils/energy-meter-integrator';
import {ensureCapabilities} from '../../src/utils/energy-capability-migration';
import {HKW_CAPABILITY_ORDER, reorderCapabilitiesIfNeeded} from '../../src/utils/capability-order';
import {
  SetPowerModeAutoActionCard,
  SetPowerModeChargeActionCard,
  SetPowerModeDischargeActionCard,
  SetPowerModeGridChargeActionCard,
  SetPowerModeIdleActionCard,
  POWER_MODE_AUTO,
} from '../../src/cards/action/set-power-mode.action.card';
import {PowerModeState} from '../../src/model/home-power-station';
import {calculatePvSurplusW} from '../../src/utils/pv-surplus';
import {buildPowerStateFromLiveData, publishPlantPowerStateFromStation, setPlantPowerState} from '../../src/utils/plant-power-cache';


const SYNC_INTERVAL = 1000 * 20; // 20 sec
const POWER_MODE_REFRESH_INTERVAL = 1000 * 10; // 10 sec
const MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE = 5
const DIAGNOSTIC_ANALYSIS_STORE_KEY = 'diagnosticAnalysisLog'
class HomePowerStationDevice extends Homey.Device implements HomePowerStation{
  private firmwareChangedTrigger: SimpleValueChangedTrigger<string> | null = null
  private maxChargingLimitHasChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private maxDischargingLimitHasChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private emergencyPowerReserveChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private houseConsumptionHasChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private batteryPowerHasChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private gridPowerHasChangedTrigger: SimpleValueChangedTrigger<number> | null = null
  private manualBatteryChargingStartedTrigger: TriggerCard<undefined> | null = null
  private manualBatteryChargingStoppedTrigger: TriggerCard<number> | null = null
  private islandModeStartedTrigger: TriggerCard<undefined> | null = null
  private islandModeStoppedTrigger: TriggerCard<undefined> | null = null

  private currentChargingConfig: ChargingConfiguration | null = null
  private currentManualChargeState: ManualChargeState | null = null
  private currentEmergencyPowerState: EmergencyPowerState | null = null

  private loopId: NodeJS.Timeout |null = null
  private powerModeState: PowerModeState | null = null
  private powerModeLoopId: NodeJS.Timeout | null = null
  private api: RscpApi | undefined = undefined
  private syncErrorCount: number = 0
  private updateBatteryData = true
  private readonly diagnostic = new DeviceDiagnostic()
  private lastSyncAt?: Date
  private lastSyncResult?: 'ok' | 'error'
  private lastSnapshot: Partial<DiagnosticSnapshot> = {}
  private readonly energyMeter = new EnergyMeterIntegrator(this)
  private lastPvSurplusW = 0
  async onInit() {
    this.log('HomePowerStationDevice has been initialized');

    const initialStoredSettings: PowerStationConfig | undefined = this.getStoreValue('settings')
    if (initialStoredSettings) {
      initialStoredSettings.stationPort = parseInt(initialStoredSettings.stationPort.toString())
      let configuredTimeout = 5
      if (initialStoredSettings.timeout) {
        configuredTimeout = parseInt(initialStoredSettings.timeout.toString())
      }
      initialStoredSettings.timeout = configuredTimeout
      this.log('Migrating store to settings')
      this.setSettings(initialStoredSettings)
          .then(value => {
            this.unsetStoreValue('settings').then()
            this.log('Starting process')
            this.doInit()
          })
    }
    else {
      this.log('Starting process without migration')
      this.doInit()
    }
  }

  private async migrateLegacyCapabilities(): Promise<void> {
    await ensureCapabilities(this, ['meter_power'])
    const legacyCapabilities = ['measure_pv_delivery']
    for (const capability of legacyCapabilities) {
      if (!this.hasCapability(capability)) {
        continue
      }
      try {
        await this.removeCapability(capability)
        this.log(`Removed legacy capability ${capability}`)
      } catch (e) {
        this.error(`Failed to remove legacy capability ${capability}: ${formatError(e)}`)
      }
    }
    await reorderCapabilitiesIfNeeded(this, HKW_CAPABILITY_ORDER)
  }

  private doInit() {
    this.migrateLegacyCapabilities().then()
    this.loadDiagnosticAnalysisLog()

    this.setupActionCards()
    this.setupConditionCards()
    this.setupTriggerCards()
    this.publishDiagnosticReport().catch(reason => {
      this.error('Initial diagnostic report failed: ' + formatError(reason))
    })

    publishPlantPowerStateFromStation(this)
    setTimeout(() => {
      this.autoSync()
    }, 2000)
  }

  getCurrentSOC(): number {
    const number = this.getCapabilityValue('measure_battery')
    if (number) {
      return number / 100.0;
    }
    return  0.0
  }

  getManualChargeState(): ManualChargeState | null {
    return this.currentManualChargeState;
  }

  getEmergencyPowerState(): EmergencyPowerState | null {
    return this.currentEmergencyPowerState;
  }

  setPowerModeState(state: PowerModeState | null): void {
    this.powerModeState = state
    if (this.powerModeLoopId) {
      clearTimeout(this.powerModeLoopId)
      this.powerModeLoopId = null
    }
    if (state !== null) {
      this.schedulePowerModeRefresh()
    }
  }

  private schedulePowerModeRefresh() {
    this.powerModeLoopId = this.homey.setTimeout(() => this.refreshPowerMode(), POWER_MODE_REFRESH_INTERVAL)
  }

  private refreshPowerMode() {
    this.powerModeLoopId = null
    const state = this.powerModeState
    if (!state) {
      return
    }
    if (Date.now() >= state.expiresAt) {
      this.log('Power mode expired, reverting to auto')
      this.powerModeState = null
      this.getApi()
          .setPowerMode(POWER_MODE_AUTO, 0, true, this)
          .catch(e => this.error('Power mode auto revert failed: ' + formatError(e)))
      return
    }
    this.getApi()
        .setPowerMode(state.mode, state.powerW, true, this)
        .catch(e => this.error('Power mode refresh failed: ' + formatError(e)))
    this.schedulePowerModeRefresh()
  }


  private setupTriggerCards() {
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
    ]
    steps.forEach(step => {
      try {
        step.run()
      } catch (e) {
        this.error(`Trigger card setup failed (${step.name}): ${formatError(e)}`)
      }
    })
  }

  private setupIslandModeCards() {
    let card = this.homey.flow.getDeviceTriggerCard('island_mode_started')
    this.islandModeStartedTrigger = new IslandModeStartedTrigger(this, card, this)

    card = this.homey.flow.getDeviceTriggerCard('island_mode_stopped')
    this.islandModeStoppedTrigger = new IslandModeStoppedTrigger(this, card, this)
  }


  private setupManualBatteryChargingStoppedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('manual_battery_charging_stopped')
    this.manualBatteryChargingStoppedTrigger = new ManualBatteryChargingStoppedTrigger(this, card, this)
  }

  private setupManualBatteryChargingStartedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('manual_battery_charging_started')
    this.manualBatteryChargingStartedTrigger = new ManualBatteryChargingStartedTrigger(this, card, this)
  }

  private setupFirmwareChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('firmware_has_changed')
    this.firmwareChangedTrigger = new SimpleValueChangedTrigger<string>('Firmware', this, card, this)
  }

  private setupMaxChargingLimitChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('max_charging_limit_has_changed')
    this.maxChargingLimitHasChangedTrigger = new SimpleValueChangedTrigger<number>('Charging limit', this, card, this)
  }

  private setupMaxDischargingLimitChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('max_discharging_limit_has_changed')
    this.maxDischargingLimitHasChangedTrigger = new SimpleValueChangedTrigger<number>('Discharging limit', this, card, this)
  }

  private setupEmergencyPowerReserveChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('emergency_power_reserve_has_changed')
    this.emergencyPowerReserveChangedTrigger = new SimpleValueChangedTrigger<number>('Emergency power reserve', this, card, this)
  }

  private setupHouseConsumptionChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('house_consumption_has_changed')
    this.houseConsumptionHasChangedTrigger = new SimpleValueChangedTrigger<number>('House consumption', this, card, this)
  }

  private setupBatteryPowerChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('battery_power_has_changed')
    this.batteryPowerHasChangedTrigger = new SimpleValueChangedTrigger<number>('Battery power', this, card, this)
  }

  private setupGridPowerChangedCard() {
    const card = this.homey.flow.getDeviceTriggerCard('grid_power_has_changed')
    this.gridPowerHasChangedTrigger = new SimpleValueChangedTrigger<number>('Grid power', this, card, this)
  }

  private setupConditionCards() {
    this.setupIsMaxChargingPowerGreaterThan()
    this.setupIsMaxDischargingPowerGreaterThan()
    this.setupIsMaxChargingPowerLimitActive()
    this.setupIsMaxDischargingPowerLimitActive()
    this.setupIsAnyPowerLimitActive()
    this.setupIsManualChargeActive()
    this.setupEmergencyPowerConditionCards()
  }

  private setupEmergencyPowerConditionCards() {
    let card = this.homey.flow.getConditionCard('is_emergency_power_reserve_greater_than')
    card.registerRunListener(new IsEmergencyPowerReserveGreaterThanConditionCard().run)

    card = this.homey.flow.getConditionCard('is_island_mode_active')
    card.registerRunListener(new IsIslandModeActiveConditionCard().run)

    card = this.homey.flow.getConditionCard('is_island_mode_possible')
    card.registerRunListener(new IsIslandModePossibleConditionCard().run)
  }

  private setupIsManualChargeActive() {
    const card = this.homey.flow.getConditionCard('is_manual_charge_active')
    card.registerRunListener(new IsManualChargeActiveConditionCard().run)
  }

  private setupIsMaxChargingPowerGreaterThan() {
    const card = this.homey.flow.getConditionCard('is_max_charging_limit_greater_than')
    card.registerRunListener(new IsMaxChargingLimitGreaterThanConditionCard().run)
  }

  private setupIsMaxDischargingPowerGreaterThan() {
    const card = this.homey.flow.getConditionCard('is_max_discharging_limit_greater_than')
    card.registerRunListener(new IsMaxDischargingLimitGreaterThanConditionCard().run)
  }

  private setupIsMaxChargingPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_max_charging_limit_active')
    card.registerRunListener(new IsMaxChargingLimitActiveConditionCard().run)
  }

  private setupIsMaxDischargingPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_max_discharging_limit_active')
    card.registerRunListener(new IsMaxDischargingLimitActiveConditionCard().run)
  }

  private setupIsAnyPowerLimitActive() {
    const card = this.homey.flow.getConditionCard('is_any_power_limit_active')
    card.registerRunListener(new IsAnyPowerLimitActiveConditionCard().run)
  }

  private setupActionCards() {
    this.setupConfigureMaxChargingLimitActionCard()
    this.setupRemoveMaxChargingLimitActionCard()
    this.setupConfigureMaxDischargingLimitActionCard()
    this.setupRemoveMaxDischargingLimitActionCard()
    this.setupRemoveAllLimitsActionCard()
    this.setupReadChargingConfiguration()
    this.setupActivatePowerLimitsCard()
    this.setupDeactivatePowerLimitsCard()
    this.setupStartManualChargeCards()
    this.setupStopManualChargeCards()
    this.setupConfigureEmergencyPowerReserve()
    this.setupRemoveEmergencyPowerReserve()
    this.setupExportDiagnosticReportCard()
    this.setupPowerModeActionCards()
  }

  private setupExportDiagnosticReportCard() {
    const card = this.homey.flow.getActionCard('export_diagnostic_report')
    card.registerRunListener(new ExportDiagnosticReportActionCard().run)
  }

  private setupPowerModeActionCards() {
    this.homey.flow.getActionCard('set_power_mode_auto').registerRunListener(new SetPowerModeAutoActionCard().run)
    this.homey.flow.getActionCard('set_power_mode_idle').registerRunListener(new SetPowerModeIdleActionCard().run)
    this.homey.flow.getActionCard('set_power_mode_charge').registerRunListener(new SetPowerModeChargeActionCard().run)
    this.homey.flow.getActionCard('set_power_mode_discharge').registerRunListener(new SetPowerModeDischargeActionCard().run)
    this.homey.flow.getActionCard('set_power_mode_grid_charge').registerRunListener(new SetPowerModeGridChargeActionCard().run)
  }

  private setupRemoveEmergencyPowerReserve() {
    const card = this.homey.flow.getActionCard('remove_emergency_reserve')
    card.registerRunListener(new RemoveEmergencyReserveActionCard().run)
  }

  private setupConfigureEmergencyPowerReserve() {
    const card = this.homey.flow.getActionCard('configure_emergency_reserve')
    card.registerRunListener(new ConfigureEmergencyReserveActionCard().run)
  }

  private setupStopManualChargeCards() {
    const card = this.homey.flow.getActionCard('stop_manual_battery_charging')
    card.registerRunListener(new StopManualBatteryChargeActionCard().run)
  }

  private setupStartManualChargeCards() {
    const card = this.homey.flow.getActionCard('start_manual_battery_charging_amount')
    card.registerRunListener(new StartManualBatteryChargeWhActionCard().run)

    const cardPercemtage = this.homey.flow.getActionCard('start_manual_battery_charging_percentage')
    cardPercemtage.registerRunListener(new StartManualBatteryChargeActionPercentageCard().run)
  }

  private setupActivatePowerLimitsCard() {
    const card = this.homey.flow.getActionCard('activate_configured_power_limits')
    card.registerRunListener(new ActivatePowerLimitsActionCard().run)
  }

  private setupDeactivatePowerLimitsCard() {
    const card = this.homey.flow.getActionCard('deactivate_configured_power_limits')
    card.registerRunListener(new DeactivatePowerLimitsActionCard().run)
  }

  private setupConfigureMaxChargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('configure_max_charging_power')
    card.registerRunListener(new SetMaxChargingPowerActionCard().run)
  }

  private setupRemoveMaxChargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('remove_max_charging_power')
    card.registerRunListener(new RemoveMaxChargingPowerLimitActionCard().run)
  }

  private setupConfigureMaxDischargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('configure_max_discharging_power')
    card.registerRunListener(new SetMaxDischargingPowerActionCard().run)
  }

  private setupRemoveMaxDischargingLimitActionCard() {
    const card = this.homey.flow.getActionCard('remove_max_discharging_power')
    card.registerRunListener(new RemoveMaxDischargingPowerLimitActionCard().run)
  }

  private setupRemoveAllLimitsActionCard() {
    const card = this.homey.flow.getActionCard('remove_all_power_limits')
    card.registerRunListener(new SetPowerLimitsToDefaultActionCard().run)
  }

  private setupReadChargingConfiguration() {
    const card = this.homey.flow.getActionCard('provide_charging_configuration')
    card.registerRunListener(new ProvideChargingConfigurationActionCard().run)
  }

  asSimple(): SimpleClass {
    return this;
  }

  validateUnit(value: number, unit: CardUnit): string | undefined {
    if (unit == CardUnit.PERCENTAGE && value > 100) {
      return this.homey.__('messages.invalid-percentage')
    }
    if (value < 0) {
      return this.homey.__('messages.to-low-limit')
    }

    return undefined
  }

  private autoSync() {
    this.log('Auto sync ...')
    this.sync()
        .then(() => {
          this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL)
        })
        .catch(reason => {
          const message = formatError(reason)
          this.error('Auto sync failed: ' + message)
          this.recordAnalysisEvent('error', 'Auto-Sync: ' + message)
          this.loopId = setTimeout(() => this.autoSync(), SYNC_INTERVAL)
        })
  }

  private publishWidgetPowerCache(result: LiveData): void {
    const stationId = String(this.getData().id);
    let wallboxPower = 0;
    let wallboxSolarShare = 0;
    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices();
    wallboxDevices.forEach(device => {
      const config = device.getStoreValue('settings') as { stationId?: string } | undefined;
      if (String(config?.stationId) !== stationId) {
        return;
      }
      if (device.hasCapability('measure_power')) {
        wallboxPower += Number(device.getCapabilityValue('measure_power')) || 0;
      }
      if (device.hasCapability('measure_wallbox_solarshare')) {
        wallboxSolarShare += Number(device.getCapabilityValue('measure_wallbox_solarshare')) || 0;
      }
    });
    setPlantPowerState(stationId, buildPowerStateFromLiveData(result, wallboxPower, wallboxSolarShare));
  }

  getId(): string {
    return this.getData().id;
  }

  public getBatteryCapacity(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.getApi()
          .readBatteryData(true, this)
          .then(value => {
            resolve(resolveUsableCapacityWh(value[0]))
          })
          .catch(reason => {
            this.error('getBatteryCapacity: Error reading battery data: ' + formatError(reason))
            reject(reason)
          })
    })
  }

  private updateBatteryCapacitySettings(battery: BatteryData): void {
    const storedSettings: PowerStationConfig = this.getSettings()
    const usableWh = resolveUsableCapacityWh(battery)
    const updated: PowerStationConfig = {
      ...storedSettings,
      rscpCapacity: Math.round(battery.capacity).toString(),
      rscpAsoc: Math.round(usableWh).toString(),
      rscpSoh: formatSohPercent(usableWh, battery.capacity),
    }
    this.setSettings(updated).catch(reason => {
      this.log('Failed to store battery capacity settings: ' + formatError(reason))
    })
  }

  public getApi(): RscpApi {
    if (this.api) {
      return this.api
    }
    this.api = new RscpApi()
    const storedSettings: PowerStationConfig = this.getSettings();
    let timeoutMillis = 5000
    if (storedSettings.timeout) {
      timeoutMillis = storedSettings.timeout * 1000
    }
    else {
      storedSettings.timeout = 5
      this.setSettings(storedSettings).then()
    }
    this.api.init({
      address: storedSettings.stationAddress,
      port: storedSettings.stationPort,
      portalUser: storedSettings.portalUsername,
      portalPassword: storedSettings.portalPassword,
      rscpPassword: storedSettings.rscpKey,
      connectionTimeoutMillis: timeoutMillis,
      readTimeoutMillis: timeoutMillis,
    }, this)
    return this.api
  }

  async sync() {
    return new Promise((resolve, reject) => {
      this.log('Starting sync ...')
      const station = this.getApi()

      // Only query wallbox states if there are linked wallbox devices for this station (optimization)
      const wallboxDriver = this.homey.drivers.getDriver('wallbox')
      const hasWallboxes = wallboxDriver.getDevices().some((d: any) => {
        const cfg = d.getStoreValue('settings')
        return cfg && String(cfg.stationId) === this.getId()
      })

      station
          .readLiveData(true, this, hasWallboxes)
          .then(result => {
            try {
              updateCapabilityValue('measure_power', result.pvDelivery, this)
              const generatedKwh = this.energyMeter.integrateGeneration(result.pvDelivery)
              updateCapabilityValue('meter_power', generatedKwh, this)
              const gridDeliveryChange = updateCapabilityValue('measure_grid_delivery', result.gridDelivery, this)
              const batteryDeliveryChange = updateCapabilityValue('measure_battery_delivery', result.batteryDelivery * -1, this)
              const houseConsumptionChange = updateCapabilityValue('measure_house_consumption', result.houseConsumption, this)
              this.gridPowerHasChangedTrigger?.runIfChanged(gridDeliveryChange)
              this.batteryPowerHasChangedTrigger?.runIfChanged(batteryDeliveryChange)
              this.houseConsumptionHasChangedTrigger?.runIfChanged(houseConsumptionChange)
              const batteryLevelChange = updateCapabilityValue('measure_battery', result.batteryChargingLevel * 100, this)
              this.handleEmsTriggers(result, batteryLevelChange)
              updateCapabilityValue('external_power_delivery_connected', result.externalPowerConnected, this)
              if (result.externalPowerConnected) {
                updateCapabilityValue('measure_external_power_delivery', result.externalPowerDelivery, this)
              }
              else {
                if (this.hasCapability('measure_external_power_delivery')) {
                  this.removeCapability('measure_external_power_delivery').then()
                }
              }
              this.handleChargeTimeCapability(result);
              this.handleFirmwareChange(result);
              this.handleChargingConfigurationChanges(result);
              this.handleManualChargeStateChanges(result)
              this.handleEmergencyPowerStateChanges(result)
              this.handleWallbox(result)
              this.publishWidgetPowerCache(result)
              this.updateLinkedGridMeter(result)
              this.handleAvailability();
              this.recordSyncSuccess(result)
              this.publishDiagnosticReport().catch(() => undefined)
              this.handleBatteryData(station, result, resolve);
            } catch (e) {
              this.error('Error processing live data: ' + formatError(e))
              this.recordSyncFailure('Verarbeitung Live-Daten / processing live data: ' + formatError(e))
              this.publishDiagnosticReport().catch(() => undefined)
              this.syncErrorCount++
              resolve(undefined)
            }
          })
          .catch(e => {
            this.error('Error reading live data: ' + formatError(e))
            this.recordSyncFailure('RSCP Live-Daten / live data: ' + formatError(e))
            this.publishDiagnosticReport().catch(() => undefined)
            this.syncErrorCount++
            if (this.syncErrorCount >= MAX_ALLOWED_ERROR_BEFORE_UNAVAILABLE) {
              const unavailableMessage = this.homey.__('messages.hps-not-available')
              this.recordAnalysisEvent('warn', 'HKW nicht verfügbar / unavailable: ' + unavailableMessage)
              if (this.getAvailable()) {
                this.postTimelineNotification(this.homey.__('timeline.hps-unavailable'))
              }
              this.setUnavailable(unavailableMessage).then()
            }
            resolve(undefined)
          })
    })

  }

  private handleWallbox(data: LiveData) {
    // Wallbox live data lives on dedicated wallbox devices (evcharger). Drop legacy HPS caps.
    if (this.hasCapability('measure_wallbox_consumption')) {
      this.removeCapability('measure_wallbox_consumption').then()
    }
    if (this.hasCapability('measure_wallbox_solarshare')) {
      this.removeCapability('measure_wallbox_solarshare').then()
    }

    if (data.wallboxPowerState.length === 0) {
      return
    }

    const wallboxDevices = this.homey.drivers.getDriver('wallbox').getDevices()
    const stationId = this.getId()
    const linkedWallboxes: Wallbox[] = []

    wallboxDevices.forEach(currentDevice => {
      const wallboxConfig: WallboxConfig | undefined = currentDevice.getStoreValue('settings')
      if (!wallboxConfig?.stationId) {
        this.log('Skipping wallbox device without store settings: ' + currentDevice.getName())
        return
      }
      if (wallboxConfig.stationId == stationId) {
        this.log('Updating wallbox device: ' + currentDevice.getName())
        const wallboxDevice = currentDevice as unknown as Wallbox
        const relevantData = data.wallboxPowerState.find(value => value.id == wallboxConfig.id)

        if (relevantData != undefined) {
          wallboxDevice.sync(relevantData)
          linkedWallboxes.push(wallboxDevice)
        }
        else {
          this.log('Unable to find wallbox data for wallbox with id ' + wallboxConfig.id)
        }
      }
    })

    if (linkedWallboxes.length > 0) {
      this.getApi()
        .readWallboxEmsSettings(true, this)
        .then(emsSettings => {
          linkedWallboxes.forEach(wallboxDevice => wallboxDevice.syncEmsSettings(emsSettings))
        })
        .catch(e => {
          this.log('Wallbox EMS settings read failed: ' + formatError(e))
        })
    }
  }

  private handleChargeTimeCapability(data: LiveData) {
    this.getBatteryCapacity()
        .then(capacityWh => {
          let targetWh = 0
          if (data.batteryDelivery > 0) {
            targetWh = Math.abs(capacityWh * data.batteryChargingLevel)
          } else {
            targetWh = Math.abs(capacityWh * (1-data.batteryChargingLevel))
          }

          const batteryPowerW = Math.abs(data.batteryDelivery)
          let finalValue: string
          if (batteryPowerW < 50) {
            finalValue = '—'
          } else {
            const minutes = targetWh / batteryPowerW * 60
            const batteryRemainingHours = Math.floor(minutes / 60)
            let batteryRemainingMin = Math.floor(minutes % 60)
            let hoursAsString = '' + batteryRemainingHours
            let minAsString = '' + batteryRemainingMin
            if (hoursAsString.length == 1) {
              hoursAsString = '0' + hoursAsString
            }
            if (minAsString.length == 1) {
              minAsString = '0' + minAsString
            }

            if (batteryRemainingHours > 24) {
              finalValue = '> 24h'
            }
            else if (batteryRemainingHours == 0 && batteryRemainingMin < 10) {
              finalValue = '< 10min'
            }
            else {
              finalValue = hoursAsString + ':' + minAsString
            }
          }

          updateCapabilityValue('charge_time', finalValue, this)
        })
        .catch(reason => {
          this.log('handleChargeTimeCapability: ' + formatError(reason))
        })
  }

  private handleBatteryData(station: RscpApi, result: LiveData, resolve: (value: (PromiseLike<unknown> | unknown)) => void) {
    this.updateLinkedBatteryLiveData(result)

    if (this.updateBatteryData) {
      this.log('Updating battery devices (detail)')
      this.updateBatteryData = false
      station
          .readBatteryData(true, this)
          .then(batteryData => {
            this.updateBatteryCapacitySettings(batteryData[0])

            const batteryDevices = this.homey.drivers.getDriver('battery-module').getDevices()
            const stationId = this.getId()
            batteryDevices.forEach(currentDevice => {
              const batteryConfig: BatteryModuleConfig | undefined = currentDevice.getStoreValue('settings')
              if (!batteryConfig?.stationId) {
                this.log('Skipping battery device without store settings: ' + currentDevice.getName())
                return
              }
              if (batteryConfig.stationId == stationId) {
                this.log('Updating battery device: ' + currentDevice.getName())
                const batteryDevice = currentDevice as unknown as BatteryModule
                const usableWh = resolveUsableCapacityWh(batteryData[0])
                batteryDevice.sync(
                      batteryData[0],
                      result.batteryChargingLevel * 100,
                      usableWh / 1000.0,
                      result.batteryDelivery * -1,
                      result.chargingConfig,
                      result.emergencyPowerState)

              }
            })
          })
          .catch(reason => {
            this.log('Error reading battery monitoring data: ' + formatError(reason))
          })
          .finally(() => resolve(undefined))
    } else {
      this.updateBatteryData = true
      resolve(undefined)
    }
  }

  private updateLinkedGridMeter(result: LiveData): void {
    const gridMeterDevices = this.homey.drivers.getDriver('grid-meter').getDevices()
    const stationId = this.getId()
    gridMeterDevices.forEach(currentDevice => {
      const gridConfig: GridMeterConfig | undefined = currentDevice.getStoreValue('settings')
      if (!gridConfig?.stationId) {
        return
      }
      if (gridConfig.stationId === stationId) {
        const gridMeter = currentDevice as unknown as GridMeter
        gridMeter.sync(result.gridDelivery)
      }
    })
  }

  private updateLinkedBatteryLiveData(result: LiveData) {
    const batteryDevices = this.homey.drivers.getDriver('battery-module').getDevices()
    const stationId = this.getId()
    batteryDevices.forEach(currentDevice => {
      const batteryConfig: BatteryModuleConfig | undefined = currentDevice.getStoreValue('settings')
      if (!batteryConfig?.stationId) {
        return
      }
      if (batteryConfig.stationId == stationId) {
        const batteryDevice = currentDevice as unknown as BatteryModule
        batteryDevice.syncLive(
            result.batteryChargingLevel * 100,
            result.batteryDelivery * -1,
            result.chargingConfig,
            result.emergencyPowerState)
      }
    })
  }

  private handleEmsTriggers(result: LiveData, batteryLevelChange: ValueChanged<number> | undefined) {
    const batteryPowerW = result.batteryDelivery * -1
    const surplus = calculatePvSurplusW(result.pvDelivery, result.houseConsumption, batteryPowerW)
    const previousSurplus = this.lastPvSurplusW
    this.lastPvSurplusW = surplus

    try {
      const pvSurplusCard = this.homey.flow.getDeviceTriggerCard('pv_surplus_exceeds')
      pvSurplusCard.trigger(this, { surplus }, { surplus, previousSurplus })
        .catch(reason => this.error('PV surplus trigger failed: ' + formatError(reason)))
    } catch (e) {
      this.error('PV surplus trigger card unavailable: ' + formatError(e))
    }

    if (batteryLevelChange?.oldValue != null && batteryLevelChange.newValue != null) {
      try {
        const socCard = this.homey.flow.getDeviceTriggerCard('battery_soc_below')
        socCard.trigger(this, { soc: batteryLevelChange.newValue }, {
          soc: batteryLevelChange.newValue,
          previousSoc: batteryLevelChange.oldValue,
        }).catch(reason => this.error('Battery SoC trigger failed: ' + formatError(reason)))
      } catch (e) {
        this.error('Battery SoC trigger card unavailable: ' + formatError(e))
      }
    }
  }

  private handleAvailability() {
    const wasUnavailable = !this.getAvailable()
    this.syncErrorCount = 0
    if (wasUnavailable) {
      this.recordAnalysisEvent('info', 'HKW wieder verfügbar / available again')
      this.postTimelineNotification(this.homey.__('timeline.hps-available'))
      this.setAvailable().then()
    }
  }

  private postTimelineNotification(excerpt: string): void {
    this.homey.notifications.createNotification({ excerpt })
      .catch(reason => this.error('Timeline notification failed: ' + formatError(reason)))
  }

  private handleChargingConfigurationChanges(result: LiveData) {
    if (this.currentChargingConfig) {
      this.log('Checking if charging limits have changed')
      const maxChargingLimitChange: ValueChanged<number> = {
        oldValue: this.readActiveMaxChargingLimit(this.currentChargingConfig),
        newValue: this.readActiveMaxChargingLimit(result.chargingConfig)
      }
      this.maxChargingLimitHasChangedTrigger?.runIfChanged(maxChargingLimitChange)
      const maxDischargingLimitChange: ValueChanged<number> = {
        oldValue: this.readActiveMaxDischargingLimit(this.currentChargingConfig),
        newValue: this.readActiveMaxDischargingLimit(result.chargingConfig)
      }
      this.maxDischargingLimitHasChangedTrigger?.runIfChanged(maxDischargingLimitChange)
    }
    this.currentChargingConfig = result.chargingConfig
  }

  private handleManualChargeStateChanges(result: LiveData) {
    if (this.currentManualChargeState) {
      if (this.currentManualChargeState.active && !result.manualChargeState.active) {
        this.manualBatteryChargingStoppedTrigger?.trigger(result.manualChargeState.chargedEnergyWh)
      }
      else if (!this.currentManualChargeState.active && result.manualChargeState.active) {
        this.manualBatteryChargingStartedTrigger?.trigger(undefined)
      }
    }
    this.currentManualChargeState = result.manualChargeState
  }

  private handleEmergencyPowerStateChanges(result: LiveData) {
    if (this.currentEmergencyPowerState) {
      if (this.currentEmergencyPowerState.island && !result.emergencyPowerState.island) {
        this.islandModeStoppedTrigger?.trigger(undefined)
        this.postTimelineNotification(this.homey.__('timeline.island-stopped'))
      }
      else if (!this.currentEmergencyPowerState.island && result.emergencyPowerState.island) {
        this.islandModeStartedTrigger?.trigger(undefined)
        this.postTimelineNotification(this.homey.__('timeline.island-started'))
      }

      const reserveChange: ValueChanged<number> = {
        oldValue: this.currentEmergencyPowerState.reserveWh,
        newValue: result.emergencyPowerState.reserveWh
      }
      this.emergencyPowerReserveChangedTrigger?.runIfChanged(reserveChange)
    }
    else {
      if (result.emergencyPowerState.island) {
        this.islandModeStartedTrigger?.trigger(undefined)
      }
    }
    this.currentEmergencyPowerState = result.emergencyPowerState
  }

  private handleFirmwareChange(result: LiveData) {
    const firmwareChange = updateCapabilityValue('firmware_version', result.firmwareVersion, this)

    this.firmwareChangedTrigger?.runIfChanged(firmwareChange)
    if (firmwareChange?.oldValue) {
      this.postTimelineNotification(this.homey.__('timeline.firmware-updated', {
        OLD: String(firmwareChange.oldValue),
        NEW: String(firmwareChange.newValue),
      }))
    }
  }

  private readActiveMaxChargingLimit(config: ChargingConfiguration): number {
    if (config.currentLimitations.chargingLimitationsEnabled) {
      return config.currentLimitations.maxCurrentChargingPower
    }
    return config.maxPossibleChargingPower
  }

  private readActiveMaxDischargingLimit(config: ChargingConfiguration): number {
    if (config.currentLimitations.chargingLimitationsEnabled) {
      return config.currentLimitations.maxCurrentDischargingPower
    }
    return config.maxPossibleDischargingPower
  }

  async onAdded() {
    this.log('HomePowerStationDevice has been added');
    const storedSettings: PowerStationConfig = this.getStoreValue('settings')
    await this.setSettings(storedSettings)
    await this.unsetStoreValue('settings')
  }


  async buildDiagnosticReport(): Promise<string> {
    await this.publishDiagnosticReport()
    return this.diagnostic.formatReport(this.createDiagnosticSnapshot())
  }

  private getAppVersion(): string {
    return this.homey.manifest?.version ?? 'unknown'
  }

  private createDiagnosticSnapshot(): DiagnosticSnapshot {
    const homeyVersion = (this.homey as { version?: string }).version
    return {
      appVersion: this.getAppVersion(),
      deviceName: this.getName(),
      deviceId: this.getId(),
      homeyVersion,
      available: this.getAvailable(),
      syncErrorCount: this.syncErrorCount,
      lastSyncAt: this.lastSyncAt,
      lastSyncResult: this.lastSyncResult,
      pvW: this.lastSnapshot.pvW,
      houseW: this.lastSnapshot.houseW,
      gridW: this.lastSnapshot.gridW,
      batteryPct: this.lastSnapshot.batteryPct,
      wallboxDeviceCount: this.countLinkedDevices('wallbox'),
      batteryDeviceCount: this.countLinkedDevices('battery-module'),
      gridMeterDeviceCount: this.countLinkedDevices('grid-meter'),
      firmware: this.lastSnapshot.firmware,
      wallboxSocPercent: this.lastSnapshot.wallboxSocPercent,
      wallboxPlugged: this.lastSnapshot.wallboxPlugged,
      wallboxSocRaw: this.lastSnapshot.wallboxSocRaw,
      wallboxAlgPrecharge: this.lastSnapshot.wallboxAlgPrecharge,
      wallboxAlgHex: this.lastSnapshot.wallboxAlgHex,
      wallboxChargePlanSoc: this.lastSnapshot.wallboxChargePlanSoc,
      wallboxChargePlanText: this.lastSnapshot.wallboxChargePlanText,
    }
  }

  private loadDiagnosticAnalysisLog(): void {
    const stored = this.getStoreValue(DIAGNOSTIC_ANALYSIS_STORE_KEY)
    this.diagnostic.replaceAnalysisEntries(parseAnalysisLogFromStore(stored))
  }

  private async persistDiagnosticAnalysisLog(): Promise<void> {
    const serialized = serializeAnalysisLog([...this.diagnostic.getAnalysisEntries()])
    await this.setStoreValue(DIAGNOSTIC_ANALYSIS_STORE_KEY, serialized)
  }

  private recordAnalysisEvent(level: 'info' | 'warn' | 'error', message: string): void {
    if (!this.diagnostic.recordAnalysis(level, message)) {
      return
    }
    this.persistDiagnosticAnalysisLog()
        .catch(reason => this.log('Failed to persist analysis log: ' + formatError(reason)))
    this.publishDiagnosticReport().catch(() => undefined)
  }

  private async publishDiagnosticReport(): Promise<void> {
    const report = this.diagnostic.formatReport(this.createDiagnosticSnapshot())
    updateCapabilityValue('diagnostic_report', report, this)
    await this.setSettings({ diagnosticReport: report })
  }

  private recordSyncSuccess(result: LiveData): void {
    const hadSyncError = this.lastSyncResult === 'error'
    this.lastSyncAt = new Date()
    this.lastSyncResult = 'ok'
    if (hadSyncError) {
      this.recordAnalysisEvent('info', 'Sync wiederhergestellt / sync restored')
    }
    const wallbox = result.wallboxPowerState[0]
    const wallboxDiag = wallbox?.socDiagnostics
    this.lastSnapshot = {
      pvW: result.pvDelivery,
      houseW: result.houseConsumption,
      gridW: result.gridDelivery,
      batteryPct: result.batteryChargingLevel * 100,
      firmware: result.firmwareVersion,
      wallboxSocPercent: wallbox?.socPercent,
      wallboxPlugged: wallbox?.plugged,
      wallboxSocRaw: wallboxDiag?.rscpSocRaw,
      wallboxAlgPrecharge: wallboxDiag?.algPrecharge,
      wallboxAlgHex: wallboxDiag?.algHex,
      wallboxChargePlanSoc: wallboxDiag?.chargePlanSoc,
      wallboxChargePlanText: wallboxDiag?.chargePlanText,
    }

  }

  private recordSyncFailure(message: string): void {
    this.lastSyncAt = new Date()
    this.lastSyncResult = 'error'
    this.recordAnalysisEvent('error', message)
  }

  private countLinkedDevices(driverId: string): number {
    const stationId = this.getId()
    return this.homey.drivers.getDriver(driverId).getDevices()
        .filter(device => {
          const settings = device.getStoreValue('settings') as { stationId?: string } | undefined
          return settings?.stationId === stationId
        })
        .length
  }

  async onSettings({
    oldSettings,
    newSettings,
    changedKeys,
  }: {
    oldSettings: { [key: string]: boolean | string | number | undefined | null };
    newSettings: { [key: string]: boolean | string | number | undefined | null };
    changedKeys: string[];
  }): Promise<string | void> {
    this.log("HomePowerStationDevice settings where changed");
    const e3dcData: E3dcConnectionData = {
      // @ts-ignore
      address: newSettings.stationAddress,
      // @ts-ignore
      port: newSettings.stationPort,
      // @ts-ignore
      portalUser: newSettings.portalUsername,
      // @ts-ignore
      portalPassword: newSettings.portalPassword,
      // @ts-ignore
      rscpPassword: newSettings.rscpKey
    }
    this.api = undefined
  }

  async onRenamed(name: string) {
    this.log('HomePowerStationDevice was renamed');
  }

  async onDeleted() {
    this.log('HomePowerStationDevice has been deleted');
    if (this.loopId) {
      clearTimeout(this.loopId)
    }
    if (this.powerModeLoopId) {
      clearTimeout(this.powerModeLoopId)
    }
    if (this.api) {
      this.api.closeOwnConnection(this).catch(reason => {
        this.log('closeOwnConnection on delete failed: ' + formatError(reason))
      })
    }
  }

  translate(key: string | Object, tags?: Object | undefined): string {
    return this.homey.__(key, tags);
  }
}

export enum CardUnit {
  WATT = 'w',
  PERCENTAGE = 'percentage'
}

module.exports = HomePowerStationDevice;
