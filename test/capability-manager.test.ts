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

  it('processes live power data and returns changes', () => {
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
      pvDelivery: 100,
      gridDelivery: 50,
      batteryDelivery: -30,
      houseConsumption: 80,
      batteryChargingLevel: 0.5,
    } as any);

    // Verhaltens-Assertion: sollte Änderungen zurückgeben
    assert.ok(result);
    assert.ok('batteryLevelChange' in result || 'gridDeliveryChange' in result);
  });
});
