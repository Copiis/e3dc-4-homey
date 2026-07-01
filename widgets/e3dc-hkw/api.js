'use strict';

const {readHomePowerPlantsForHomey} = require('../../src/utils/home-power-plants.js');

module.exports = {
  async readHomePowerPlants({homey}) {
    return readHomePowerPlantsForHomey(homey);
  },

  async log({homey, body}) {
    return homey.app.logFromWidget(body.widget, body.message);
  },
};
