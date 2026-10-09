import {WallboxCommandResult} from '../../model/wallbox';
import {deviceText} from '../../utils/device-i18n';

export function flowText(
    device: {translate?: (key: string, tags?: Record<string, string | number>) => string} | null | undefined,
    key: string,
    fallback: string,
): string {
    return deviceText(device, key, undefined, fallback);
}

export function resolveWallboxFlowResult(
    result: WallboxCommandResult,
    payload: Record<string, unknown>,
    rejectMessage: string,
    resolve: (value: unknown) => void,
    reject: (reason?: unknown) => void,
): void {
    if (!result.ok) {
        reject(rejectMessage);
        return;
    }
    if (result.skipped) {
        resolve({ ...payload, skipped: true, verified: false });
        return;
    }
    resolve({ ...payload, skipped: false, verified: true });
}