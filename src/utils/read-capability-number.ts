import Homey from 'homey';

function readRawCapabilityValue(device: Homey.Device, capability: string): unknown {
  let value = device.getCapabilityValue(capability);
  if (value != null) {
    return value;
  }
  const state = device.getState();
  if (state != null && Object.prototype.hasOwnProperty.call(state, capability)) {
    return state[capability];
  }
  return value;
}

export function readCapabilityNumber(device: Homey.Device, capability: string, fallback = 0): number {
  if (!device.hasCapability(capability)) {
    return fallback;
  }
  const value = readRawCapabilityValue(device, capability);
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return fallback;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}