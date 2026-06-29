import {Socket} from 'net';
import {E3dcConnectionData, SocketFactory} from 'easy-rscp';
import {normalizeError} from './utils/error-utils';

/**
 * Workaround for easy-rscp DefaultSocketFactory: on connect failure the connection
 * timeout is not cleared, so destroy() can emit a late socket 'error' without a
 * listener and crash the Homey app process (e.g. EHOSTUNREACH).
 */
export class SafeSocketFactory implements SocketFactory {
    createSocket(connectionData: E3dcConnectionData): Promise<Socket> {
        return new Promise((resolve, reject) => {
            const newSocket = new Socket();
            let settled = false;
            const connectionTimeout = connectionData.connectionTimeoutMillis ?? 5000;

            const settleReject = (reason: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                newSocket.removeListener('error', onError);
                newSocket.on('error', () => undefined);
                try {
                    newSocket.destroy();
                } catch {
                    /* ignore */
                }
                reject(normalizeError(reason));
            };

            const onError = (error: Error) => settleReject(error);

            const timeoutId = setTimeout(() => {
                settleReject({
                    name: 'CONNECTION_TIMEOUT',
                    message: 'Unable to establish an connection to '
                        + connectionData.address + ':' + connectionData.port
                        + ' within the configured timeout of '
                        + connectionTimeout + 'ms',
                });
            }, connectionTimeout);

            newSocket.setKeepAlive(true);
            newSocket.on('error', onError);
            newSocket.connect(connectionData.port, connectionData.address, () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                newSocket.removeListener('error', onError);
                resolve(newSocket);
            });
        });
    }
}