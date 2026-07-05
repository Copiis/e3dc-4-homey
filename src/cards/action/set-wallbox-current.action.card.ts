import {RunListener} from '../run-listener';
import {Wallbox} from '../../model/wallbox';
import {formatError} from '../../utils/error-utils';

export class SetWallboxCurrentActionCard implements RunListener {
    run(args: Record<string, unknown>, state: Record<string, unknown>): Promise<unknown> {
        return new Promise<unknown>(async (resolve, reject) => {
            const wallbox: Wallbox = args.device as Wallbox;
            const current: number = (args.current as number) ?? 0;

            if (!wallbox || typeof wallbox.setCurrentLimit !== 'function') {
                reject('Invalid wallbox device');
                return;
            }

            wallbox.log && wallbox.log(`Setting wallbox current to ${current}A`);
            try {
                const ok = await wallbox.setCurrentLimit(current);
                if (ok) {
                    wallbox.log && wallbox.log('Wallbox current set successfully');
                    resolve({ current });
                } else {
                    reject('Wallbox rejected the command (check RSCP connection / permissions)');
                }
            } catch (e) {
                wallbox.error && wallbox.error('Failed to set wallbox current: ' + formatError(e));
                reject(e);
            }
        });
    }
}