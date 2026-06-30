import {WallboxCommandResult} from '../../model/wallbox';

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