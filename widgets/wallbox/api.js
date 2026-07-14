'use strict';

const { readHomePowerPlantsForHomey } = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({ homey }) {
    return readHomePowerPlantsForHomey(homey);
  },

  async _invalidateEmsCache(homey, stationId) {
    try {
      const hpsDriver = homey.drivers.getDriver('home-power-station');
      const hpsList = hpsDriver.getDevices();
      for (const hps of hpsList) {
        if (typeof hps.ready === 'function') {
          await hps.ready();
        }
        const hpsData = typeof hps.getData === 'function' ? hps.getData() : {};
        const hpsId = hpsData.id || (typeof hps.getId === 'function' ? hps.getId() : null);
        if (String(hpsId) === String(stationId)) {
          if (hps.wallboxManager && typeof hps.wallboxManager.invalidateEmsSettingsCache === 'function') {
            hps.wallboxManager.invalidateEmsSettingsCache();
          }
          break;
        }
      }
    } catch (e) {
      // ignore
    }
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

      // Force fresh EMS settings read so Ladepriorisierung (priority, sun discharge, mix) are up to date
      // This bypasses the 5min cache in wallbox-manager for widget users
      try {
        if (typeof wb.refreshEmsSettings === 'function') {
          await wb.refreshEmsSettings();
        }
      } catch (e) {
        // non-fatal
      }

      const name = wb.getName();
      const charging = wb.getCapabilityValue('wallbox_charging') === true;
      const sunMode = wb.getCapabilityValue('wallbox_sun_mode') === true;
      const power = wb.getCapabilityValue('measure_power') || 0;
      const solarShare = wb.getCapabilityValue('measure_wallbox_solarshare') || 0;
      const vehicleSoc = wb.getCapabilityValue('measure_vehicle_soc');
      const dischargeSoc = wb.getCapabilityValue('measure_wallbox_discharge_soc');
      const plugged = wb.getCapabilityValue('wallbox_plugged');
      const maxCurrent = wb.getCapabilityValue('measure_wallbox_max_current');
      const phases = wb.getCapabilityValue('measure_wallbox_phases');
      const plugLocked = wb.getCapabilityValue('wallbox_plug_locked');
      const schuko = wb.getCapabilityValue('wallbox_schuko');
      const priorityBatteryFirst = wb.getCapabilityValue('wallbox_priority_battery_first');
      const batteryDischargeSun = wb.getCapabilityValue('wallbox_battery_discharge_sun');
      const batteryDischargeMix = wb.getCapabilityValue('wallbox_battery_discharge_mix');

      results.push({
        id: wb.getData().id,
        name,
        charging,
        sunMode,
        power,
        solarShare,
        vehicleSoc,
        dischargeSoc,
        plugged,
        maxCurrent,
        phases,
        plugLocked,
        schuko,
        priorityBatteryFirst,
        batteryDischargeSun,
        batteryDischargeMix,
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

  async setMaxCurrent({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const maxCurrentA = parseInt(body.maxCurrentA, 10);

    if (!stationId || !maxCurrentA || maxCurrentA < 6 || maxCurrentA > 32) {
      return { success: false, error: 'Invalid stationId or maxCurrentA (6-32)' };
    }

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) {
        continue;
      }

      try {
        await wb.setCurrentLimit(maxCurrentA);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }

    return { success: false, error: 'Wallbox not found for station' };
  },

  async setDischargeUntil({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const percent = parseInt(body.percent, 10);

    if (!stationId || isNaN(percent) || percent < 0 || percent > 100) {
      return { success: false, error: 'Invalid stationId or percent (0-100)' };
    }

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) {
        continue;
      }

      try {
        await wb.setDischargeBatteryUntil(percent);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }

    return { success: false, error: 'Wallbox not found for station' };
  },

  async setPriority({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const batteryFirst = !!body.batteryFirst;
    if (!stationId) return { success: false, error: 'Missing stationId' };

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) continue;
      try {
        await wb.setBatteryBeforeCar(batteryFirst);
        // Optimistic update so the widget sees the new value immediately
        wb.setCapabilityValue('wallbox_priority_battery_first', batteryFirst);
        await this._invalidateEmsCache(homey, stationId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }
    return { success: false, error: 'Wallbox not found for station' };
  },

  async setBatteryDischargeSun({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const allowed = !!body.allowed;
    if (!stationId) return { success: false, error: 'Missing stationId' };

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) continue;
      try {
        await wb.setBatteryToCar(allowed);
        wb.setCapabilityValue('wallbox_battery_discharge_sun', allowed);
        await this._invalidateEmsCache(homey, stationId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }
    return { success: false, error: 'Wallbox not found for station' };
  },

  async setBatteryDischargeMix({ homey, body }) {
    const stationId = body.stationId || body.plantId;
    const allowed = !!body.allowed;
    if (!stationId) return { success: false, error: 'Missing stationId' };

    const wallboxDriver = homey.drivers.getDriver('wallbox');
    const allWallboxes = wallboxDriver.getDevices();

    for (const wb of allWallboxes) {
      await wb.ready();
      const settings = wb.getStoreValue('settings');
      if (!settings || String(settings.stationId) !== String(stationId)) continue;
      try {
        // setDisableBatteryAtMixMode(true) = block (Unterbunden)
        await wb.setDisableBatteryAtMixMode(!allowed);
        // Optimistic: capability true means allowed (Erlaubt)
        wb.setCapabilityValue('wallbox_battery_discharge_mix', allowed);
        await this._invalidateEmsCache(homey, stationId);
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message || String(e) };
      }
    }
    return { success: false, error: 'Wallbox not found for station' };
  },
};