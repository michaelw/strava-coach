const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_REPO_CONFIG_PATH = path.join(ROOT, 'evals', 'config.yaml');
const DEFAULT_RETRY_POLICY = Object.freeze({
  error_passes: 2,
  flaky_passes: 1,
  flaky_tag: 'flaky',
});
const DEFAULT_BASELINE_CONFIG = Object.freeze({
  version: '',
  url: '',
});

function readYaml(filePath) {
  return yaml.load(fs.readFileSync(filePath, 'utf8'));
}

function readRepoConfig(configPath = DEFAULT_REPO_CONFIG_PATH) {
  return readYaml(configPath);
}

function normalizeRetryNumber(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeString(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed || fallback;
}

function readRetryPolicy(configPath = DEFAULT_REPO_CONFIG_PATH) {
  const repoConfig = readRepoConfig(configPath);
  const configured = repoConfig?.retries || {};
  const flakyTag = typeof configured.flaky_tag === 'string' && configured.flaky_tag.trim()
    ? configured.flaky_tag.trim()
    : DEFAULT_RETRY_POLICY.flaky_tag;

  return {
    error_passes: normalizeRetryNumber(
      configured.error_passes,
      DEFAULT_RETRY_POLICY.error_passes,
    ),
    flaky_passes: normalizeRetryNumber(
      configured.flaky_passes,
      DEFAULT_RETRY_POLICY.flaky_passes,
    ),
    flaky_tag: flakyTag,
  };
}

function readBaselineConfig(configPath = DEFAULT_REPO_CONFIG_PATH) {
  const repoConfig = readRepoConfig(configPath);
  const configured = repoConfig?.baseline || {};

  return {
    version: normalizeString(configured.version, DEFAULT_BASELINE_CONFIG.version),
    url: normalizeString(configured.url, DEFAULT_BASELINE_CONFIG.url),
  };
}

module.exports = {
  DEFAULT_BASELINE_CONFIG,
  DEFAULT_REPO_CONFIG_PATH,
  DEFAULT_RETRY_POLICY,
  readBaselineConfig,
  readRepoConfig,
  readRetryPolicy,
  readYaml,
};
