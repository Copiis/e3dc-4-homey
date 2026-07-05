/**
 * Hilfsfunktionen für E3/DC Portal-Werte zur Ladepriorisierung.
 * Wandeln Portal-String-Werte in bool um und unterstützen Legacy-Werte.
 */
export function isErlaubt(permission: unknown, legacyEnabled?: unknown): boolean {
    if (permission !== undefined && permission !== null && permission !== '') {
        return permission === 'erlaubt';
    }
    return !!legacyEnabled;
}

/**
 * Prüft ob "unterbunden" (nicht erlaubt).
 */
export function isUnterbunden(permission: unknown, legacyEnabled?: unknown): boolean {
    if (permission !== undefined && permission !== null && permission !== '') {
        return permission === 'unterbunden';
    }
    return !!legacyEnabled;
}

/**
 * Prüft ob "Batterie zuerst" Priorität aktiv ist.
 */
export function isBatteryFirst(priority: unknown, legacyEnabled?: unknown): boolean {
    if (priority !== undefined && priority !== null && priority !== '') {
        return priority === 'batterie_zuerst';
    }
    return !!legacyEnabled;
}