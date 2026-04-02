const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const RAW_CAPTURE_ROOT = path.join(ROOT, '.promptfoo', 'captures', 'raw');
const STRAVA_AUTH_PATH = path.join(ROOT, '.promptfoo', 'captures', 'strava', 'auth.json');
const TRACKED_FIXTURE_ROOT = path.join(ROOT, 'evals', 'fixtures', 'production');
const SANITIZER_VERSION = 'v1';

const REDACT_ALL_VALUE = '[redacted]';
const REDACT_COORDINATE = '[redacted-coordinate]';

const SECRET_KEY_PATTERN = /(access_token|refresh_token|client_secret|authorization|token)$/i;
const ID_KEY_PATTERN = /(^id$|_id$|athlete_id|external_id|upload_id|resource_state)/i;
const PII_KEY_PATTERN = /(firstname|lastname|full_name|username|email|phone|city|state|country|profile|device_name|gear_id|location_city|location_state|location_country)/i;
const COORDINATE_KEY_PATTERN = /(latlng|start_latlng|end_latlng|start_latitude|start_longitude)/i;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:]/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function stableSortObject(value) {
  if (Array.isArray(value)) {
    return value.map(stableSortObject);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableSortObject(value[key])]),
    );
  }
  return value;
}

function sanitizeString(text) {
  return String(text)
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted-token]')
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
}

function shouldRedactKey(key) {
  return SECRET_KEY_PATTERN.test(key) || ID_KEY_PATTERN.test(key) || PII_KEY_PATTERN.test(key);
}

function sanitizeValue(value, key = '') {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    return shouldRedactKey(key) ? REDACT_ALL_VALUE : sanitizeString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return shouldRedactKey(key) ? REDACT_ALL_VALUE : value;
  }

  if (Array.isArray(value)) {
    if (COORDINATE_KEY_PATTERN.test(key)) {
      return value.map(() => REDACT_COORDINATE);
    }
    return value.map((item) => sanitizeValue(item, key));
  }

  if (typeof value === 'object') {
    const sanitized = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      if (COORDINATE_KEY_PATTERN.test(childKey)) {
        if (Array.isArray(childValue)) {
          sanitized[childKey] = childValue.map(() => REDACT_COORDINATE);
        } else {
          sanitized[childKey] = REDACT_ALL_VALUE;
        }
        continue;
      }
      if (shouldRedactKey(childKey)) {
        sanitized[childKey] = REDACT_ALL_VALUE;
        continue;
      }
      sanitized[childKey] = sanitizeValue(childValue, childKey);
    }
    return stableSortObject(sanitized);
  }

  return value;
}

function sanitizeTranscript(transcript) {
  return transcript.map((message) => ({
    ...message,
    content: sanitizeString(message.content),
  }));
}

function buildTrackedFixturePayload(rawPayload, overrides = {}) {
  return stableSortObject({
    ...rawPayload,
    ...overrides,
    sanitizer_version: SANITIZER_VERSION,
  });
}

module.exports = {
  RAW_CAPTURE_ROOT,
  ROOT,
  SANITIZER_VERSION,
  STRAVA_AUTH_PATH,
  TRACKED_FIXTURE_ROOT,
  buildTrackedFixturePayload,
  ensureDir,
  readJson,
  sanitizeTranscript,
  sanitizeValue,
  stableSortObject,
  timestampForFile,
  writeJson,
};
