import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DiagnosticManager } from '../src/managers/diagnostic-manager';

describe('DiagnosticManager', () => {
  it('can be instantiated', () => {
    const mockDevice = {
      getSetting: () => false,
      getStoreValue: () => [],
      setStoreValue: () => Promise.resolve(),
      getName: () => 'test',
      getId: () => 'id',
      getAvailable: () => true,
      syncErrorCount: 0,
      homey: { manifest: { version: '1.0' }, setTimeout: () => 0 },
      log: () => {},
      error: () => {},
    } as any;
    const manager = new DiagnosticManager(mockDevice, 'key');
    assert.ok(manager);
  });

  it('handles record sync success/failure', () => {
    const mockDevice = {
      getSetting: () => false,
      getStoreValue: () => [],
      setStoreValue: () => Promise.resolve(),
      getName: () => 'test',
      getId: () => 'id',
      getAvailable: () => true,
      syncErrorCount: 0,
      homey: { manifest: { version: '1.0' }, setTimeout: () => 0 },
      log: () => {},
      error: () => {},
    } as any;
    const manager = new DiagnosticManager(mockDevice, 'key');
    manager.recordSyncSuccess({ pvDelivery: 100 } as any);
    manager.recordSyncFailure('test error');
    assert.ok(true);
  });
});
