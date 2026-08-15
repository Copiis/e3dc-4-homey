#!/usr/bin/env node
// Promote the just-uploaded Homey build to the Athom *test* channel.
// homey app publish only creates a draft; live apps stay on draft until this step.
'use strict';

const fs = require('fs');
const path = require('path');

const APP_ID = 'de.jnkconsulting.e3dc.v2';
const CHANNEL = 'test';
const POLL_MS = 10000;
const MAX_WAIT_MS = 10 * 60 * 1000;

const HOMEY_PAT = process.env.HOMEY_PAT;
if (!HOMEY_PAT) {
  console.error('HOMEY_PAT is missing');
  process.exit(1);
}

function readAppVersion() {
  const composePath = path.join(process.cwd(), '.homeycompose', 'app.json');
  const appPath = path.join(process.cwd(), 'app.json');
  const raw = fs.existsSync(composePath)
    ? fs.readFileSync(composePath, 'utf8')
    : fs.readFileSync(appPath, 'utf8');
  const version = JSON.parse(raw).version;
  if (!version) throw new Error('Could not read app version');
  return version;
}

function summarize(build) {
  if (!build) return null;
  return {
    id: build.id,
    version: build.version,
    state: build.state,
    createdAt: build.createdAt,
  };
}

(async () => {
  const { AthomCloudAPI, AthomAppsAPI } = require('homey-api');
  const AthomCloudAPIToken = require('homey-api/lib/AthomCloudAPI/Token');

  const version = readAppVersion();
  const api = new AthomCloudAPI({
    clientId: process.env.ATHOM_API_CLIENT_ID || '64691b4358336640a5ecee5c',
    clientSecret: process.env.ATHOM_API_CLIENT_SECRET || 'ed09f559ae12b1522d00431f0bf7c5755603c41e',
    autoRefreshTokens: false,
    token: new AthomCloudAPIToken({ access_token: HOMEY_PAT }),
  });

  const loggedIn = await api.isLoggedIn();
  if (!loggedIn) {
    throw new Error('HOMEY_PAT is not accepted by Athom (not logged in)');
  }

  const appsToken = await api.createDelegationToken({ audience: 'apps' });
  const apps = new AthomAppsAPI();

  const deadline = Date.now() + MAX_WAIT_MS;
  let build;

  while (Date.now() < deadline) {
    const builds = await apps.getBuilds({
      appId: APP_ID,
      $token: appsToken,
      $timeout: 30000,
    });
    const list = Array.isArray(builds) ? builds : [];
    const matches = list
      .filter((item) => item && item.version === version)
      .sort((a, b) => Number(b.id) - Number(a.id));
    build = matches[0];

    if (build) {
      console.log('Found build', JSON.stringify(summarize(build)));
      if (build.state && /process|upload|pending|queued/i.test(String(build.state))) {
        console.log('Build still processing, waiting…');
      } else {
        break;
      }
    } else {
      console.log(`No build for ${version} yet, waiting…`);
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }

  if (!build) {
    throw new Error(`Timed out waiting for Athom build ${APP_ID}@${version}`);
  }

  if (build.state === 'live') {
    throw new Error(
      `Build ${build.id} (${version}) is already live — refusing to change the production channel`,
    );
  }

  if (build.state === CHANNEL || build.state === 'test') {
    console.log(`Build ${build.id} is already on the test channel`);
    console.log(`https://tools.developer.homey.app/apps/app/${APP_ID}/build/${build.id}`);
    console.log('https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/test/');
    return;
  }

  const result = await apps.updateBuildChannel({
    appId: APP_ID,
    buildId: String(build.id),
    channel: CHANNEL,
    $token: appsToken,
    $timeout: 30000,
  });
  console.log('updateBuildChannel', JSON.stringify(summarize(result) || result));
  console.log(`Promoted build ${build.id} (${version}) to test`);
  console.log(`https://tools.developer.homey.app/apps/app/${APP_ID}/build/${build.id}`);
  console.log('https://homey.app/de-de/app/de.jnkconsulting.e3dc.v2/E3DC---HKW/test/');
})().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
