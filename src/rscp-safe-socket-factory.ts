import {Socket} from 'net';
import {E3dcConnectionData, SocketFactory} from 'easy-rscp';
import {normalizeError} from './utils/error-utils';

/**
 * Sichere SocketFactory als Workaround für easy-rscp.
 *
 * Problem: Bei Verbindungsfehlern (z.B. EHOSTUNREACH) wird im DefaultSocketFactory
 * der Connection-Timeout nicht immer gecleared. Danach kann destroy() ein weiteres
 * 'error' Event ohne Listener auslösen und die Homey-App crashen
 * (Stack: TCPConnectWrap.afterConnect).
 *
 * Diese Factory:
 * - hält ab Socket-Erstellung dauerhaft mindestens einen Error-Listener (kein uncaughtException)
 * - cleared Timeouts bei jedem Settlement
 * - normalisiert Fehler für Promise-Ablehnung
 *
 * Wird beim Erstellen der RscpApi verwendet (siehe rscp-api.ts).
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

            // Permanent sink: Socket darf nie ohne 'error'-Listener enden
            // (Handoff-Lücke zu easy-rscp, späte destroy-Fehler, Doppel-Events).
            const permanentSink = (_error: Error) => {
                /* absorbed — settlement handler or connection layer handles logic */
            };
            newSocket.on('error', permanentSink);

            const settleReject = (reason: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                newSocket.removeListener('error', onError);
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
                // permanentSink bleibt — schützt die Mikro-Lücke bis easy-rscp
                // seinen eigenen error-Listener setzt, und späte destroy-Fehler.
                resolve(newSocket);
            });
        });
    }
}
