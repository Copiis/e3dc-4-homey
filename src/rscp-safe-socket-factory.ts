import {Socket} from 'net';
import {E3dcConnectionData, SocketFactory} from 'easy-rscp';
import {normalizeError} from './utils/error-utils';

/**
 * Sichere SocketFactory als Workaround für easy-rscp.
 *
 * Problem: Bei Verbindungsfehlern (z.B. EHOSTUNREACH) wird der Connection-Timeout nicht immer gecleared.
 * Dadurch kann ein späteres 'error' Event ohne Listener kommen und die App crashen.
 *
 * Diese Factory stellt sicher, dass Timeouts gecleared werden, Listener entfernt und Fehler normalisiert werden.
 */
export class SafeSocketFactory implements SocketFactory {
    /**
     * Erstellt einen sicheren Socket mit Timeout-Handling und Error-Protection.
     * 
     * @param connectionData - Verbindungsdaten inkl. Timeout
     * @returns Promise mit dem Socket
     */
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