import {ValueChanged} from '../model/value-changed';
import {Device} from 'homey';
import {formatError} from './error-utils';

export function updateCapabilityValue<T>(id: string, newValue: T, device: Device): ValueChanged<T> | undefined {
    if (device.hasCapability(id)) {
        return executeUpdateCapabilityValue(id, newValue, device)
    }
    else {
        device.log('Capability ' + id + ' not found on device. Adding it ...')
        device.addCapability(id)
            .then(value => executeUpdateCapabilityValue(id, newValue, device))
            .catch(reason => {
                device.error('Adding of capability ' + id + ' failed: ' + formatError(reason))
            })
        return undefined
    }
}

function executeUpdateCapabilityValue<T>(id: string, newValue: T, device: Device): ValueChanged<T> | undefined {
    const oldValue = device.getCapabilityValue(id);
    if (newValue !== oldValue) {
        device.log(device.getName() + ": setting new value for " + id)
        device.setCapabilityValue(id, newValue).catch(reason => {
            device.error(`setCapabilityValue(${id}) failed: ${formatError(reason)}`)
        })
        return {
            oldValue: oldValue,
            newValue: newValue
        }
    } else {
        // no change - intentionally silent to avoid log spam on every 20s sync
        return undefined
    }
}
