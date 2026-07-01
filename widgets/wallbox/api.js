'use strict';

const { readHomePowerPlantsForHomey } = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({ homey }) {
    return readHomePowerPlantsForHomey(homey);
  },

  async getWallboxStatus({ homey, query }) {
    const stationId = query.plantId || query.stationId;  // support both for compatibility
    if (!stationId) {
      return [];
    }

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    const results = [];
    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) {
        continue;
      }

      const name = wb.getName();
      const charging = wb.getCapabilityValue('wallbox_charging') === true;
      const sunMode = wb.getCapabilityValue('wallbox_sun_mode') === true;
      const power = wb.getCapabilityValue('measure_power') || 0;
      const solarShare = wb.getCapabilityValue('measure_wallbox_solarshare') || 0;

      results.push({
        id: wb.getData().id,
        name,
        charging,
        sunMode,
        power,
        solarShare,
      });
    }

    return results;
  },

  async toggle({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const type = body.type; // 'charging' or 'sunMode'

    if (!stationId || !type) {
      return { success: false, error: 'Missing stationId or type' };
    }

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) {
        continue;
      }

      if (type === 'charging') {
        const current = wb.getCapabilityValue('wallbox_charging') === true;
        await wb.applyChargingAllowed(!current);
      } else if (type === 'sunMode') {
        const current = wb.getCapabilityValue('wallbox_sun_mode') === true;
        await wb.applySunMode(!current);
      }

      // Only toggle the first matching wallbox
      break;
    }

    return { success: true };
  },

  async log({ homey, body }) {
    return homey.app.logFromWidget(body.widget, body.message);
  },
};