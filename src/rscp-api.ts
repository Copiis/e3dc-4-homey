import {
    ChargingConfiguration,
    ChargingConfigurationConverter,
    ChargingLimits,
    DailySummaryConverter,
    DataBuilder,
    DataType,
    DBTag,
    DefaultHomePowerPlantConnectionFactory,
    Duration,
    E3dcConnectionData,
    EMSTag,
    Frame,
    FrameBuilder,
    HistoryData,
    HomePowerPlantConnection,
    HomePowerPlantConnectionFactory,
    InfoTag,
    MonthlySummaryConverter,
    RequestChargingConfigurationCreator,
    ResultCode,
    SetPowerSettingsCreator,
    WriteChargingLimitsResult,
    WriteChargingLimitsResultConverter,
    YearlySummaryConverter,
    DefaultBatteryService,
    EPTag,
    BatTag,
    DefaultEmergencyPowerService,
    EmergencyPowerState,
    WBTag,
    WallboxInfo,
    DefaultWallboxService,
    RequestWallboxIdsCreator,
    WallboxDeviceIdsConverter,
} from 'easy-rscp';
import {LiveData} from './model/live-data';
import {SyncDataFrameConverter} from './converter/SyncDataFrameConverter';
import {WallboxLiveState} from './model/wallbox-live-state';
import {RequestWallboxLiveStateCreator} from './converter/request-wallbox-live-state-creator';
import {WallboxLiveStateConverter} from './converter/wallbox-live-state-converter';
import {SummaryData} from './model/summary-data';
import {SummaryType} from './model/summary.config';
import {Logger} from './internal-api/logger';
import {formatError, normalizeError, rejectAsError} from './utils/error-utils';
import {SafeSocketFactory} from './rscp-safe-socket-factory';
import {startOfLocalCalendarDay} from './utils/grid-cumulative-archive';
import {BatteryData, DCBData} from './model/battery-data';
import {
    DEFAULT_WALLBOX_CURRENT_A,
    WALLBOX_EXTERN_DATA_LEN,
    WALLBOX_EXTERN_MIXED_MODE,
    WALLBOX_EXTERN_SUN_MODE,
    WALLBOX_MODE_MIXED,
    WALLBOX_MODE_STOP
} from './model/wallbox-control';
import {WallboxEmsSettings} from './model/wallbox-ems-settings';
import {
    EMS_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
    EMS_GET_WB_DISCHARGE_BAT_UNTIL,
    EMS_REQ_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
    EMS_REQ_GET_WB_DISCHARGE_BAT_UNTIL,
    EMS_REQ_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
    EMS_REQ_SET_WB_DISCHARGE_BAT_UNTIL,
    EMS_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
    EMS_SET_WB_DISCHARGE_BAT_UNTIL,
} from './model/ems-wallbox-battery-tags';
import {EMS_REQ_SET_POWER, EMS_REQ_SET_POWER_MODE, EMS_REQ_SET_POWER_VALUE, EMS_SET_POWER} from './model/ems-power-mode-tags';
import {resolveUsableCapacityWh} from './utils/battery-capacity';

const connectionMap: Map<string, HomePowerPlantConnection> = new Map<string, HomePowerPlantConnection>()
const connectionFactoryMap: Map<string, HomePowerPlantConnectionFactory> = new Map<string, HomePowerPlantConnectionFactory>()
const pendingOpenMap: Map<string, Promise<HomePowerPlantConnection>> = new Map<string, Promise<HomePowerPlantConnection>>()

export class RscpApi {

    private connectionData: E3dcConnectionData | undefined = undefined

    init(data: E3dcConnectionData, log: Logger) {
        if (this.connectionData) {
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log).then()
        }
        this.connectionData = data
        const newFactory = new DefaultHomePowerPlantConnectionFactory(
            this.connectionData,
            undefined,
            new SafeSocketFactory(),
        )
        connectionFactoryMap.set(this.getKey(), newFactory)
    }

    private getKey(): string {
        return this.connectionData!!.address + ":" + this.connectionData!!.port
    }

    private getConnectionFactory(): HomePowerPlantConnectionFactory {
        return connectionFactoryMap.get(this.getKey())!!
    }
    private evictConnection(connection: HomePowerPlantConnection | undefined): void {
        if (!connection) {
            return
        }
        const key = this.getKey()
        if (connectionMap.get(key) === connection) {
            connectionMap.delete(key)
        }
    }

    private getOpenConnection(log: Logger): Promise<HomePowerPlantConnection> {
        const key = this.getKey()
        const currentConnection = connectionMap.get(key)
        if (currentConnection?.isConnected()) {
            log.log('getOpenConnection: Returning existing connection')
            return Promise.resolve(currentConnection)
        }

        const pendingOpen = pendingOpenMap.get(key)
        if (pendingOpen) {
            log.log('getOpenConnection: Waiting for pending connection')
            return pendingOpen
        }

        log.log('getOpenConnection: Creating new connection')
        const openPromise = this.getConnectionFactory()
            .openConnection()
            .then(con => {
                log.log('getOpenConnection: Returning new connection')
                connectionMap.set(key, con)
                return con
            })
            .catch(e => {
                log.error('getOpenConnection: Creating new connection failed')
                log.error(formatError(e))
                connectionMap.delete(key)
                throw normalizeError(e)
            })
            .finally(() => {
                pendingOpenMap.delete(key)
            })

        pendingOpenMap.set(key, openPromise)
        return openPromise
    }

    closeOwnConnection(log: Logger): Promise<any> {
        const key = this.getKey()
        const toClose = connectionMap.get(key)
        return this.closeConnection(toClose, log)
    }

    closeConnection(connection: HomePowerPlantConnection | undefined, log: Logger):Promise<any> {
        return new Promise(resolve => {
            if (!connection) {
                resolve(undefined)
                return
            }
            log.log('closeConnection: closing connection')
            connection
                .disconnect()
                .catch(reason => {
                    log.log('closeConnection: disconnect error (ignored): ' + formatError(reason))
                })
                .finally(() => {
                    this.evictConnection(connection)
                    setTimeout(() => {
                        log.log('closeConnection: Connection closed')
                        resolve(undefined)
                    }, 2000)
                })
        })
    }

    readSummaryData(summaryType: SummaryType, allowReconnect: boolean = true, log: Logger, timezone?: string): Promise<SummaryData> {
        return new Promise<SummaryData>((resolve, reject) => {
            log.log('readSummaryData: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('readSummaryData: Connection received')
                    const request= this.buildFrameBySummaryType(summaryType, log, timezone)
                    log.log('readSummaryData: Sending request frame ...')
                    con.send(request)
                        .then(response => {
                            log.log('readSummaryData: Answer received')
                            const result = this.parseSummaryData(request, response, summaryType)
                            resolve(result)
                        })
                        .catch(e => this.handleReadSummaryDataDataError(
                            summaryType,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                            timezone
                        ))

                })
                .catch(e => this.handleReadSummaryDataDataError(
                    summaryType,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                    timezone
                ))
        })
    }

    writeChargingLimits(limits: ChargingLimits, allowReconnect: boolean = true, log: Logger): Promise<WriteChargingLimitsResult> {
        return new Promise<WriteChargingLimitsResult>((resolve, reject) => {
            log.log('writeChargingLimits: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('writeChargingLimits: Connection received')
                    const request= new SetPowerSettingsCreator().create(limits)
                    log.log('writeChargingLimits: Sending request frame ...')
                    con.send(request)
                        .then(response => {
                            log.log('writeChargingLimits: Answer received')
                            const result = new WriteChargingLimitsResultConverter().convert(response)
                            resolve(result)
                        })
                        .catch(e => this.handleWriteChargingLimitsError(
                            limits,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log
                        ))

                })
                .catch(e => this.handleWriteChargingLimitsError(
                    limits,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log
                ))
        })
    }

    readChargingConfiguration(allowReconnect: boolean = true, log: Logger): Promise<ChargingConfiguration> {
        return new Promise<ChargingConfiguration>((resolve, reject) => {
            log.log('readChargingConfiguration: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('readChargingConfiguration: Connection received')
                    const request = new RequestChargingConfigurationCreator().create(undefined)
                    log.log('readChargingConfiguration: Sending request frame ...')
                    con.send(request)
                        .then(response => {
                            log.log('readChargingConfiguration: Answer received')
                            const result = new ChargingConfigurationConverter().convert(response)
                            resolve(result)
                        })
                        .catch(e => this.handleReadChargingConfigurationError(allowReconnect, e, resolve, reject, log))
                })
                .catch(e => this.handleReadChargingConfigurationError(allowReconnect, e, resolve, reject, log))
        })
    }

    private readBatteryCapacityExtras(
        connection: HomePowerPlantConnection,
        batIndex: number,
        designVoltage: number,
        log: Logger,
    ): Promise<{ usableCapacityWh?: number; reserveMaxWh?: number; asocRaw?: number }> {
        const request = new FrameBuilder()
            .addData(
                new DataBuilder().tag(BatTag.REQ_DATA).container(
                    new DataBuilder().tag(BatTag.INDEX).uint16(batIndex).build(),
                    new DataBuilder().tag(BatTag.REQ_USABLE_CAPACITY).build(),
                    new DataBuilder().tag(BatTag.REQ_ASOC).build(),
                ).build(),
                new DataBuilder().tag(EPTag.REQ_EP_RESERVE).build(),
            )
            .build()

        return connection.send(request)
            .then(response => {
                const extras: { usableCapacityWh?: number; reserveMaxWh?: number; asocRaw?: number } = {}

                try {
                    const usableAh = response.numberByTag(BatTag.USABLE_CAPACITY, BatTag.DATA)
                    if (usableAh > 0 && designVoltage > 0) {
                        extras.usableCapacityWh = usableAh * designVoltage
                    }
                } catch (_) { /* tag not present */ }

                try {
                    extras.asocRaw = response.numberByTag(BatTag.ASOC, BatTag.DATA)
                } catch (_) { /* tag not present */ }

                try {
                    extras.reserveMaxWh = response.numberByTag(
                        EPTag.PARAM_EP_RESERVE_MAX_ENERGY, EPTag.EP_RESERVE
                    )
                } catch (_) {
                    try {
                        extras.reserveMaxWh = response.numberByTag(EPTag.PARAM_EP_RESERVE_MAX_ENERGY)
                    } catch (_2) { /* tag not present */ }
                }

                return extras
            })
            .catch(reason => {
                log.log('readBatteryCapacityExtras failed: ' + formatError(reason))
                return {}
            })
    }

    private sumDcbFullChargeWh(
        dcbSpecs: { fullChargeCapacityAh: number; voltage: number }[],
        fallbackVoltage: number,
    ): number | undefined {
        let total = 0
        for (const dcb of dcbSpecs) {
            const voltage = dcb.voltage > 0 ? dcb.voltage : fallbackVoltage
            if (dcb.fullChargeCapacityAh > 0 && voltage > 0) {
                total += dcb.fullChargeCapacityAh * voltage
            }
        }
        return total > 0 ? total : undefined
    }

    readBatteryData(allowReconnect: boolean = true, log: Logger): Promise<BatteryData[]> {
        return new Promise<BatteryData[]>((resolve, reject) => {
            log.log('readBatteryData: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    const batteryService = new DefaultBatteryService(con)
                    log.log('readBatteryData: Reading specification data ...')
                    batteryService
                        .readSpecification()
                        .then(batterySpec => {
                            log.log('readBatteryData: Reading specification data, answer received')
                            log.log('readBatteryData: Reading Monitoring data ...')
                            batteryService
                                .readMonitoringData()
                                .then(async batteryStatus => {
                                    log.log('readBatteryData: Reading Monitoring data, answer received')
                                    const result: BatteryData[] = []
                                    let dcbReadOutOk = false
                                    for (let batteryIndex = 0; batteryIndex < batterySpec.length; batteryIndex++) {
                                        let spec = batterySpec[batteryIndex]
                                        let status = batteryStatus[batteryIndex]
                                        if (status && status.dcbStatus && status.dcbStatus.length == spec.dcbSpecs.length) {
                                            dcbReadOutOk = true
                                            let dcbs: DCBData[] = []
                                            for (let dcbIndex = 0; dcbIndex < spec.dcbSpecs.length; dcbIndex++) {
                                                let dcbStatus = status.dcbStatus[dcbIndex]
                                                dcbs.push({
                                                    index: dcbIndex,
                                                    voltage: dcbStatus.voltage,
                                                    voltageAVG30s: dcbStatus.voltageAVG30s,
                                                    currentA: dcbStatus.currentA,
                                                    currentAVG30s: dcbStatus.currentAVG30s,
                                                    temperaturesCelsius: dcbStatus.temperaturesCelsius,
                                                })
                                            }

                                            const extras = await this.readBatteryCapacityExtras(
                                                con, batteryIndex, spec.voltage, log
                                            )
                                            const dcbFullChargeWh = this.sumDcbFullChargeWh(
                                                spec.dcbSpecs, spec.voltage
                                            )
                                            const usableWh = resolveUsableCapacityWh({
                                                index: batteryIndex,
                                                capacity: spec.capacityWh,
                                                asoc: status.asoc,
                                                asocRaw: extras.asocRaw,
                                                usableCapacityWh: extras.usableCapacityWh,
                                                reserveMaxWh: extras.reserveMaxWh,
                                                dcbFullChargeWh,
                                                name: spec.name,
                                                maxChargingTempCelsius: spec.maxChargingTempCelsius,
                                                minChargingTempCelsius: spec.minChargingTempCelsius,
                                                maxChargeCurrentA: spec.maxChargeCurrentA,
                                                maxDischargeCurrentA: spec.maxDischargeCurrentA,
                                                designVoltage: spec.voltage,
                                                connected: status.connected,
                                                working: status.working,
                                                inService: status.inService,
                                                voltage: status.voltage,
                                                dcbs,
                                            })
                                            log.log(
                                                'readBatteryData: capacity specified=' + spec.capacityWh
                                                + 'Wh asoc=' + status.asoc
                                                + ' usable=' + usableWh + 'Wh'
                                                + (extras.reserveMaxWh ? ' reserveMax=' + extras.reserveMaxWh : '')
                                            )

                                            result.push({
                                                index: batteryIndex,
                                                capacity: spec.capacityWh,
                                                asoc: status.asoc,
                                                asocRaw: extras.asocRaw,
                                                usableCapacityWh: extras.usableCapacityWh,
                                                reserveMaxWh: extras.reserveMaxWh,
                                                dcbFullChargeWh,
                                                name: spec.name,
                                                maxChargingTempCelsius: spec.maxChargingTempCelsius,
                                                minChargingTempCelsius: spec.minChargingTempCelsius,
                                                maxChargeCurrentA: spec.maxChargeCurrentA,
                                                maxDischargeCurrentA: spec.maxDischargeCurrentA,
                                                designVoltage: spec.voltage,
                                                connected: status.connected,
                                                working: status.working,
                                                inService: status.inService,
                                                voltage: status.voltage,
                                                dcbs: dcbs
                                            })
                                        }
                                    }
                                    if (dcbReadOutOk) {
                                        resolve(result)
                                    }
                                    else {
                                        log.error('readBatteryData: DCB Readout failed. Spec and status did not match')
                                        reject('DCB Readout failed')
                                    }

                                })
                                .catch(reason => {
                                    log.error('readBatteryData: Failed to read battery status')
                                    log.error(formatError(reason))
                                    this.closeConnection(con, log).catch(reason1 => {
                                        log.error('readBatteryData: failed to close connection')
                                        log.error(formatError(reason1))
                                    })
                                    rejectAsError(reject, reason)
                                })
                        })
                        .catch(reason => {
                            log.error('readBatteryData: Failed to read battery spec')
                            log.error(formatError(reason))
                            if (allowReconnect) {
                                log.error('readBatteryData: Try to reconnect ...')
                                this.closeConnection(con, log)
                                    .then(_ => this.readBatteryData(false, log)
                                        .then(resultAfterReconnect => resolve(resultAfterReconnect))
                                        .catch(reason1 => {
                                            log.error('readBatteryData: Failed to read battery data')
                                            log.error(formatError(reason1))
                                            rejectAsError(reject, reason)
                                        })
                                    ).catch(reason1 => {
                                        log.error('readBatteryData: Failed to close connection')
                                        log.error(formatError(reason1))
                                        rejectAsError(reject, reason)
                                    })
                            }
                        })
                })
        })
    }

    private parseSummaryData(request: Frame, response: Frame, summaryType: SummaryType): SummaryData {
        let rscpResult: HistoryData
        if (summaryType == SummaryType.YESTERDAY || summaryType == SummaryType.TODAY) {
            const converter = new DailySummaryConverter()
            rscpResult = converter.convert(request, response)
        }
        else if (summaryType == SummaryType.LAST_MONTH || summaryType == SummaryType.CURRENT_MONTH) {
            const converter = new MonthlySummaryConverter()
            rscpResult = converter.convert(request, response)
        } else {
            const converter = new YearlySummaryConverter()
            rscpResult = converter.convert(request, response)
        }

        return {
            pvDelivery: rscpResult.pvDelivery,
            batteryIn: rscpResult.batteryIn,
            batteryOut: rscpResult.batteryOut,
            gridIn: rscpResult.gridIn,
            gridOut: rscpResult.gridOut,
            houseConsumption: rscpResult.houseConsumption,
            selfConsumption: rscpResult.selfConsumption,
            selfSufficiency: rscpResult.selfSufficiency
        }
    }

    private buildFrameBySummaryType(summaryType: SummaryType, log: Logger, timezone?: string): Frame {
        if (summaryType == SummaryType.TODAY || summaryType == SummaryType.YESTERDAY) {
            const _24_HOURS_SECONDS = 24 * 60 * 60
            const dayOffset = summaryType == SummaryType.YESTERDAY ? -1 : 0
            const date = timezone
                ? startOfLocalCalendarDay(timezone, dayOffset)
                : this.startOfSystemCalendarDay(dayOffset)
            log.log('Startdate: ' + date + ' - duration (seconds): ' + _24_HOURS_SECONDS)
            return new FrameBuilder()
                .addData(
                    new DataBuilder().tag(DBTag.REQ_HISTORY_DATA_DAY).container(
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_START).timestamp(date).build(),
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_INTERVAL).duration({
                            seconds: _24_HOURS_SECONDS,
                            nanos: 0
                        }).build(),
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_SPAN).duration({
                            seconds: _24_HOURS_SECONDS,
                            nanos: 0
                        }).build()
                    )
                    .build()
                )
                .build()
        }
        else if (summaryType == SummaryType.CURRENT_MONTH || summaryType == SummaryType.LAST_MONTH) {
            let date = new Date()
            if (summaryType == SummaryType.LAST_MONTH) {
                if (date.getMonth() == 0) {
                    date.setFullYear(date.getFullYear() - 1, 11, 1)
                }
                else {
                    date.setMonth(date.getMonth() - 1, 1);
                }
            }
            else {
                date.setMonth(date.getMonth(), 1);
            }

            date.setHours(0, 0, 0, 0);
            const daysOfMonth= this.getDaysInMonth(date);
            const duration: Duration = {
                seconds: daysOfMonth * 24 * 60 * 60,
                nanos: 0
            }
            log.log('Startdate: ' + date + ' - duration (days): ' + daysOfMonth + ' - duration (seconds): ' + duration.seconds)
            return new FrameBuilder()
                .addData(
                    new DataBuilder().tag(DBTag.REQ_HISTORY_DATA_MONTH).container(
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_START).timestamp(date).build(),
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_INTERVAL).duration(duration).build(),
                        new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_SPAN).duration(duration).build()
                    )
                        .build()
                )
                .build();
        }

        let yearOffset = 0
        if (summaryType == SummaryType.LAST_YEAR) {
            yearOffset = 1
        }
        let now = new Date()

        let startOfYear = new Date(now.getFullYear() - yearOffset, 0, 1, 0, 0, 0, 0);
        const daysOfYear= this.getDaysInYear(startOfYear);
        const duration: Duration = {
            seconds: daysOfYear * 24 * 60 * 60,
            nanos: 0
        }
        log.log('Startdate: ' + startOfYear + ' - duration (days): ' + daysOfYear + ' - duration (seconds): ' + duration.seconds)
        return new FrameBuilder()
            .addData(
                new DataBuilder().tag(DBTag.REQ_HISTORY_DATA_YEAR).container(
                    new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_START).timestamp(startOfYear).build(),
                    new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_INTERVAL).duration(duration).build(),
                    new DataBuilder().tag(DBTag.REQ_HISTORY_TIME_SPAN).duration(duration).build()
                )
                    .build()
            )
            .build();

    }

    private startOfSystemCalendarDay(dayOffset: number): Date {
        const date = new Date()
        if (dayOffset !== 0) {
            date.setDate(date.getDate() + dayOffset)
        }
        return new Date(date.setHours(0, 0, 0, 0))
    }

    private getDaysInMonth(date: Date): number {
        const lastDayOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        return lastDayOfMonth.getDate();
    }

    private getDaysInYear(date: Date): number {
        const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
        const lastDayOfYear = new Date(date.getFullYear() + 1, 0, 0);
        const millisecondsInDay = 24 * 60 * 60 * 1000;

        return Math.round((lastDayOfYear.getTime() - firstDayOfYear.getTime()) / millisecondsInDay) + 1;
    }

    startManualCharge(amountWh: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return new Promise((resolve, reject) => {
            log.log('startManualCharge(' + amountWh + '): called. Requesting connection')
            this.getOpenConnection(log)
                .then(connection => {
                    log.log('startManualCharge(' + amountWh + '): Connection received')
                    const request = new FrameBuilder()
                        .addData(
                            new DataBuilder().tag(EMSTag.REQ_START_MANUAL_CHARGE).uint32(amountWh).build()
                        )
                        .build()
                    connection
                        .send(request)
                        .then(response => {
                            const result = response.booleanByTag(EMSTag.START_MANUAL_CHARGE)
                            resolve(result)
                        })
                        .catch(reason => this.handleStartManualChargeError(
                            amountWh,
                            false,
                            reason,
                            resolve,
                            reject,
                            log
                        ))

                })
                .catch(reason => this.handleStartManualChargeError(
                    amountWh,
                    false,
                    reason,
                    resolve,
                    reject,
                    log
                ))
        })
    }

    private handleStartManualChargeError(
        amountWh: number,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: boolean | PromiseLike<boolean>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('startManualCharge(' + amountWh + ': Received error. Try to reconnect ... (Error: ' + causingError + ')')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.startManualCharge(amountWh,false, log)
                        .then(data => {
                            log.log('startManualCharge(' + amountWh + ': Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('startManualCharge(' + amountWh + ': Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })
        }
        else {
            log.log('startManualCharge(' + amountWh + ': Received error. Error: ' + causingError)
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    setPowerMode(mode: number, powerW: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return new Promise((resolve, reject) => {
            log.log('setPowerMode(' + mode + ', ' + powerW + 'W): called. Requesting connection')
            this.getOpenConnection(log)
                .then(connection => {
                    log.log('setPowerMode(' + mode + ', ' + powerW + 'W): Connection received')
                    const request = new FrameBuilder()
                        .addData(
                            new DataBuilder().tag(EMS_REQ_SET_POWER).container(
                                new DataBuilder().tag(EMS_REQ_SET_POWER_MODE).uchar8(mode).build(),
                                new DataBuilder().tag(EMS_REQ_SET_POWER_VALUE).int32(powerW).build()
                            ).build()
                        )
                        .build()
                    connection
                        .send(request)
                        .then(response => {
                            const result = response.booleanByTag(EMS_SET_POWER)
                            resolve(result)
                        })
                        .catch(reason => this.handleSetPowerModeError(
                            mode, powerW, allowReconnect, reason, resolve, reject, log
                        ))
                })
                .catch(reason => this.handleSetPowerModeError(
                    mode, powerW, allowReconnect, reason, resolve, reject, log
                ))
        })
    }

    private handleSetPowerModeError(
        mode: number,
        powerW: number,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: boolean | PromiseLike<boolean>) => void),
        reject: ((reason?: any) => void),
        log: Logger,
    ) {
        if (allowReconnect) {
            log.log('setPowerMode(' + mode + ', ' + powerW + 'W): Received error. Try to reconnect ... (Error: ' + causingError + ')')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.setPowerMode(mode, powerW, false, log)
                        .then(data => resolve(data))
                        .catch(e => rejectAsError(reject, e))
                })
        } else {
            log.log('setPowerMode(' + mode + ', ' + powerW + 'W): Received error. Error: ' + causingError)
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    readLiveData(allowReconnect: boolean = true, log: Logger, readWallboxes: boolean = true): Promise<LiveData> {
        return new Promise<LiveData>((resolve, reject) => {
            const date = new Date()
            date.setHours(0, 0, 0, 0)
            log.log('readLiveData: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('readLiveData: Connection received')
                    if (!readWallboxes) {
                        this.callLiveData(con, [], allowReconnect, log)
                            .then(data => resolve(data))
                            .catch(e => this.handleReadSyncDataError(
                                allowReconnect,
                                e,
                                resolve,
                                reject,
                                log
                            ))
                        return
                    }
                    const wallboxService = new DefaultWallboxService(con)
                    log.log('readLiveData: Reading connected wallboxes')
                    wallboxService.readConnectedWallboxes()
                        .then(value => {
                            log.log('readLiveData: Reading connected wallboxes -> Answer received. Reading live data')
                            if (value.length > 0) {
                                this.readWallboxLiveState(con, value.map(info => info.id), log)
                                    .then(wbStates => {
                                        this.callLiveData(con, wbStates, allowReconnect, log)
                                            .then(data => resolve(data))
                                            .catch(e => this.handleReadSyncDataError(
                                                allowReconnect,
                                                e,
                                                resolve,
                                                reject,
                                                log
                                            ))
                                    })
                                    .catch(e => this.handleReadSyncDataError(
                                        allowReconnect,
                                        e,
                                        resolve,
                                        reject,
                                        log
                                    ))
                            }
                            else {
                                this.callLiveData(con, [], allowReconnect, log)
                                    .then(data => resolve(data))
                                    .catch(e => this.handleReadSyncDataError(
                                        allowReconnect,
                                        e,
                                        resolve,
                                        reject,
                                        log
                                    ))
                            }
                        })
                        .catch(e => this.handleReadSyncDataError(
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log
                        ))

                })
                .catch(e => this.handleReadSyncDataError(
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log
                ))
        })
    }

    readWallboxLiveStateById(wallboxId: number, allowReconnect: boolean = true, log: Logger): Promise<WallboxLiveState> {
        return new Promise((resolve, reject) => {
            log.log(`readWallboxLiveStateById(id=${wallboxId}): Requesting connection ...`)
            this.getOpenConnection(log)
                .then(con => this.readWallboxLiveState(con, [wallboxId], log))
                .then(states => {
                    const state = states.find(s => s.id === wallboxId) ?? states[0]
                    if (!state) {
                        reject(new Error(`No live state returned for wallbox id ${wallboxId}`))
                        return
                    }
                    resolve(state)
                })
                .catch(e => {
                    if (allowReconnect) {
                        log.log(`readWallboxLiveStateById: error, reconnecting ... (${e})`)
                        const currentConnection = connectionMap.get(this.getKey())
                        this.closeConnection(currentConnection, log)
                            .finally(() => {
                                this.readWallboxLiveStateById(wallboxId, false, log)
                                    .then(resolve)
                                    .catch(reject)
                            })
                    } else {
                        rejectAsError(reject, e)
                    }
                })
        })
    }

    private readWallboxLiveState(con: HomePowerPlantConnection, ids: number[], log: Logger): Promise<WallboxLiveState[]> {
        return new Promise((resolve, reject) => {
            if (ids.length === 0) {
                reject(new Error('Parameter ids can not be empty'));
                return;
            }
            const request = new RequestWallboxLiveStateCreator().create(ids);
            log.log(`readWallboxLiveState: requesting EXTERN_DATA_ALG for ids [${ids.join(', ')}]`);
            con.send(request)
                .then(response => {
                    try {
                        const states = new WallboxLiveStateConverter().convert(response);
                        if (states.length === 0) {
                            log.log('readWallboxLiveState: no wallbox state blocks in response');
                        }
                        states.forEach(state => {
                            const diag = state.socDiagnostics;
                            log.log(
                                `readWallboxLiveState id=${state.id}: chargingEnabled=${state.chargingEnabled}, `
                                + `sunMode=${state.sunModeActive}, chargingActive=${state.chargingActive}, `
                                + `plugged=${state.plugged}, chargingCanceled=${state.chargingCanceled}, `
                                + `powerW=${state.powerW}, solarW=${state.solarPowerW}, gridW=${state.gridPowerW ?? 'n/a'}, `
                                + `vehicleSoc=${state.socPercent ?? 'n/a'}%, `
                                + `socRaw=${diag?.rscpSocRaw ?? 'n/a'}, algPrecharge=${diag?.algPrecharge ?? 'n/a'}, `
                                + `algHex=${diag?.algHex ?? 'n/a'}, chargePlanSoc=${diag?.chargePlanSoc ?? 'n/a'}, `
                                + `chargePlanText=${diag?.chargePlanText ?? 'n/a'}, `
                                + `runscreen=${diag?.runscreenPercentTexts?.join('|') ?? 'n/a'}`,
                            );
                        });
                        resolve(states);
                    } catch (e) {
                        rejectAsError(reject, e);
                    }
                })
                .catch(e => rejectAsError(reject, e));
        });
    }

    private callLiveData(con: HomePowerPlantConnection, wbStates: WallboxLiveState[], allowReconnect: boolean, log: Logger): Promise<LiveData> {
        return new Promise((resolve, reject) => {
            const request = new FrameBuilder()
                .addData(
                    new DataBuilder().tag(EMSTag.REQ_POWER_PV).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_BAT).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_GRID).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_HOME).build(),
                    new DataBuilder().tag(EMSTag.REQ_BAT_SOC).build(),
                    new DataBuilder().tag(InfoTag.REQ_SW_RELEASE).build(),
                    new DataBuilder().tag(EMSTag.REQ_GET_MANUAL_CHARGE).build(),
                    new DataBuilder().tag(EPTag.REQ_EP_RESERVE).build(),
                    new DataBuilder().tag(EPTag.REQ_IS_POSSIBLE).build(),
                    new DataBuilder().tag(EPTag.REQ_IS_GRID_CONNECTED).build(),
                    new DataBuilder().tag(EPTag.REQ_IS_ISLAND_GRID).build(),
                    new DataBuilder().tag(EPTag.REQ_IS_INVALID_STATE).build(),
                    new DataBuilder().tag(EPTag.REQ_IS_READY_FOR_SWITCH).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_WB_ALL).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_WB_SOLAR).build(),
                    new DataBuilder().tag(EMSTag.REQ_EXT_SRC_AVAILABLE).build(),
                    new DataBuilder().tag(EMSTag.REQ_POWER_ADD).build(),
                )
                .build();
            log.log('readLiveData: Sending request frame ...')
            con.send(request)
                .then(response => {
                    log.log('readLiveData: Answer received')
                    log.log('readLiveData: Requesting charging spec')
                    const requestSpec = new FrameBuilder()
                        .addData(
                            new DataBuilder().tag(EMSTag.REQ_GET_POWER_SETTINGS).build(),
                            new DataBuilder().tag(EMSTag.REQ_GET_SYS_SPECS).build(),
                        )
                        .build()
                    con.send(requestSpec)
                        .then(specResponse => {
                            log.log('readLiveData: Answer received')
                            resolve(new SyncDataFrameConverter(wbStates, specResponse).convert(response))
                        })
                        .catch(e => this.handleReadSyncDataError(
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log
                        ))
                })
                .catch(e => this.handleReadSyncDataError(
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log
                ))
        })

    }

    private handleReadSyncDataError(
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: LiveData | PromiseLike<LiveData>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('readLiveData: Received error. Try to reconnect ...')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.readLiveData(false, log)
                        .then(data => {
                            log.log('readLiveData: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('readLiveData: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })
        }
        else {
            log.log('readLiveData: Received error. Error: ' + formatError(causingError))
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    private handleReadSummaryDataDataError(
        type: SummaryType,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: SummaryData | PromiseLike<SummaryData>) => void),
        reject: ((reason?: any) => void),
        log: Logger,
        timezone?: string,

    ) {

        if (allowReconnect) {
            log.log('readSummaryData: Received error. Try to reconnect ... ')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.readSummaryData(type, false, log, timezone)
                        .then(data => {
                            log.log('readSummaryData: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('readSummaryData: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })

        }
        else {
            log.log('readSummaryData: Received error.')
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    private handleWriteChargingLimitsError(
        limits: ChargingLimits,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: WriteChargingLimitsResult | PromiseLike<WriteChargingLimitsResult>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {

        if (allowReconnect) {
            log.log('writeChargingLimits: Received error. Try to reconnect ...')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.writeChargingLimits(limits, false, log)
                        .then(data => {
                            log.log('writeChargingLimits: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('writeChargingLimits: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })

        }
        else {
            log.log('writeChargingLimits: Received error.')
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    private handleReadChargingConfigurationError(
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: ChargingConfiguration | PromiseLike<ChargingConfiguration>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('readChargingConfiguration: Received error. Try to reconnect ...')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.readChargingConfiguration( false, log)
                        .then(data => {
                            log.log('readChargingConfiguration: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('readChargingConfiguration: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })
        }
        else {
            log.log('readChargingConfiguration: Received error.')
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    private handleWriteEmergencyPowerReserveError(
        amount: number,
        asPercentage: boolean,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: EmergencyPowerState | PromiseLike<EmergencyPowerState>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('writeEmergencyPowerReserveError(' + amount + ', ' + asPercentage + ': Received error. Try to reconnect ...')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.writeEmergencyPowerReserve( amount, asPercentage, false, log)
                        .then(data => {
                            log.log('writeEmergencyPowerReserveError(' + amount + ', ' + asPercentage + ': Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('writeEmergencyPowerReserveError(' + amount + ', ' + asPercentage + ': Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })

        }
        else {
            log.log('writeEmergencyPowerReserveError(' + amount + ', ' + asPercentage + ': ' + causingError)
            rejectAsError(reject, causingError)
        }
    }

    writeEmergencyPowerReserve(amount: number, asPercentage: boolean, allowReconnect: boolean = true, log: Logger): Promise<EmergencyPowerState> {
        return new Promise<EmergencyPowerState>((resolve, reject) => {
            log.log('writeEmergencyPowerReserve(' + amount + asPercentage + '): Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('writeEmergencyPowerReserve(' + amount + asPercentage + '): connection received')
                    const service = new DefaultEmergencyPowerService(con)
                    let promise: Promise<EmergencyPowerState>
                    if (asPercentage) {
                        promise = service.setReservePercentage(amount / 100.0)
                    }
                    else {
                        promise = service.setReserveWH(amount)
                    }

                    promise
                        .then(value => {
                            log.log('writeEmergencyPowerReserve(' + amount + asPercentage + '): answer received')
                            resolve(value)
                        })
                        .catch(reason => this.handleWriteEmergencyPowerReserveError(amount, asPercentage, allowReconnect, reason, resolve, reject, log))

                })
                .catch(e => this.handleWriteEmergencyPowerReserveError(amount, asPercentage, allowReconnect, e, resolve, reject, log))
        })
    }

    readConnectedWallboxes(allowReconnect: boolean = true, log: Logger): Promise<WallboxInfo[]> {
        return new Promise<WallboxInfo[]>((resolve, reject) => {
            const date = new Date()
            date.setHours(0, 0, 0, 0)
            log.log('readConnectedWallboxes: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('readConnectedWallboxes: Connection received')
                    const service = new DefaultWallboxService(con)
                    service.readConnectedWallboxes()
                        .then(value => {
                            log.log('readConnectedWallboxes: Answer received')
                            resolve(value)
                        })
                        .catch(reason => this.handleReadConnectedWallboxesError(
                            allowReconnect,
                            reason,
                            resolve,
                            reject,
                            log
                        ))
                })
                .catch(e => this.handleReadConnectedWallboxesError(
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log
                ))
        })
    }

    private handleReadConnectedWallboxesError(
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: WallboxInfo[] | PromiseLike<WallboxInfo[]>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('readConnectedWallboxes: Received error. Try to reconnect ... (Error: ' + causingError + ')')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.readConnectedWallboxes(false, log)
                        .then(data => {
                            log.log('readConnectedWallboxes: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('readConnectedWallboxes: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })
        }
        else {
            log.log('readConnectedWallboxes: Received error. Error: ' + formatError(causingError))
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

    /**
     * Send WBTag.REQ_SET_EXTERN control block (6 bytes).
     * Byte layout (ioBroker e3dc-rscp): [sunMode, maxCurrentA, precharge, togglePhases, abortCharging, schuko]
     */
    setWallboxExtern(wallboxId: number, externBytes: number[], allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        if (externBytes.length !== WALLBOX_EXTERN_DATA_LEN) {
            return Promise.reject(new Error(`Wallbox extern data must be ${WALLBOX_EXTERN_DATA_LEN} bytes`))
        }
        const hex = externBytes.map(b => b.toString(16).padStart(2, '0')).join('')
        return new Promise<boolean>((resolve, reject) => {
            log.log(`setWallboxExtern(id=${wallboxId}, data=${hex}): Requesting connection ...`)
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(
                            new DataBuilder().tag(WBTag.REQ_DATA).container(
                                new DataBuilder().tag(WBTag.INDEX).uchar8(wallboxId).build(),
                                new DataBuilder().tag(WBTag.REQ_SET_EXTERN).container(
                                    new DataBuilder().tag(WBTag.EXTERN_DATA).type(DataType.BYTEARRAY).raw(hex).build(),
                                    new DataBuilder().tag(WBTag.EXTERN_DATA_LEN).uchar8(WALLBOX_EXTERN_DATA_LEN).build()
                                ).build()
                            ).build()
                        )
                        .build()
                    con.send(request)
                        .then(_ => {
                            log.log('setWallboxExtern: Answer received')
                            resolve(true)
                        })
                        .catch(e => this.handleSetWallboxExternError(wallboxId, externBytes, allowReconnect, e, resolve, reject, log))
                })
                .catch(e => this.handleSetWallboxExternError(wallboxId, externBytes, allowReconnect, e, resolve, reject, log))
        })
    }

    /**
     * Toggle charging pause (python-e3dc toggle_wallbox_charging).
     * EXTERN byte 4 = 1 flips chargingCanceled — same command resumes and pauses.
     */
    toggleWallboxCharging(wallboxId: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        log.log(`toggleWallboxCharging(id=${wallboxId})`)
        return this.setWallboxExtern(wallboxId, [0, 0, 0, 0, 1, 0], allowReconnect, log)
    }

    stopWallboxCharging(wallboxId: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        log.log(`stopWallboxCharging(id=${wallboxId})`)
        return this.toggleWallboxCharging(wallboxId, allowReconnect, log)
            .catch(reason => {
                log.log('stopWallboxCharging: extern toggle failed, trying REQ_SET_MODE stop')
                log.log(reason)
                return this.setWallboxMode(wallboxId, WALLBOX_MODE_STOP, 0, allowReconnect, log)
            })
    }

    startWallboxCharging(
        wallboxId: number,
        maxCurrentA: number = DEFAULT_WALLBOX_CURRENT_A,
        chargingCanceled: boolean = false,
        allowReconnect: boolean = true,
        log: Logger,
    ): Promise<boolean> {
        log.log(`startWallboxCharging(id=${wallboxId}, maxA=${maxCurrentA}, canceled=${chargingCanceled})`)
        const current = Math.max(6, Math.min(32, Math.round(maxCurrentA)))
        const resumeIfPaused = chargingCanceled
            ? this.toggleWallboxCharging(wallboxId, allowReconnect, log)
            : Promise.resolve(true)
        return resumeIfPaused
            .then(() => this.setWallboxExtern(wallboxId, [WALLBOX_EXTERN_MIXED_MODE, current, 0, 0, 0, 0], allowReconnect, log))
            .then(() => this.setWallboxMode(wallboxId, WALLBOX_MODE_MIXED, current, false, log))
    }

    setWallboxSunMode(wallboxId: number, enabled: boolean, maxCurrentA: number = DEFAULT_WALLBOX_CURRENT_A, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        const sunByte = enabled ? WALLBOX_EXTERN_SUN_MODE : WALLBOX_EXTERN_MIXED_MODE
        log.log(`setWallboxSunMode(id=${wallboxId}, enabled=${enabled})`)
        // Byte 0 only for mode toggle (aligned with python-e3dc / ioBroker e3dc-rscp).
        return this.setWallboxExtern(wallboxId, [sunByte, 0, 0, 0, 0, 0], allowReconnect, log)
            .then(ok => {
                if (!ok || !enabled || maxCurrentA === undefined || maxCurrentA === null) {
                    return ok
                }
                const current = Math.max(6, Math.min(32, Math.round(maxCurrentA)))
                log.log(`setWallboxSunMode: applying max current ${current}A`)
                return this.setWallboxExtern(wallboxId, [0, current, 0, 0, 0, 0], false, log)
            })
    }

    private handleSetWallboxExternError(
        wallboxId: number,
        externBytes: number[],
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: boolean | PromiseLike<boolean>) => void),
        reject: ((reason?: any) => void),
        log: Logger,
    ) {
        if (allowReconnect) {
            log.log(`setWallboxExtern: Received error. Try to reconnect ... (Error: ${causingError})`)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.setWallboxExtern(wallboxId, externBytes, false, log)
                        .then(data => resolve(data))
                        .catch(e => rejectAsError(reject, e))
                })
        } else {
            log.log('setWallboxExtern: Received error. Error: ' + formatError(causingError))
            rejectAsError(reject, causingError)
        }
    }

    /**
     * Set max charging current without changing the active mode (ioBroker PowerLimitation).
     * EXTERN_DATA: [0, maxCurrentA, 0, 0, 0, 0]
     */
    setWallboxCurrentLimit(wallboxId: number, maxCurrentA: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        if (maxCurrentA === 0) {
            return this.stopWallboxCharging(wallboxId, allowReconnect, log)
        }
        const current = Math.max(6, Math.min(32, Math.round(maxCurrentA)))
        log.log(`setWallboxCurrentLimit(id=${wallboxId}, maxA=${current})`)
        return this.setWallboxExtern(wallboxId, [0, current, 0, 0, 0, 0], allowReconnect, log)
    }

    /**
     * Set wallbox charging mode and/or max current.
     * Uses low-level WBTag.REQ_SET_MODE (supported by E3/DC wallboxes).
     * mode: implementation specific (common: 0=off, 1=fast?, sun/external modes via EXTERN too).
     * Consult your wallbox manual / test values. maxCurrentA: e.g. 6..32
     */
    setWallboxMode(wallboxId: number, mode: number, maxCurrentA: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            log.log(`setWallboxMode(id=${wallboxId}, mode=${mode}, maxA=${maxCurrentA}): Requesting connection ...`)
            this.getOpenConnection(log)
                .then(con => {
                    log.log('setWallboxMode: Connection received')
                    const request = new FrameBuilder()
                        .addData(
                            new DataBuilder().tag(WBTag.REQ_SET_MODE).container(
                                new DataBuilder().tag(WBTag.INDEX).uchar8(wallboxId).build(),
                                new DataBuilder().tag(WBTag.MODE_PARAM_MODE).uint16(mode).build(),
                                new DataBuilder().tag(WBTag.MODE_PARAM_MAX_CURRENT).uint16(maxCurrentA).build()
                            ).build()
                        )
                        .build()
                    con.send(request)
                        .then(response => {
                            log.log('setWallboxMode: Answer received')
                            // Response may be in SET_MODE or generic result. Treat non-error as success for now.
                            resolve(true)
                        })
                        .catch(e => this.handleSetWallboxModeError(wallboxId, mode, maxCurrentA, allowReconnect, e, resolve, reject, log))
                })
                .catch(e => this.handleSetWallboxModeError(wallboxId, mode, maxCurrentA, allowReconnect, e, resolve, reject, log))
        })
    }

    private handleSetWallboxModeError(
        wallboxId: number,
        mode: number,
        maxCurrentA: number,
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: boolean | PromiseLike<boolean>) => void),
        reject: ((reason?: any) => void),
        log: Logger,
    ) {
        if (allowReconnect) {
            log.log(`setWallboxMode: Received error. Try to reconnect ... (Error: ${causingError})`)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.setWallboxMode(wallboxId, mode, maxCurrentA, false, log)
                        .then(data => {
                            log.log('setWallboxMode: Retry was successful')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('setWallboxMode: Retry failed also: ' + formatError(e))
                            rejectAsError(reject, e)
                        })
                })
        } else {
            log.log('setWallboxMode: Received error. Error: ' + formatError(causingError))
            rejectAsError(reject, causingError)
        }
    }

    readBatteryToCarMode(allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return this.emsReadUchar8AsBoolean(
            EMSTag.REQ_BATTERY_TO_CAR_MODE,
            EMSTag.BATTERY_TO_CAR_MODE,
            'readBatteryToCarMode',
            allowReconnect,
            log,
        )
    }

    setBatteryToCarMode(enabled: boolean, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        const value = enabled ? 1 : 0
        log.log(`setBatteryToCarMode(enabled=${enabled})`)
        if (enabled) {
            return this.setBatteryBeforeCarMode(false, false, log)
                .catch(() => false)
                .then(() => this.emsSetUchar8(
                    EMSTag.REQ_SET_BATTERY_TO_CAR_MODE,
                    EMSTag.SET_BATTERY_TO_CAR_MODE,
                    value,
                    'setBatteryToCarMode',
                    allowReconnect,
                    log,
                ))
        }
        return this.emsSetUchar8(
            EMSTag.REQ_SET_BATTERY_TO_CAR_MODE,
            EMSTag.SET_BATTERY_TO_CAR_MODE,
            value,
            'setBatteryToCarMode',
            allowReconnect,
            log,
        )
    }

    readBatteryBeforeCarMode(allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return this.emsReadUchar8AsBoolean(
            EMSTag.REQ_BATTERY_BEFORE_CAR_MODE,
            EMSTag.BATTERY_BEFORE_CAR_MODE,
            'readBatteryBeforeCarMode',
            allowReconnect,
            log,
        )
    }

    setBatteryBeforeCarMode(enabled: boolean, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        const value = enabled ? 1 : 0
        log.log(`setBatteryBeforeCarMode(enabled=${enabled})`)
        if (!enabled) {
            return this.emsSetUchar8(
                EMSTag.REQ_SET_BATTERY_BEFORE_CAR_MODE,
                EMSTag.SET_BATTERY_BEFORE_CAR_MODE,
                value,
                'setBatteryBeforeCarMode',
                allowReconnect,
                log,
            )
        }
        return this.setBatteryToCarMode(false, false, log)
            .catch(() => false)
            .then(() => this.emsSetUchar8(
                EMSTag.REQ_SET_BATTERY_BEFORE_CAR_MODE,
                EMSTag.SET_BATTERY_BEFORE_CAR_MODE,
                value,
                'setBatteryBeforeCarMode',
                allowReconnect,
                log,
            ))
    }

    readWbDischargeBatteryUntil(allowReconnect: boolean = true, log: Logger): Promise<number> {
        return this.emsReadUchar8(
            EMS_REQ_GET_WB_DISCHARGE_BAT_UNTIL,
            EMS_GET_WB_DISCHARGE_BAT_UNTIL,
            'readWbDischargeBatteryUntil',
            allowReconnect,
            log,
        )
    }

    setWbDischargeBatteryUntil(percent: number, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        const value = Math.max(0, Math.min(100, Math.round(percent)))
        log.log(`setWbDischargeBatteryUntil(percent=${value})`)
        return this.emsSetUchar8(
            EMS_REQ_SET_WB_DISCHARGE_BAT_UNTIL,
            EMS_SET_WB_DISCHARGE_BAT_UNTIL,
            value,
            'setWbDischargeBatteryUntil',
            allowReconnect,
            log,
        ).then(setOk => {
            if (setOk) {
                return true
            }
            return this.readWbDischargeBatteryUntil(false, log)
                .then(actual => {
                    log.log(`setWbDischargeBatteryUntil: read-back ${actual}% (wanted ${value}%)`)
                    return actual === value
                })
        })
    }

    readWallboxDisableBatteryAtMixMode(allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        return this.emsReadBoolOrUchar8AsBoolean(
            EMS_REQ_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
            EMS_GET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
            'readWallboxDisableBatteryAtMixMode',
            allowReconnect,
            log,
        )
    }

    setWallboxDisableBatteryAtMixMode(enabled: boolean, allowReconnect: boolean = true, log: Logger): Promise<boolean> {
        log.log(`setWallboxDisableBatteryAtMixMode(enabled=${enabled})`)
        return this.emsSetBoolean(
            EMS_REQ_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
            EMS_SET_WALLBOX_ENFORCE_POWER_ASSIGNMENT,
            enabled,
            'setWallboxDisableBatteryAtMixMode',
            allowReconnect,
            log,
        )
    }

    readWallboxEmsSettings(allowReconnect: boolean = true, log: Logger): Promise<Partial<WallboxEmsSettings>> {
        const reads: Array<{ key: keyof WallboxEmsSettings; read: () => Promise<boolean | number> }> = [
            { key: 'batteryBeforeCar', read: () => this.readBatteryBeforeCarMode(allowReconnect, log) },
            { key: 'batteryToCarAllowed', read: () => this.readBatteryToCarMode(allowReconnect, log) },
            { key: 'dischargeBatteryUntilPercent', read: () => this.readWbDischargeBatteryUntil(allowReconnect, log) },
            { key: 'batteryDischargeMixBlocked', read: () => this.readWallboxDisableBatteryAtMixMode(allowReconnect, log) },
        ]

        return Promise.allSettled(reads.map(entry => entry.read()))
            .then(results => {
                const settings: Partial<WallboxEmsSettings> = {}
                results.forEach((result, index) => {
                    const { key } = reads[index]
                    if (result.status === 'fulfilled') {
                        settings[key] = result.value as never
                    } else {
                        log.log(`readWallboxEmsSettings: ${key} failed: ${formatError(result.reason)}`)
                    }
                })
                if (Object.keys(settings).length === 0) {
                    throw new Error('All wallbox EMS settings reads failed')
                }
                return settings
            })
    }

    private emsSetUchar8(
        reqTag: string,
        rspTag: string,
        value: number,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(new DataBuilder().tag(reqTag).uchar8(value).build())
                        .build()
                    con.send(request)
                        .then(response => {
                            log.log(`${operationName}: answer received`)
                            try {
                                const result = response.numberByTag(rspTag)
                                resolve(result === value)
                            } catch {
                                resolve(true)
                            }
                        })
                        .catch(e => this.handleEmsRequestError(
                            () => this.emsSetUchar8(reqTag, rspTag, value, operationName, false, log),
                            operationName,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                        ))
                })
                .catch(e => this.handleEmsRequestError(
                    () => this.emsSetUchar8(reqTag, rspTag, value, operationName, false, log),
                    operationName,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                ))
        })
    }

    private emsSetBoolean(
        reqTag: string,
        rspTag: string,
        value: boolean,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(new DataBuilder().tag(reqTag).boolean(value).build())
                        .build()
                    con.send(request)
                        .then(response => {
                            log.log(`${operationName}: answer received`)
                            try {
                                const result = response.booleanByTag(rspTag)
                                resolve(result === value)
                            } catch {
                                resolve(true)
                            }
                        })
                        .catch(e => this.handleEmsRequestError(
                            () => this.emsSetBoolean(reqTag, rspTag, value, operationName, false, log),
                            operationName,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                        ))
                })
                .catch(e => this.handleEmsRequestError(
                    () => this.emsSetBoolean(reqTag, rspTag, value, operationName, false, log),
                    operationName,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                ))
        })
    }

    private emsReadUchar8(
        reqTag: string,
        rspTag: string,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(new DataBuilder().tag(reqTag).build())
                        .build()
                    con.send(request)
                        .then(response => {
                            log.log(`${operationName}: answer received`)
                            resolve(response.numberByTag(rspTag))
                        })
                        .catch(e => this.handleEmsRequestError(
                            () => this.emsReadUchar8(reqTag, rspTag, operationName, false, log),
                            operationName,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                        ))
                })
                .catch(e => this.handleEmsRequestError(
                    () => this.emsReadUchar8(reqTag, rspTag, operationName, false, log),
                    operationName,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                ))
        })
    }

    private emsReadUchar8AsBoolean(
        reqTag: string,
        rspTag: string,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<boolean> {
        return this.emsReadUchar8(reqTag, rspTag, operationName, allowReconnect, log)
            .then(value => value >= 1)
    }

    /**
     * Some EMS tags (e.g. ENFORCE_POWER_ASSIGNMENT) return Bool on newer firmware.
     * easy-rscp numberByTag() yields 0 for Bool — booleanByTag() is required in that case.
     */
    private emsReadBoolOrUchar8AsBoolean(
        reqTag: string,
        rspTag: string,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(new DataBuilder().tag(reqTag).build())
                        .build()
                    con.send(request)
                        .then(response => {
                            const boolValue = response.booleanByTag(rspTag)
                            const numValue = response.numberByTag(rspTag)
                            log.log(`${operationName}: answer received (bool=${boolValue}, num=${numValue})`)
                            resolve(boolValue || numValue >= 1)
                        })
                        .catch(e => this.handleEmsRequestError(
                            () => this.emsReadBoolOrUchar8AsBoolean(reqTag, rspTag, operationName, false, log),
                            operationName,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                        ))
                })
                .catch(e => this.handleEmsRequestError(
                    () => this.emsReadBoolOrUchar8AsBoolean(reqTag, rspTag, operationName, false, log),
                    operationName,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                ))
        })
    }

    private emsReadBoolean(
        reqTag: string,
        rspTag: string,
        operationName: string,
        allowReconnect: boolean,
        log: Logger,
    ): Promise<boolean> {
        return new Promise<boolean>((resolve, reject) => {
            this.getOpenConnection(log)
                .then(con => {
                    const request = new FrameBuilder()
                        .addData(new DataBuilder().tag(reqTag).build())
                        .build()
                    con.send(request)
                        .then(response => {
                            log.log(`${operationName}: answer received`)
                            resolve(response.booleanByTag(rspTag))
                        })
                        .catch(e => this.handleEmsRequestError(
                            () => this.emsReadBoolean(reqTag, rspTag, operationName, false, log),
                            operationName,
                            allowReconnect,
                            e,
                            resolve,
                            reject,
                            log,
                        ))
                })
                .catch(e => this.handleEmsRequestError(
                    () => this.emsReadBoolean(reqTag, rspTag, operationName, false, log),
                    operationName,
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log,
                ))
        })
    }

    private handleEmsRequestError<T>(
        retry: () => Promise<T>,
        operationName: string,
        allowReconnect: boolean,
        causingError: Error,
        resolve: (value: T) => void,
        reject: (reason?: any) => void,
        log: Logger,
    ) {
        if (allowReconnect) {
            log.log(`${operationName}: Received error. Try to reconnect ... (Error: ${causingError})`)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    retry()
                        .then(data => resolve(data))
                        .catch(e => rejectAsError(reject, e))
                })
        } else {
            log.log(`${operationName}: Received error. Error: ${formatError(causingError)}`)
            rejectAsError(reject, causingError)
        }
    }

    readConnectedWallboxIds(allowReconnect: boolean = true, log: Logger): Promise<number[]> {
        return new Promise<number[]>((resolve, reject) => {
            const date = new Date()
            date.setHours(0, 0, 0, 0)
            log.log('readConnectedWallboxIds: Requesting connection ...')
            this.getOpenConnection(log)
                .then(con => {
                    log.log('readConnectedWallboxIds: Connection received')
                    const request = new RequestWallboxIdsCreator().create(undefined)
                    con.send(request)
                        .then(value => {
                            log.log('readConnectedWallboxIds: Answer received')
                            const converted = new WallboxDeviceIdsConverter().convert(value)
                            resolve(converted)
                        })
                        .catch(reason => this.handleReadConnectedWallboxIdsError(
                            allowReconnect,
                            reason,
                            resolve,
                            reject,
                            log
                        ))
                })
                .catch(e => this.handleReadConnectedWallboxIdsError(
                    allowReconnect,
                    e,
                    resolve,
                    reject,
                    log
                ))
        })
    }

    private handleReadConnectedWallboxIdsError(
        allowReconnect: boolean,
        causingError: Error,
        resolve: ((value: number[] | PromiseLike<number[]>) => void),
        reject: ((reason?: any) => void),
        log: Logger,

    ) {
        if (allowReconnect) {
            log.log('readConnectedWallboxIds: Received error. Try to reconnect ... (Error: ' + causingError + ')')
            log.log(causingError)
            const currentConnection = connectionMap.get(this.getKey())
            this.closeConnection(currentConnection, log)
                .finally(() => {
                    this.readConnectedWallboxIds(false, log)
                        .then(data => {
                            log.log('readConnectedWallboxIds: Retry was successfull')
                            resolve(data)
                        })
                        .catch(e => {
                            log.log('readConnectedWallboxIds: Retry failed also: ' + formatError(e))
                            log.log(e)
                            rejectAsError(reject, e)
                        })
                })
        }
        else {
            log.log('readConnectedWallboxIds: Received error. Error: ' + formatError(causingError))
            log.log(causingError)
            rejectAsError(reject, causingError)
        }
    }

}
