/** Effective wallbox charging power (W) from RSCP EXTERN_DATA blocks. */
export function resolveWallboxPowerW(state: {
    powerW: number;
    solarPowerW: number;
    gridPowerW?: number;
}): number {
    const all = Number(state.powerW) || 0;
    const sun = Math.max(0, Number(state.solarPowerW) || 0);
    const net = Math.max(0, Number(state.gridPowerW) || 0);
    const sunPlusNet = sun + net;

    if (all > 0) {
        return all;
    }
    if (sunPlusNet > 0) {
        return sunPlusNet;
    }
    return 0;
}