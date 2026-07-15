import {describe, it, beforeEach} from 'node:test';
import assert from 'node:assert';
import {
  resolveExternalVehicleSoc,
  clearExternalVehicleSocCache,
  HomeyApiHost,
} from '../src/utils/external-vehicle-soc';

// Minimal fetch mock for unit tests
const originalFetch = globalThis.fetch;

function mockHomeyApi(devices: Record<string, unknown>): HomeyApiHost {
  return {
    api: {
      getOwnerApiToken: async () => 'test-token',
      getLocalUrl: async () => 'http://127.0.0.1:80',
    },
  };
}

function installFetchMock(payload: unknown, status = 200): void {
  globalThis.fetch = (async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })) as unknown as typeof fetch;
}

describe('resolveExternalVehicleSoc (Homey Web API)', () => {
  beforeEach(() => {
    clearExternalVehicleSocCache();
  });

  it('returns undefined for rscp_only without calling API', async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return {ok: true, status: 200, json: async () => ({})} as unknown as Response;
    }) as unknown as typeof fetch;
    const hit = await resolveExternalVehicleSoc(mockHomeyApi({}), {mode: 'rscp_only'});
    assert.strictEqual(hit, undefined);
    assert.strictEqual(called, false);
    globalThis.fetch = originalFetch;
  });

  it('auto picks class=car measure_battery', async () => {
    installFetchMock({
      irr: {
        id: 'irr',
        name: 'Ventil',
        class: 'other',
        capabilitiesObj: {measure_battery: {value: 100}},
      },
      tesla: {
        id: 'tesla',
        name: 'Grauer Wolf',
        class: 'car',
        capabilitiesObj: {measure_battery: {value: 76.8}},
      },
    });
    const hit = await resolveExternalVehicleSoc(mockHomeyApi({}), {mode: 'auto_homey_car'});
    assert.ok(hit);
    assert.strictEqual(hit!.deviceId, 'tesla');
    assert.strictEqual(hit!.socPercent, 77);
    globalThis.fetch = originalFetch;
  });

  it('ignores non-car devices in auto mode', async () => {
    installFetchMock({
      bat: {
        id: 'bat',
        name: 'Hausakku',
        class: 'battery',
        capabilitiesObj: {measure_battery: {value: 36}},
      },
    });
    const hit = await resolveExternalVehicleSoc(mockHomeyApi({}), {mode: 'auto_homey_car'});
    assert.strictEqual(hit, undefined);
    globalThis.fetch = originalFetch;
  });

  it('device mode uses configured id', async () => {
    installFetchMock({
      a: {
        id: 'a',
        name: 'A',
        class: 'car',
        capabilitiesObj: {measure_battery: {value: 10}},
      },
      b: {
        id: 'b',
        name: 'B',
        class: 'car',
        capabilitiesObj: {measure_battery: {value: 90}},
      },
    });
    const hit = await resolveExternalVehicleSoc(mockHomeyApi({}), {
      mode: 'device',
      deviceId: 'b',
      capabilityId: 'measure_battery',
    });
    assert.ok(hit);
    assert.strictEqual(hit!.socPercent, 90);
    assert.strictEqual(hit!.deviceId, 'b');
    globalThis.fetch = originalFetch;
  });

  it('rejects implausible 0%', async () => {
    installFetchMock({
      tesla: {
        id: '1',
        name: 'Tesla',
        class: 'car',
        capabilitiesObj: {measure_battery: {value: 0}},
      },
    });
    const hit = await resolveExternalVehicleSoc(mockHomeyApi({}), {mode: 'auto_homey_car'});
    assert.strictEqual(hit, undefined);
    globalThis.fetch = originalFetch;
  });
});
