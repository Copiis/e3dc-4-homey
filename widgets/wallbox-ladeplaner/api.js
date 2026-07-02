'use strict';

const { readHomePowerPlantsForHomey } = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({ homey }) {
    return readHomePowerPlantsForHomey(homey);
  },

  async getWallboxes({ homey, query }) {
    const stationId = query.plantId;
    if (!stationId) return [];

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const all = wallboxDriver.getDevices();

    const results = [];
    for (const wb of all) {
      await wb.ready();
      const settings = wb.getStoreValue('settings') || {};
      if (String(settings.stationId) === String(stationId)) {
        results.push({
          id: wb.getData().id,
          name: wb.getName(),
          stationId: settings.stationId
        });
      }
    }
    return results;
  },

  async getWallboxSchedules({ homey, query }) {
    const wallboxId = query.wallboxId;
    if (!wallboxId) return { schedules: [] };

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const wb = wallboxDriver.getDevices().find(d => String(d.getData().id) === String(wallboxId));

    if (!wb) return { schedules: [] };

    const json = wb.getSetting('schedules') || '[]';  // per wallbox
    let schedules = [];
    try { schedules = JSON.parse(json); } catch (e) { schedules = []; }

    return { schedules: Array.isArray(schedules) ? schedules : [] };
  },

  async saveWallboxSchedules({ homey, body }) {
    const wallboxId = body.wallboxId;
    const schedules = body.schedules || [];

    if (!wallboxId) return { success: false, error: 'No wallboxId' };

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const wb = wallboxDriver.getDevices().find(d => String(d.getData().id) === String(wallboxId));

    if (!wb) return { success: false, error: 'Wallbox not found' };

    await wb.setSettings({ schedules: JSON.stringify(schedules) });
    return { success: true };
  },

  async log({ homey, body }) {
    return homey.app.logFromWidget(body.widget, body.message);
  }
};