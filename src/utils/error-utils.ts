/**
 * Nur Name + Message (kein Stack). Für erwartete Netzwerkfehler und Homey-Logs,
 * die bei `this.error(...stack...)` sonst als „Crash“ gemeldet werden.
 */
export function formatErrorMessage(reason: unknown): string {
    if (reason instanceof Error) {
        const name = reason.name && reason.name !== 'Error' ? reason.name : '';
        return name ? `${name}: ${reason.message}` : reason.message;
    }
    if (typeof reason === 'string') {
        return reason;
    }
    if (reason === null || reason === undefined) {
        return String(reason);
    }
    if (typeof reason === 'object') {
        const record = reason as Record<string, unknown>;
        if (typeof record.message === 'string') {
            const name = typeof record.name === 'string' ? record.name : 'Error';
            return `${name}: ${record.message}`;
        }
    }
    try {
        return JSON.stringify(reason);
    } catch {
        return String(reason);
    }
}

/**
 * Erzeugt einen lesbaren String für Logs und Homey.error().
 * Vermeidet "[object Object]" bei Errors oder plain Objects.
 * Stack nur bei echten Bugs — für Netzwerkfehler {@link formatErrorMessage} nutzen
 * oder `includeStack: false`.
 */
export function formatError(reason: unknown, options?: { includeStack?: boolean }): string {
    const includeStack = options?.includeStack !== false;
    if (reason instanceof Error) {
        if (!includeStack) {
            return formatErrorMessage(reason);
        }
        const stack = reason.stack?.trim();
        return stack ? `${reason.message}\n${stack}` : reason.message;
    }
    return formatErrorMessage(reason);
}

/**
 * Konvertiert plain-object Rejections (von easy-rscp oder Socket) in echte Error-Objekte.
 * Wird benötigt, damit Homey die Fehler korrekt im UI anzeigt.
 *
 * Synthetische Netzwerk-Timeouts bekommen einen kurzen Stack (nur Message-Zeile),
 * damit Athom-Diagnose nicht `normalizeError`/`settleReject` als „Crash-Ort“ zeigt.
 */
export function normalizeError(reason: unknown): Error {
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === 'string') {
        return new Error(reason);
    }
    if (typeof reason === 'object' && reason !== null) {
        const record = reason as Record<string, unknown>;
        if (typeof record.message === 'string') {
            const err = new Error(record.message);
            if (typeof record.name === 'string') {
                err.name = record.name;
            }
            // Synthetic connect failures: no internal factory frames in crash mails
            if (err.name === 'CONNECTION_TIMEOUT' || err.name === 'DISCONNECT') {
                err.stack = `${err.name}: ${err.message}`;
            }
            return err;
        }
    }
    return new Error(formatErrorMessage(reason));
}

/**
 * Hilfsfunktion zum Rejecten mit normalisiertem Error.
 * Verwendet normalizeError intern.
 */
export function rejectAsError(reject: (reason?: unknown) => void, reason: unknown): void {
    reject(normalizeError(reason));
}