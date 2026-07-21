import {Socket} from 'net';
import {E3dcConnectionData, SocketFactory} from 'easy-rscp';
import {normalizeError} from './utils/error-utils';
import {installNetSocketSafety} from './net-socket-safety';

// Patch vor jeder Socket-Nutzung (auch falls app.ts-Import-Reihenfolge abweicht)
installNetSocketSafety();

/**
 * Sichere SocketFactory als Workaround für easy-rscp.
 *
 * Problem: Bei Verbindungsfehlern (z.B. EHOSTUNREACH) kann im DefaultSocketFactory
 * 'error' ohne Listener landen → uncaughtException → Homey-Crash-Mail
 * (Stack: TCPConnectWrap.afterConnect).
 *
 * Diese Factory:
 * - installiert globalen connect-Patch ({@link installNetSocketSafety})
 * - hält ab Socket-Erstellung dauerhaft Error-Listener (nie alle entfernen)
 * - cleared Timeouts bei Settlement
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

            // Permanent sink: bleibt immer — auch nach Settlement / destroy.
            // Zusätzlich zum globalen connect-Patch (doppelte Absicherung).
            const permanentSink = (_error: Error) => {
                /* absorbed */
            };
            newSocket.on('error', permanentSink);

            const settleReject = (reason: unknown) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                // permanentSink bleibt bewusst hängen
                try {
                    if (!newSocket.destroyed) {
                        newSocket.destroy();
                    }
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
            // Settlement-Listener zusätzlich zu permanentSink
            newSocket.on('error', onError);
            // Signature: connect(port, host, listener) — kompatibel zu @types/node
            newSocket.connect(connectionData.port, connectionData.address, () => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeoutId);
                // onError entfernen, permanentSink bleibt
                newSocket.removeListener('error', onError);
                resolve(newSocket);
            });
        });
    }
}
