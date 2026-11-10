import { describe, it } from 'node:test';
import assert from 'node:assert';
import { EmsSchedule } from '../src/model/home-power-station';
import { updateEmsSchedules } from '../src/utils/ems-schedule-write';

function device() {
  let json = '[]';
  return {
    getData: () => ({ id: 'plant-1' }),
    getSetting: () => json,
    setSettings: async (settings: { emsSchedules: string }) => {
      await new Promise(resolve => setTimeout(resolve, 15));
      json = settings.emsSchedules;
    },
    read: () => JSON.parse(json) as EmsSchedule[],
  };
}

describe('updateEmsSchedules', () => {
  it('keeps both plans when two saves overlap', async () => {
    const plant = device();
    await Promise.all([
      updateEmsSchedules(plant, current => [...current, { id: 'a', mode: 'charge', start: '08:00' }]),
      updateEmsSchedules(plant, current => [...current, { id: 'b', mode: 'idle', start: '09:00' }]),
    ]);
    assert.deepStrictEqual(plant.read().map(plan => plan.id).sort(), ['a', 'b']);
  });

  it('does not put a removed plan back when another plan is added', async () => {
    const plant = device();
    await plant.setSettings({
      emsSchedules: JSON.stringify([
        { id: 'old', mode: 'charge', start: '08:00' },
        { id: 'keep', mode: 'idle', start: '09:00' },
      ]),
    });
    await Promise.all([
      updateEmsSchedules(plant, current => current.filter(plan => plan.id !== 'old')),
      updateEmsSchedules(plant, current => [...current, { id: 'new', mode: 'discharge', start: '10:00' }]),
    ]);
    assert.deepStrictEqual(plant.read().map(plan => plan.id).sort(), ['keep', 'new']);
  });
});
