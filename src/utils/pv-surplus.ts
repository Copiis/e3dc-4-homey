/**
 * Estimates PV surplus available for EMS (wallbox, heat pump, etc.).
 * PV minus house consumption minus battery charging power (batteryPower > 0 means charging, matches E3DC sign).
 */
export function calculatePvSurplusW(pvPowerW: number, houseConsumptionW: number, batteryPowerW: number): number {
  const batteryChargeW = Math.max(0, batteryPowerW);
  return Math.max(0, pvPowerW - houseConsumptionW - batteryChargeW);
}