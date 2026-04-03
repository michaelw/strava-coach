const crypto = require('node:crypto');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const { readBaselineConfig } = require('../promptfoo/config.cjs');

const RESOLVED_BASELINE_PROMPT_PATH_ENV = 'STRAVA_COACH_RESOLVED_BASELINE_PROMPT_PATH';
const BASELINE_PROMPT_PATH_ENV = 'STRAVA_COACH_BASELINE_PROMPT_PATH';
const BASELINE_URL_ENV = 'STRAVA_COACH_BASELINE_URL';
const BASELINE_VERSION_ENV = 'STRAVA_COACH_BASELINE_VERSION';

function readNonEmptyString(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim();
}

function deriveVersionFromUrl(urlValue) {
  const match = String(urlValue).match(/prompt-baseline-v(\d+\.\d+\.\d+)/);
  if (!match) {
    return '';
  }

  return match[1];
}

function resolveFileUrl(urlValue) {
  const parsedUrl = new URL(urlValue);
  if (parsedUrl.protocol !== 'file:') {
    return null;
  }

  return fileURLToPath(parsedUrl);
}

function resolveBaselineSource({ configPath, env = process.env } = {}) {
  const explicitPromptPath = readNonEmptyString(env[BASELINE_PROMPT_PATH_ENV]);
  if (explicitPromptPath) {
    return {
      kind: 'local-path',
      promptPath: path.resolve(explicitPromptPath),
      version: path.basename(explicitPromptPath),
      description: `local file ${explicitPromptPath}`,
    };
  }

  const baselineConfig = readBaselineConfig(configPath);
  const baselineUrl = readNonEmptyString(env[BASELINE_URL_ENV]) || baselineConfig.url;
  if (!baselineUrl) {
    throw new Error('No baseline URL is configured. Set baseline.url in evals/config.yaml or STRAVA_COACH_BASELINE_URL.');
  }

  const version = readNonEmptyString(env[BASELINE_VERSION_ENV])
    || baselineConfig.version
    || deriveVersionFromUrl(baselineUrl)
    || 'override-url';
  const resolvedFilePath = baselineUrl.startsWith('file:')
    ? resolveFileUrl(baselineUrl)
    : null;

  if (resolvedFilePath) {
    return {
      kind: 'file-url',
      url: baselineUrl,
      promptPath: resolvedFilePath,
      version,
      description: `local file URL ${baselineUrl}`,
    };
  }

  return {
    kind: 'url',
    url: baselineUrl,
    version,
    description: `baseline artifact URL ${baselineUrl}`,
  };
}

function buildBaselineCacheFileName(source) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify(source))
    .digest('hex')
    .slice(0, 12);
  let extension = path.extname(source.promptPath || '') || '';
  if (!extension && source.url) {
    extension = path.extname(new URL(source.url).pathname);
  }
  if (!extension) {
    extension = '.md';
  }

  return `baseline-${hash}${extension}`;
}

function readResolvedBaselinePromptPath(env = process.env) {
  const resolvedPath = readNonEmptyString(env[RESOLVED_BASELINE_PROMPT_PATH_ENV]);
  if (resolvedPath) {
    return path.resolve(resolvedPath);
  }

  const explicitPromptPath = readNonEmptyString(env[BASELINE_PROMPT_PATH_ENV]);
  if (explicitPromptPath) {
    return path.resolve(explicitPromptPath);
  }

  return null;
}

module.exports = {
  BASELINE_PROMPT_PATH_ENV,
  BASELINE_URL_ENV,
  BASELINE_VERSION_ENV,
  RESOLVED_BASELINE_PROMPT_PATH_ENV,
  buildBaselineCacheFileName,
  deriveVersionFromUrl,
  readResolvedBaselinePromptPath,
  resolveFileUrl,
  resolveBaselineSource,
};
