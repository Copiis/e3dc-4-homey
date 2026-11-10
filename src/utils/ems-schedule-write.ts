import { EmsSchedule } from '../model/home-power-station';

/**
 * One writer at a time per Hauskraftwerk.
 * A widget and the schedule checker both change emsSchedules.
 * The change runs against the list that is stored at that moment.
 */
export interface EmsScheduleDevice {
  getData(): { id?: string };
  getSetting(key: string): unknown;
  setSettings(settings: { emsSchedules: string }): Promise<void>;
}

const tails = new Map<string, Promise<void>>();

function deviceKey(device: EmsScheduleDevice): string {
  return String(device.getData()?.id ?? '');
}

export function readEmsSchedules(device: EmsScheduleDevice): EmsSchedule[] {
  const raw = device.getSetting('emsSchedules');
  const json = typeof raw === 'string' && raw.trim() !== '' ? raw : '[]';
  try {
    const parsed: unknown = JSON.parse(json);
    return Array.isArray(parsed) ? parsed as EmsSchedule[] : [];
  } catch {
    return [];
  }
}

export function updateEmsSchedules(
  device: EmsScheduleDevice,
  change: (current: EmsSchedule[]) => EmsSchedule[],
): Promise<void> {
  const key = deviceKey(device);
  const previous = tails.get(key) ?? Promise.resolve();
  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const next = change(readEmsSchedules(device));
      await device.setSettings({ emsSchedules: JSON.stringify(next) });
    });
  tails.set(key, run.then(() => undefined, () => undefined));
  return run;
}
