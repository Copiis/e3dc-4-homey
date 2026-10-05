import {MeterSeries, houseWithoutWallboxFromSeries} from './house-without-wallbox';

export const HOUSE_FORECAST_CAPABILITY = 'measure_house_consumption_forecast';
/** Completed local days before today. Today itself stays out. */
export const HOUSE_FORECAST_DAY_COUNT = 14;
export const HOUSE_FORECAST_REFRESH_MS = 60 * 60 * 1000;
/** A day this far under the raw mean leaves the mean. */
export const HOUSE_FORECAST_LOW_KWH = 3;
export const HOUSE_FORECAST_LOW_RATIO = 0.75;
/** A day this far over the cleaned mean counts as high. */
export const HOUSE_FORECAST_HIGH_KWH = 3;
export const HOUSE_FORECAST_HIGH_RATIO = 1.25;
/** After dropping low days, fewer than this keeps the raw mean. */
export const HOUSE_FORECAST_MIN_DAYS_AFTER_TRIM = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Expected house consumption for the current day, kWh, without the wallbox.
 *
 * `days` is chronological, oldest first. The last entry is yesterday.
 * `null` is a dropped day (missing wallbox counter). It stays out of the mean
 * and cannot lift the forecast.
 *
 * Low days (more than 3 kWh under the raw mean, or under 75 % of it) leave
 * the mean. The mean is recomputed once. If fewer than 7 days remain, the
 * raw mean stands.
 *
 * Only yesterday can raise the result. If it is high against the cleaned mean
 * (more than 3 kWh over, or over 125 %), half the gap is added. If one of the
 * two calendar days before yesterday is high as well, the result is yesterday.
 */
export function forecastHouseConsumptionKwh(days: ReadonlyArray<number | null>): number | null {
  const valid = days.filter((value): value is number => value != null && Number.isFinite(value) && value >= 0);
  if (valid.length === 0) {
    return null;
  }

  const rawMean = mean(valid);
  const kept = valid.filter(value => !isLowDay(value, rawMean));
  const cleanedMean = kept.length >= HOUSE_FORECAST_MIN_DAYS_AFTER_TRIM ? mean(kept) : rawMean;

  const yesterday = days.length > 0 ? days[days.length - 1] : null;
  if (yesterday == null || !Number.isFinite(yesterday) || !isHighDay(yesterday, cleanedMean)) {
    return cleanedMean;
  }

  const dayBefore = days.length >= 2 ? days[days.length - 2] : null;
  const twoBefore = days.length >= 3 ? days[days.length - 3] : null;
  const priorHigh = [dayBefore, twoBefore].some(value =>
    value != null && Number.isFinite(value) && isHighDay(value, cleanedMean));
  if (priorHigh) {
    return yesterday;
  }
  return cleanedMean + (yesterday - cleanedMean) / 2;
}

export function isLowDay(value: number, rawMean: number): boolean {
  return value < rawMean - HOUSE_FORECAST_LOW_KWH || value < rawMean * HOUSE_FORECAST_LOW_RATIO;
}

export function isHighDay(value: number, cleanedMean: number): boolean {
  return value > cleanedMean + HOUSE_FORECAST_HIGH_KWH || value > cleanedMean * HOUSE_FORECAST_HIGH_RATIO;
}

/**
 * House kWh of one closed local day. Empty `seriesList` means this station
 * has no wallbox, so the history total is already the house. A missing
 * wallbox counter returns null and the day drops out of the forecast.
 */
export function closedDayHouseKwh(totalWh: number, seriesList: MeterSeries[], start: Date): number | null {
  const totalKwh = totalWh / 1000;
  if (!Number.isFinite(totalKwh)) {
    return null;
  }
  if (seriesList.length === 0) {
    return Math.max(0, totalKwh);
  }
  const end = new Date(start.getTime() + DAY_MS);
  return houseWithoutWallboxFromSeries(totalKwh, seriesList, {start, end, open: false}, end.getTime());
}

function mean(values: number[]): number {
  let sum = 0;
  for (const value of values) {
    sum += value;
  }
  return sum / values.length;
}
