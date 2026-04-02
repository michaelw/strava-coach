#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const {
  RAW_CAPTURE_ROOT,
  STRAVA_AUTH_PATH,
  ensureDir,
  readJson,
  timestampForFile,
  writeJson,
} = require('./common.cjs');

const STRAVA_AUTH_URL = 'https://www.strava.com/oauth/authorize';
const STRAVA_TOKEN_URL = 'https://www.strava.com/oauth/token';
const STRAVA_API_ROOT = 'https://www.strava.com/api/v3';
const DEFAULT_SCOPE = 'read,read_all,activity:read,profile:read_all';
const DEFAULT_REDIRECT_URI = 'http://localhost:8787/strava/oauth/callback';

function usage() {
  return [
    'Usage: node evals/capture/strava_capture.cjs <command> [options]',
    '',
    'Commands:',
    '  auth-url                         Print the Strava OAuth authorization URL.',
    '  exchange-code --code <code>     Exchange an OAuth code and store refreshable auth locally.',
    '  refresh-token                   Refresh stored auth using the saved refresh token.',
    '  capture [options]               Capture a raw Strava fixture bundle.',
    '',
    'Capture options:',
    '  --label <name>                  Optional capture label used in the output filename.',
    '  --activity-id <id>              Optional activity id to fetch. Repeat to fetch multiple ids.',
    '  --recent-count <n>              Number of recent activities to fetch for context. Default: 5.',
    '',
    'Environment:',
    '  STRAVA_CLIENT_ID                Required for auth-url, exchange-code, and refresh-token.',
    '  STRAVA_CLIENT_SECRET            Required for exchange-code and refresh-token.',
    '  STRAVA_REDIRECT_URI             Optional. Default: http://localhost:8787/strava/oauth/callback',
    '  STRAVA_ACCESS_TOKEN             Optional override for live API capture.',
    '',
    'Examples:',
    '  node evals/capture/strava_capture.cjs auth-url',
    '  node evals/capture/strava_capture.cjs exchange-code --code "<code-from-redirect>"',
    '  node evals/capture/strava_capture.cjs capture --label "private-notes" --activity-id 123456789',
  ].join('\n');
}

function requireEnv(name) {
  if (!process.env[name]) {
    throw new Error(`${name} is required`);
  }
  return process.env[name];
}

function readStoredAuth() {
  if (!fs.existsSync(STRAVA_AUTH_PATH)) {
    return null;
  }
  return readJson(STRAVA_AUTH_PATH);
}

function writeStoredAuth(payload) {
  writeJson(STRAVA_AUTH_PATH, payload);
}

function parseArgs(argv) {
  const args = {
    command: argv[0],
    activityIds: [],
    recentCount: 5,
    label: null,
    code: null,
    help: false,
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--activity-id') {
      args.activityIds.push(argv[index + 1]);
      index += 1;
    } else if (arg === '--recent-count') {
      args.recentCount = Number(argv[index + 1]);
      index += 1;
    } else if (arg === '--label') {
      args.label = argv[index + 1];
      index += 1;
    } else if (arg === '--code') {
      args.code = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.command || args.command === '--help' || args.command === '-h') {
    args.help = true;
    args.command = null;
  }

  if (!args.command && !args.help) {
    throw new Error('Expected a command: auth-url, exchange-code, refresh-token, or capture');
  }
  return args;
}

function authUrl() {
  const clientId = requireEnv('STRAVA_CLIENT_ID');
  const redirectUri = process.env.STRAVA_REDIRECT_URI || DEFAULT_REDIRECT_URI;
  const url = new URL(STRAVA_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'force');
  url.searchParams.set('scope', process.env.STRAVA_SCOPE || DEFAULT_SCOPE);
  return url.toString();
}

async function exchangeCode(code) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: requireEnv('STRAVA_CLIENT_ID'),
      client_secret: requireEnv('STRAVA_CLIENT_SECRET'),
      code,
      grant_type: 'authorization_code',
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.status}\n${JSON.stringify(payload, null, 2)}`);
  }
  writeStoredAuth(payload);
  return payload;
}

async function refreshAccessToken(refreshToken) {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: requireEnv('STRAVA_CLIENT_ID'),
      client_secret: requireEnv('STRAVA_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.status}\n${JSON.stringify(payload, null, 2)}`);
  }
  writeStoredAuth(payload);
  return payload;
}

async function getAccessToken() {
  if (process.env.STRAVA_ACCESS_TOKEN) {
    return process.env.STRAVA_ACCESS_TOKEN;
  }
  const stored = readStoredAuth();
  if (!stored) {
    throw new Error(`No stored Strava auth found at ${STRAVA_AUTH_PATH}. Run auth-url, authenticate, then exchange-code.`);
  }
  const expiresAt = Number(stored.expires_at || 0);
  if (stored.access_token && expiresAt > Math.floor(Date.now() / 1000) + 60) {
    return stored.access_token;
  }
  const refreshed = await refreshAccessToken(stored.refresh_token);
  return refreshed.access_token;
}

async function fetchStravaJson(endpoint, accessToken) {
  const response = await fetch(`${STRAVA_API_ROOT}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Strava API request failed for ${endpoint}: ${response.status}\n${JSON.stringify(payload, null, 2)}`);
  }
  return payload;
}

async function captureBundle({ activityIds, recentCount, label }) {
  const accessToken = await getAccessToken();
  const athlete = await fetchStravaJson('/athlete', accessToken);
  const activities = await fetchStravaJson(`/athlete/activities?per_page=${recentCount}`, accessToken);
  const selectedActivityIds = activityIds.length
    ? activityIds
    : activities.slice(0, Math.min(activities.length, 1)).map((activity) => String(activity.id));

  const requests = [
    { endpoint: 'GET /athlete', response: athlete },
    { endpoint: `GET /athlete/activities?per_page=${recentCount}`, response: activities },
  ];

  for (const activityId of selectedActivityIds) {
    const detail = await fetchStravaJson(`/activities/${activityId}`, accessToken);
    requests.push({
      endpoint: `GET /activities/${activityId}`,
      response: detail,
    });
    try {
      const streams = await fetchStravaJson(
        `/activities/${activityId}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp&key_by_type=true`,
        accessToken,
      );
      requests.push({
        endpoint: `GET /activities/${activityId}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp&key_by_type=true`,
        response: streams,
      });
    } catch (error) {
      requests.push({
        endpoint: `GET /activities/${activityId}/streams?keys=time,distance,latlng,altitude,velocity_smooth,heartrate,cadence,watts,temp&key_by_type=true`,
        response: { error: String(error.message || error) },
      });
    }
  }

  const payload = {
    fixture_id: label || `strava-capture-${timestampForFile()}`,
    captured_at: new Date().toISOString(),
    source: {
      type: 'strava',
      capture_mode: 'live-api',
    },
    requests,
  };

  const outputPath = path.join(
    RAW_CAPTURE_ROOT,
    'strava',
    `${payload.fixture_id}-${timestampForFile()}.json`,
  );
  writeJson(outputPath, payload);
  return outputPath;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (args.command === 'auth-url') {
    console.log(authUrl());
    return;
  }
  if (args.command === 'exchange-code') {
    if (!args.code) {
      throw new Error('--code is required for exchange-code');
    }
    await exchangeCode(args.code);
    console.log(`stored_auth=${STRAVA_AUTH_PATH}`);
    return;
  }
  if (args.command === 'refresh-token') {
    const auth = readStoredAuth();
    if (!auth?.refresh_token) {
      throw new Error(`No refresh_token found in ${STRAVA_AUTH_PATH}`);
    }
    await refreshAccessToken(auth.refresh_token);
    console.log(`stored_auth=${STRAVA_AUTH_PATH}`);
    return;
  }
  if (args.command === 'capture') {
    ensureDir(path.join(RAW_CAPTURE_ROOT, 'strava'));
    const outputPath = await captureBundle(args);
    console.log(`raw_capture=${outputPath}`);
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message || String(error)}\n\n${usage()}`);
  process.exit(1);
});
