export const MIN_MANUAL_CHARGE_WH = 200

export type AdditionalChargeError = 'invalid-percentage' | 'too-low' | 'no-capacity'

/**
 * Wh is sent as-is. Percent is a share of the usable battery capacity and is
 * converted into additional Wh (on top of the current charge, not a target SoC).
 * A missing unit stays Wh so existing flows keep their behaviour.
 */
export function resolveAdditionalChargeWh(
    amount: number,
    unit: string | undefined,
    capacityWh: number,
): { wh: number } | { error: AdditionalChargeError } {
    if (unit === 'percentage') {
        if (!Number.isFinite(amount) || amount < 0 || amount > 100) {
            return { error: 'invalid-percentage' }
        }
        if (!Number.isFinite(capacityWh) || capacityWh <= 0) {
            return { error: 'no-capacity' }
        }
        const wh = Math.round(capacityWh * (amount / 100))
        if (wh < MIN_MANUAL_CHARGE_WH) {
            return { error: 'too-low' }
        }
        return { wh }
    }

    if (!Number.isFinite(amount) || amount < MIN_MANUAL_CHARGE_WH) {
        return { error: 'too-low' }
    }
    return { wh: Math.round(amount) }
}
