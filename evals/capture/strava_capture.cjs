#!/usr/bin/env node

const fs = require('fs');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
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
const DEFAULT_SCOPE = 'read,read_all,activity:read,activity:read_all,profile:read_all';
const DEFAULT_REDIRECT_URI = 'http://localhost:8787/strava/oauth/callback';

function usage() {
  return [
    'Usage: node evals/capture/strava_capture.cjs <command> [options]',
    '',
    'Commands:',
    '  auth                            Start a local OAuth callback server, open the browser when possible, and store refreshable auth locally.',
    '  auth-url                         Print the Strava OAuth authorization URL (manual fallback).',
    '  exchange-code --code <code>     Exchange an OAuth code and store refreshable auth locally.',
    '  refresh-token                   Refresh stored auth using the saved refresh token.',
    '  streams --activity-id <id> --keys <csv>',
    '                                  Fetch raw streams for one activity and save them locally.',
    '  capture [options]               Capture a raw Strava fixture bundle.',
    '',
    'Stream options:',
    '  --activity-id <id>              Required. Activity id to fetch streams for.',
    '  --keys <csv>                    Required. Comma-separated stream keys, for example time,distance.',
    '  --resolution <value>            Optional stream sampling hint: low, medium, or high.',
    '',
    'Capture options:',
    '  --label <name>                  Optional capture label used in the output filename.',
    '  --activity-id <id>              Optional activity id to fetch. Repeat to fetch multiple ids.',
    '  --recent-count <n>              Number of recent activities to fetch for context. Default: 5.',
    '',
    'Environment:',
    '  STRAVA_CLIENT_ID                Required for auth, auth-url, exchange-code, and refresh-token.',
    '  STRAVA_CLIENT_SECRET            Required for auth, exchange-code, and refresh-token.',
    '  STRAVA_REDIRECT_URI             Optional manual-fallback redirect URI for auth-url. Default: http://localhost:8787/strava/oauth/callback',
    '  STRAVA_ACCESS_TOKEN             Optional override for live API capture.',
    '',
    'Interactive auth reminder:',
    '  Before running auth, set the Strava App Authorization Callback Domain to localhost.',
    '  After finishing local auth for testing, set it back to chat.openai.com for the Custom GPT integration.',
    '',
    'Examples:',
    '  node evals/capture/strava_capture.cjs auth',
    '  node evals/capture/strava_capture.cjs auth-url',
    '  node evals/capture/strava_capture.cjs exchange-code --code "<code-from-redirect>"',
    '  node evals/capture/strava_capture.cjs streams --activity-id 123456789 --keys time,distance',
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
    keys: null,
    resolution: null,
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
    } else if (arg === '--keys') {
      args.keys = argv[index + 1]
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      index += 1;
    } else if (arg === '--resolution') {
      args.resolution = argv[index + 1];
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
    throw new Error('Expected a command: auth, auth-url, exchange-code, refresh-token, streams, or capture');
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

function tryOpenBrowser(url) {
  const attempts = [];
  if (process.platform === 'darwin') {
    attempts.push(['open', [url]]);
  } else if (process.platform === 'win32') {
    attempts.push(['cmd', ['/c', 'start', '', url]]);
  } else {
    attempts.push(['xdg-open', [url]]);
  }

  for (const [command, args] of attempts) {
    try {
      const result = spawnSync(command, args, {
        stdio: 'ignore',
      });
      if (!result.error && result.status === 0) {
        return { opened: true, command };
      }
    } catch (error) {
      // Continue to the next strategy and fall back to printing the URL.
    }
  }

  return { opened: false, command: null };
}

function buildInteractiveAuthMessage(redirectUri) {
  return [
    'Local Strava OAuth flow starting.',
    'Before continuing, set the Strava App Authorization Callback Domain to localhost.',
    'After this local test flow succeeds, change the callback domain back to chat.openai.com for the Custom GPT integration.',
    `Listening for the OAuth callback at: ${redirectUri}`,
  ].join('\n');
}

function buildCallbackHtml({ success, message }) {
  const title = success ? 'Strava auth complete' : 'Strava auth failed';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 2rem; line-height: 1.5; }
      main { max-width: 42rem; }
      code { background: #f4f4f4; padding: 0.1rem 0.3rem; border-radius: 4px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${title}</h1>
      <p>${message}</p>
      <p>After local testing, remember to set the Strava App callback domain back to <code>chat.openai.com</code> for the Custom GPT integration.</p>
      <p>You can close this tab now.</p>
    </main>
  </body>
</html>`;
}

async function runInteractiveAuth() {
  requireEnv('STRAVA_CLIENT_ID');
  requireEnv('STRAVA_CLIENT_SECRET');

  const state = crypto.randomBytes(16).toString('hex');
  const server = http.createServer();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  if (!port) {
    server.close();
    throw new Error('Failed to determine local OAuth callback port');
  }

  const redirectUri = `http://localhost:${port}/strava/oauth/callback`;
  const url = new URL(STRAVA_AUTH_URL);
  url.searchParams.set('client_id', requireEnv('STRAVA_CLIENT_ID'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('approval_prompt', 'force');
  url.searchParams.set('scope', process.env.STRAVA_SCOPE || DEFAULT_SCOPE);
  url.searchParams.set('state', state);

  console.log(buildInteractiveAuthMessage(redirectUri));
  console.log(`auth_url=${url.toString()}`);

  const browser = tryOpenBrowser(url.toString());
  if (browser.opened) {
    console.log(`browser_opened_with=${browser.command}`);
  } else {
    console.log('browser_opened_with=none');
    console.log('Open the auth_url above in your browser to continue.');
  }

  const authPayload = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for the Strava OAuth callback on localhost'));
    }, 5 * 60 * 1000);

    async function finish(success, req, res, payloadOrError) {
      clearTimeout(timeout);
      server.close();

      if (success) {
        const athleteId = payloadOrError?.athlete?.id;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          buildCallbackHtml({
            success: true,
            message: `Authorization succeeded${athleteId ? ` for athlete ${athleteId}` : ''}. The refreshable token has been stored locally.`,
          }),
        );
        resolve(payloadOrError);
        return;
      }

      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        buildCallbackHtml({
          success: false,
          message: `Authorization failed: ${payloadOrError.message || String(payloadOrError)}`,
        }),
      );
      reject(payloadOrError);
    }

    server.on('request', async (req, res) => {
      try {
        const requestUrl = new URL(req.url, redirectUri);
        if (requestUrl.pathname !== '/strava/oauth/callback') {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('Not found');
          return;
        }

        if (requestUrl.searchParams.get('error')) {
          throw new Error(`Strava returned ${requestUrl.searchParams.get('error')}`);
        }
        if (requestUrl.searchParams.get('state') !== state) {
          throw new Error('OAuth state mismatch');
        }

        const code = requestUrl.searchParams.get('code');
        if (!code) {
          throw new Error('Missing authorization code in callback');
        }

        const payload = await exchangeCode(code);
        await finish(true, req, res, payload);
      } catch (error) {
        await finish(false, req, res, error);
      }
    });
  });

  return authPayload;
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
    throw new Error(`No stored Strava auth found at ${STRAVA_AUTH_PATH}. Run auth for the local OAuth flow, or use auth-url plus exchange-code as a manual fallback.`);
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

function buildActivityStreamsEndpoint(activityId, keys, resolution = null) {
  const params = new URLSearchParams();
  params.set('keys', keys.join(','));
  params.set('key_by_type', 'true');
  if (resolution) {
    params.set('resolution', resolution);
  }
  return `/activities/${activityId}/streams?${params.toString()}`;
}

async function fetchStreams({ activityId, keys, label, resolution }) {
  if (!activityId) {
    throw new Error('--activity-id is required for streams');
  }
  if (!keys?.length) {
    throw new Error('--keys is required for streams');
  }
  const accessToken = await getAccessToken();
  const endpoint = buildActivityStreamsEndpoint(activityId, keys, resolution);
  const response = await fetchStravaJson(endpoint, accessToken);

  const payload = {
    fixture_id: label || `strava-streams-${activityId}-${timestampForFile()}`,
    captured_at: new Date().toISOString(),
    source: {
      type: 'strava',
      capture_mode: 'live-api',
    },
    requests: [
      {
        endpoint: `GET ${endpoint}`,
        response,
      },
    ],
  };

  const outputPath = path.join(
    RAW_CAPTURE_ROOT,
    'strava',
    `${payload.fixture_id}.json`,
  );
  writeJson(outputPath, payload);
  return { outputPath, response };
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
      const endpoint = buildActivityStreamsEndpoint(
        activityId,
        ['time', 'distance', 'latlng', 'altitude', 'velocity_smooth', 'heartrate', 'cadence', 'watts', 'temp'],
        'medium',
      );
      const streams = await fetchStravaJson(endpoint, accessToken);
      requests.push({
        endpoint: `GET ${endpoint}`,
        response: streams,
      });
    } catch (error) {
      const endpoint = buildActivityStreamsEndpoint(
        activityId,
        ['time', 'distance', 'latlng', 'altitude', 'velocity_smooth', 'heartrate', 'cadence', 'watts', 'temp'],
        'medium',
      );
      requests.push({
        endpoint: `GET ${endpoint}`,
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
  if (args.command === 'auth') {
    const payload = await runInteractiveAuth();
    console.log(`stored_auth=${STRAVA_AUTH_PATH}`);
    if (payload?.athlete?.id) {
      console.log(`athlete_id=${payload.athlete.id}`);
    }
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
  if (args.command === 'streams') {
    ensureDir(path.join(RAW_CAPTURE_ROOT, 'strava'));
    const activityId = args.activityIds[0];
    const { outputPath } = await fetchStreams({
      activityId,
      keys: args.keys,
      label: args.label,
      resolution: args.resolution,
    });
    console.log(`raw_streams=${outputPath}`);
    return;
  }
  throw new Error(`Unknown command: ${args.command}`);
}

main().catch((error) => {
  console.error(`Error: ${error.message || String(error)}\n\n${usage()}`);
  process.exit(1);
});
