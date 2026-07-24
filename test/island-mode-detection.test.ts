import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CapabilityManager } from '../src/managers/capability-manager';
import { EnergyMeterIntegrator } from '../src/utils/energy-meter-integrator';
import type { LiveData } from '../src/model/live-data';
import type { EmergencyPowerState } from 'easy-rscp';

function makeEps(partial: Partial<EmergencyPowerState>): EmergencyPowerState {
  return {
    reserveWh: 0,
    reservePercentage: 0,
    connectedToGrid: true,
    readyForSwitch: true,
    emergencyPowerPossible: true,
    island: false,
    invalidState: false,
    ...partial,
  };
}

function makeLive(eps: EmergencyPowerState): LiveData {
  return {
    pvDelivery: 0,
    gridDelivery: 0,
    batteryDelivery: 0,
    houseConsumption: 0,
    batteryChargingLevel: 0.5,
    firmwareVersion: '1.0',
    chargingConfig: {} as LiveData['chargingConfig'],
    manualChargeState: { active: false, chargedEnergyWh: 0 } as LiveData['manualChargeState'],
    emergencyPowerState: eps,
    wallboxPowerState: [],
    wallboxCompleteConsumption: 0,
    wallboxCompleteConsumptionSolarShare: 0,
    externalPowerConnected: false,
    externalPowerDelivery: 0,
  };
}

function createMockDevice() {
  const timeline: string[] = [];
  const analysis: string[] = [];
  let started = 0;
  let stopped = 0;
  let reserveCalls = 0;

  const device = {
    hasCapability: () => false,
    removeCapability: () => Promise.resolve(),
    getCapabilityValue: () => undefined,
    setCapabilityValue: () => Promise.resolve(),
    getName: () => 'Test HKW',
    log: () => {},
    error: () => {},
    getAvailable: () => true,
    setAvailable: () => Promise.resolve(),
    getId: () => 'hps-1',
    getBatteryCapacity: () => Promise.resolve(10000),
    syncErrorCount: 0,
    updateBatteryData: false,
    lastPvSurplusW: 0,
    currentChargingConfig: null,
    currentManualChargeState: null,
    currentEmergencyPowerState: null,
    islandModeStartedTrigger: { trigger: () => { started++; } },
    islandModeStoppedTrigger: { trigger: () => { stopped++; } },
    emergencyPowerReserveChangedTrigger: {
      runIfChanged: (c: { oldValue: number; newValue: number }) => {
        if (c.oldValue !== c.newValue) {
          reserveCalls++;
        }
      },
    },
    postTimelineNotification: (excerpt: string) => { timeline.push(excerpt); },
    recordAnalysisEvent: (_level: string, message: string) => { analysis.push(message); },
    homey: {
      __: (key: string) => key,
    },
  } as any;

  return { device, timeline, analysis, get started() { return started; }, get stopped() { return stopped; }, get reserveCalls() { return reserveCalls; } };
}

describe('Island mode detection (Stromausfall / Notstrom)', () => {
  it('fires started trigger + timeline when island becomes true', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false })));
    assert.strictEqual(mock.started, 0);
    assert.strictEqual(mock.timeline.length, 0);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: true, connectedToGrid: false })));
    assert.strictEqual(mock.started, 1);
    assert.strictEqual(mock.stopped, 0);
    assert.deepStrictEqual(mock.timeline, ['timeline.island-started']);
  });

  it('fires stopped trigger + timeline when island becomes false', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: true, connectedToGrid: false })));
    // first observation while already island → started + delayed/init timeline
    assert.strictEqual(mock.started, 1);
    assert.ok(mock.timeline.includes('timeline.island-started-delayed'));

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false, connectedToGrid: true })));
    assert.strictEqual(mock.stopped, 1);
    assert.ok(mock.timeline.includes('timeline.island-stopped'));
  });

  it('does not re-fire on stable island state', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false })));
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: true })));
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: true })));
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: true })));

    assert.strictEqual(mock.started, 1);
    assert.strictEqual(mock.stopped, 0);
    assert.strictEqual(mock.timeline.filter((t) => t === 'timeline.island-started').length, 1);
  });

  it('after reconnect: notifies island delayed even if live edge was missed offline', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    // Normal grid before outage
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false })));
    // HKW unreachable for a while (repeater down) — no polls
    // First successful poll after reconnect while already in island
    manager.handleEmergencyPowerStateChanges(
      makeLive(makeEps({ island: true, connectedToGrid: false })),
      { recoveredFromUnavailable: true },
    );

    assert.strictEqual(mock.started, 1);
    assert.deepStrictEqual(mock.timeline, ['timeline.island-started-delayed']);
  });

  it('after reconnect: does not double-notify if live edge already fired', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false })));
    manager.handleEmergencyPowerStateChanges(
      makeLive(makeEps({ island: true, connectedToGrid: false })),
      { recoveredFromUnavailable: true },
    );
    // Same episode, further polls still "recovered" false / or true
    manager.handleEmergencyPowerStateChanges(
      makeLive(makeEps({ island: true, connectedToGrid: false })),
      { recoveredFromUnavailable: true },
    );

    assert.strictEqual(mock.started, 1);
    assert.strictEqual(mock.timeline.filter((t) => t.includes('island-started')).length, 1);
  });

  it('fires reserve-changed when reserveWh changes', () => {
    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);

    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ reserveWh: 1000 })));
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ reserveWh: 2000 })));

    assert.strictEqual(mock.reserveCalls, 1);
  });

  it('corrects easy-rscp island/invalidState tag swap', () => {
    // Simulate raw converter output (swapped tags as in easy-rscp 0.9.1):
    // island field holds IS_INVALID_STATE, invalidState field holds IS_ISLAND_GRID
    const rawFromEasyRscp = makeEps({ island: false, invalidState: true });
    const corrected = {
      ...rawFromEasyRscp,
      island: rawFromEasyRscp.invalidState,
      invalidState: rawFromEasyRscp.island,
    };
    assert.strictEqual(corrected.island, true);
    assert.strictEqual(corrected.invalidState, false);

    const mock = createMockDevice();
    const manager = new CapabilityManager(mock.device, {} as EnergyMeterIntegrator);
    manager.handleEmergencyPowerStateChanges(makeLive(makeEps({ island: false })));
    manager.handleEmergencyPowerStateChanges(makeLive(corrected));
    assert.strictEqual(mock.started, 1);
  });
});
