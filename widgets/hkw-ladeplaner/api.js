'use strict';

const { readHomePowerPlantsForHomey, listHomePowerPlantIds } = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({ homey }) {
    return readHomePowerPlantsForHomey(homey);
  },

  async listPlants({ homey }) {
    return listHomePowerPlantIds(homey);
  },

  async getHkwSchedules({ homey, query }) {
    const stationId = query.plantId;
    if (!stationId) return { schedules: [] };

    const hpsDriver = homey.drivers.getDriver('home-power-station');
    const hps = hpsDriver.getDevices().find(d => String(d.getData().id) === String(stationId));

    if (!hps) return { schedules: [] };

    // Use emsSchedules for HKW power mode plans
    const json = hps.getSetting('emsSchedules') || '[]';
    let schedules = [];
    try { schedules = JSON.parse(json); } catch (e) { schedules = []; }

    // Filter only hps/hkw targeted schedules
    schedules = schedules.filter(s => !s.target || s.target === 'hps' || s.target === 'hkw');

    return { schedules };
  },

  async saveHkwSchedules({ homey, body }) {
    const stationId = body.plantId;
    const schedules = body.schedules;

    if (!stationId) return { success: false, error: 'No plantId' };
    if (!Array.isArray(schedules) || !hkwSchedulesValid(schedules)) {
      return { success: false, error: 'Invalid schedules' };
    }

    const hpsDriver = homey.drivers.getDriver('home-power-station');
    const hps = hpsDriver.getDevices().find(d => String(d.getData().id) === String(stationId));

    if (!hps) return { success: false, error: 'HKW not found' };

    // Merge with existing wallbox schedules if any
    const existingJson = hps.getSetting('emsSchedules') || '[]';
    let existing = [];
    try { existing = JSON.parse(existingJson); } catch (e) { existing = []; }

    // Keep wallbox schedules, replace hps ones
    const wallboxSchedules = existing.filter(s => s.target && s.target.startsWith('wallbox:'));
    const newSchedules = [...wallboxSchedules, ...schedules.map(s => ({ ...s, target: 'hps' }))];

    await hps.setSettings({ emsSchedules: JSON.stringify(newSchedules) });
    return { success: true };
  },

  async log({ homey, body }) {
    return homey.app.logFromWidget(body.widget, body.message);
  }
};

const HKW_MODES = new Set(['charge', 'discharge', 'grid_charge', 'gridcharge', 'idle']);

function hkwSchedulesValid(schedules) {
  return schedules.every(plan => plan && typeof plan === 'object' && hkwPlanValid(plan));
}

function hkwPlanValid(plan) {
  if (!HKW_MODES.has(String(plan.mode || ''))) return false;
  const power = typeof plan.powerW === 'number' ? plan.powerW : Number(plan.powerW);
  if (!Number.isFinite(power) || power < 0 || power > 20000) return false;
  if (!untilSocValid(plan.untilSoc)) return false;
  if (!isSensibleTime(plan.start)) return false;
  if (plan.end !== undefined && plan.end !== null && plan.end !== '' && !isSensibleTime(plan.end)) return false;
  return true;
}

function untilSocValid(value) {
  if (value === undefined || value === null || value === '') return true;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 100;
}

function isSensibleTime(value) {
  if (typeof value !== 'string') return false;
  const text = value.trim();
  const clock = /^(\d{2}):(\d{2})$/.exec(text);
  if (clock) {
    const hour = Number(clock[1]);
    const minute = Number(clock[2]);
    return hour <= 23 && minute <= 59;
  }
  const local = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.exec(text);
  if (!local) return false;
  const month = Number(local[2]);
  const day = Number(local[3]);
  const hour = Number(local[4]);
  const minute = Number(local[5]);
  const second = local[6] ? Number(local[6]) : 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return false;
  const dim = new Date(Number(local[1]), month, 0).getDate();
  return day <= dim;
}