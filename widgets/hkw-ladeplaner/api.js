'use strict';

const { readHomePowerPlantsForHomey } = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({ homey }) {
    return readHomePowerPlantsForHomey(homey);
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
    let schedules = body.schedules || [];

    if (!stationId) return { success: false, error: 'No plantId' };

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