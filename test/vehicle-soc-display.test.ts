import {describe, it} from 'node:test';
import assert from 'node:assert';
import {decideVehicleSocDisplay, isRscpOnlyVehicleSocMode} from '../src/utils/vehicle-soc-display';

describe('decideVehicleSocDisplay', () => {
  it('uses plausible RSCP regardless of mode', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 72,
      mode: 'rscp_only',
      lastSource: 'external',
      lastPlausibleSoc: 60,
    });
    assert.strictEqual(d.soc, 72);
    assert.strictEqual(d.source, 'local');
    assert.strictEqual(d.tryExternal, false);
  });

  it('rscp_only with E3DC 0 does not keep cloud fallback either', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      mode: 'rscp_only',
      lastSource: 'cloud',
      lastPlausibleSoc: 44,
    });
    assert.strictEqual(d.soc, 0);
    assert.strictEqual(d.source, 'local');
    assert.strictEqual(d.tryExternal, false);
  });

  it('rscp_only with E3DC 0 shows 0 and does not keep Homey-Auto', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      mode: 'rscp_only',
      lastSource: 'external',
      lastPlausibleSoc: 60,
    });
    assert.strictEqual(d.soc, 0);
    assert.strictEqual(d.source, 'local');
    assert.strictEqual(d.tryExternal, false);
  });

  it('rscp_only with missing RSCP writes 0 instead of keeping Homey-Auto last value', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: undefined,
      mode: 'rscp_only',
      lastSource: 'external',
      lastPlausibleSoc: 60,
    });
    assert.strictEqual(d.soc, 0);
    assert.strictEqual(d.source, 'local');
    assert.strictEqual(d.tryExternal, false);
  });

  it('rscp_only may keep last local RSCP when current poll has no value', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: undefined,
      mode: 'rscp_only',
      lastSource: 'local',
      lastPlausibleSoc: 81,
    });
    assert.strictEqual(d.soc, 81);
    assert.strictEqual(d.source, 'last_known');
    assert.strictEqual(d.tryExternal, false);
  });

  it('auto_homey_car with RSCP 0 keeps Homey-Auto and asks for external', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      mode: 'auto_homey_car',
      lastSource: 'external',
      lastPlausibleSoc: 60,
    });
    assert.strictEqual(d.soc, 60);
    assert.strictEqual(d.source, 'external');
    assert.strictEqual(d.tryExternal, true);
  });

  it('auto_homey_car with RSCP 0 and no Homey value shows last_known', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      mode: 'auto_homey_car',
      lastSource: 'last_known',
      lastPlausibleSoc: 55,
    });
    assert.strictEqual(d.soc, 55);
    assert.strictEqual(d.source, 'last_known');
    assert.strictEqual(d.tryExternal, true);
  });

  it('device mode with RSCP 0 tries external', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      mode: 'device',
      lastSource: 'none',
    });
    assert.strictEqual(d.soc, undefined);
    assert.strictEqual(d.source, 'none');
    assert.strictEqual(d.tryExternal, true);
  });

  it('missing mode defaults to auto_homey_car fallback', () => {
    const d = decideVehicleSocDisplay({
      rscpSoc: 0,
      lastSource: 'none',
    });
    assert.strictEqual(d.tryExternal, true);
  });

  it('isRscpOnlyVehicleSocMode is true only for rscp_only', () => {
    assert.strictEqual(isRscpOnlyVehicleSocMode('rscp_only'), true);
    assert.strictEqual(isRscpOnlyVehicleSocMode('auto_homey_car'), false);
    assert.strictEqual(isRscpOnlyVehicleSocMode('device'), false);
    assert.strictEqual(isRscpOnlyVehicleSocMode(undefined), false);
  });
});
