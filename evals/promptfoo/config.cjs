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

module.exports = {
  DEFAULT_REPO_CONFIG_PATH,
  DEFAULT_RETRY_POLICY,
  readRepoConfig,
  readRetryPolicy,
  readYaml,
};
