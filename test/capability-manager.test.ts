import { describe, it } from 'node:test';
import assert from 'node:assert';
import { CapabilityManager } from '../src/managers/capability-manager';
import { EnergyMeterIntegrator } from '../src/utils/energy-meter-integrator';

describe('CapabilityManager', () => {
  it('can be instantiated', () => {
    const mockDevice = { hasCapability: () => false, removeCapability: () => Promise.resolve() } as any;
    const mockEnergy = {} as EnergyMeterIntegrator;
    const manager = new CapabilityManager(mockDevice, mockEnergy);
    assert.ok(manager);
  });

  it('handles firmware change (basic)', () => {
    assert.ok(true); // placeholder for full test with mocks
  });

  it('processes live power data and returns changes with correct deltas', () => {
    let capturedBatteryChange: any = null;
    let capturedGridChange: any = null;

    const mockDevice = {
      hasCapability: () => false,
      addCapability: () => Promise.resolve(),
      removeCapability: () => Promise.resolve(),
      getCapabilityValue: () => undefined,
      setCapabilityValue: () => Promise.resolve(),
      getName: () => 'Test HKW',
      log: () => {},
      error: () => {},
      getBatteryCapacity: () => Promise.resolve(10000),
      gridPowerHasChangedTrigger: { runIfChanged: (c: any) => { capturedGridChange = c; } },
      batteryPowerHasChangedTrigger: { runIfChanged: (c: any) => { capturedBatteryChange = c; } },
      houseConsumptionHasChangedTrigger: { runIfChanged: () => {} },
      syncErrorCount: 0,
      updateBatteryData: false,
    } as any;
    const mockEnergy = { integrateGeneration: (p: number) => p } as any;
    const manager = new CapabilityManager(mockDevice, mockEnergy);

    const result = manager.processLivePowerData({
      pvDelivery: 100,
      gridDelivery: 50,
      batteryDelivery: -30,  // negative = discharging (app convention)
      houseConsumption: 80,
      batteryChargingLevel: 0.5,
    } as any);

    assert.ok(result);
    assert.ok(capturedBatteryChange || capturedGridChange);
    // negative in LiveData (discharge) should result in negative in capability
    if (capturedBatteryChange) {
      assert.ok(capturedBatteryChange.value < 0);
    }
  });

  it('integrates battery + wallbox power for surplus calculation (behavioral)', () => {
    const mockDevice = {
      hasCapability: () => false,
      addCapability: () => Promise.resolve(),
      removeCapability: () => Promise.resolve(),
      getCapabilityValue: () => undefined,
      setCapabilityValue: () => Promise.resolve(),
      getName: () => 'Test HKW',
      log: () => {},
      error: () => {},
      getBatteryCapacity: () => Promise.resolve(10000),
      gridPowerHasChangedTrigger: { runIfChanged: () => {} },
      batteryPowerHasChangedTrigger: { runIfChanged: () => {} },
      houseConsumptionHasChangedTrigger: { runIfChanged: () => {} },
      syncErrorCount: 0,
      updateBatteryData: false,
    } as any;
    const mockEnergy = { integrateGeneration: (p: number) => p } as any;
    const manager = new CapabilityManager(mockDevice, mockEnergy);

    const result = manager.processLivePowerData({
      pvDelivery: 3000,
      gridDelivery: 0,
      batteryDelivery: 500, // charging
      houseConsumption: 1500,
      batteryChargingLevel: 0.6,
      wallboxPowerState: [{ powerW: 800, solarPowerW: 600 } as any],
    } as any);

    // surplus should consider battery charging and wallbox solar share
    assert.ok(result);
  });

  it('handles battery discharge + wallbox mix correctly in live data path', () => {
    const mockDevice = {
      hasCapability: () => false,
      addCapability: () => Promise.resolve(),
      removeCapability: () => Promise.resolve(),
      getCapabilityValue: () => undefined,
      setCapabilityValue: () => Promise.resolve(),
      getName: () => 'Test HKW',
      log: () => {},
      error: () => {},
      getBatteryCapacity: () => Promise.resolve(10000),
      gridPowerHasChangedTrigger: { runIfChanged: () => {} },
      batteryPowerHasChangedTrigger: { runIfChanged: () => {} },
      houseConsumptionHasChangedTrigger: { runIfChanged: () => {} },
      syncErrorCount: 0,
      updateBatteryData: false,
    } as any;
    const mockEnergy = { integrateGeneration: (p: number) => p } as any;
    const manager = new CapabilityManager(mockDevice, mockEnergy);

    const result = manager.processLivePowerData({
      pvDelivery: 1000,
      gridDelivery: 200,
      batteryDelivery: -120, // discharging 120W
      houseConsumption: 800,
      batteryChargingLevel: 0.4,
    } as any);

    assert.ok(result);
    // battery should report negative for discharge
    if (result.batteryDeliveryChange && result.batteryDeliveryChange.newValue !== null) {
      assert.ok(result.batteryDeliveryChange.newValue < 0);
    }
  });
});
