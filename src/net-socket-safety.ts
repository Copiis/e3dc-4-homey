/**
 * Globaler Schutz vor Homey-App-Crashes durch TCP-Fehler ohne 'error'-Listener.
 *
 * Node emittiert bei connect-Fehlern (z. B. EHOSTUNREACH) 'error' am Socket.
 * Ohne Listener → uncaughtException → Athom-Crash-Mail
 * (Stack oft nur: TCPConnectWrap.afterConnect).
 *
 * easy-rscp / andere Pfade können Listener zu spät setzen oder entfernen.
 * Dieser Patch stellt sicher, dass vor jedem connect() mindestens ein
 * no-op-Error-Listener hängt.
 *
 * Idempotent: mehrfaches import/install ist harmlos.
 */
import { Socket } from 'net';

const INSTALLED_KEY = '__e3dcNetSocketSafetyInstalled';

export function installNetSocketSafety(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[INSTALLED_KEY]) {
    return;
  }
  g[INSTALLED_KEY] = true;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const proto = Socket.prototype as any;
  const originalConnect = proto.connect as (...args: unknown[]) => Socket;

  proto.connect = function patchedConnect(this: Socket, ...args: unknown[]): Socket {
    if (this.listenerCount('error') === 0) {
      this.on('error', () => {
        /* absorbed — prevents uncaughtException / Homey crash mail */
      });
    }
    return originalConnect.apply(this, args);
  };
}

const OPERATIONAL_NAMES = new Set([
  'CONNECTION_TIMEOUT',
  'DISCONNECT',
  'READ_TIMEOUT',
]);

/** Bekannte „HKW offline / Timeout / Login abgelehnt“-Fehler (kein App-Bug). */
export function isBenignNetworkError(err: unknown): boolean {
  const e = err as NodeJS.ErrnoException & { name?: string };
  const code = e?.code ?? '';
  if (
    code === 'EHOSTUNREACH'
    || code === 'ENETUNREACH'
    || code === 'ECONNREFUSED'
    || code === 'ECONNRESET'
    || code === 'ETIMEDOUT'
    || code === 'EPIPE'
    || code === 'EAI_AGAIN'
    || code === 'ENOTFOUND'
  ) {
    return true;
  }
  const name = e?.name ?? '';
  if (OPERATIONAL_NAMES.has(name)) {
    return true;
  }
  const msg = String(e?.message ?? err ?? '');
  return /EHOSTUNREACH|ENETUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EPIPE|EAI_AGAIN|ENOTFOUND|CONNECTION_TIMEOUT|READ_TIMEOUT|Unable to establish an connection|No response from the home power station|Authentication failed/i
    .test(msg);
}
