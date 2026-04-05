const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');

const {
  DEFAULT_BASELINE_CONFIG,
  DEFAULT_CANARY_CONFIG,
  DEFAULT_RETRY_POLICY,
  DEFAULT_RUNTIME_CONFIG,
  expandCompareConfig,
  readBaselineConfig,
  readCanaryConfig,
  readRepoConfig,
  readRetryPolicy,
  readRuntimeConfig,
  readYaml,
  writeExpandedCompareConfig,
} = require('./config.cjs');
const { deriveVersionFromUrl } = require('../prompts/baseline.cjs');

const SELF_CONFIG_PATH = path.resolve('evals/promptfoo/promptfooconfig.self.yaml');
const COMPARE_CONFIG_PATH = path.resolve('evals/promptfoo/promptfooconfig.compare.yaml');
const SMOKE_CANARY_CONFIG_PATH = path.resolve('evals/promptfoo/promptfooconfig.smoke.canary.yaml');

test('self promptfoo config points at candidate prompt and self case tree', () => {
  const config = readYaml(SELF_CONFIG_PATH);

  assert.deepEqual(config.prompts, ['file://prompts.cjs:candidatePrompt']);
  assert.deepEqual(config.tests, ['file://../cases/self/**/*.yaml']);
  assert.equal(config.evaluateOptions.maxConcurrency, 4);
  assert.equal(config.evaluateOptions.timeoutMs, 90000);
});

test('compare promptfoo config points at candidate and baseline prompts and compare case tree', () => {
  const config = readYaml(COMPARE_CONFIG_PATH);

  assert.deepEqual(config.prompts, [
    'file://prompts.cjs:candidatePrompt',
    'file://prompts.cjs:baselinePrompt',
  ]);
  assert.deepEqual(config.tests, ['file://../cases/compare/**/*.yaml']);
  assert.equal(config.evaluateOptions.maxConcurrency, 4);
  assert.equal(config.evaluateOptions.timeoutMs, 90000);
});

test('expanded compare config duplicates cases to match declared repeat counts', () => {
  const expandedConfig = expandCompareConfig(COMPARE_CONFIG_PATH);

  assert.equal(expandedConfig.prompts.length, 2);
  for (const prompt of expandedConfig.prompts) {
    assert.match(prompt, /^file:\/\/\/.*evals\/promptfoo\/prompts\.cjs:/);
  }
  assert.equal(expandedConfig.tests.length, 8);
  assert.equal(
    expandedConfig.tests.filter((entry) => entry.endsWith('/evals/cases/compare/personalization/personalization-001.yaml')).length,
    5,
  );
  assert.equal(
    expandedConfig.tests.filter((entry) => entry.endsWith('/evals/cases/compare/personalization/personalization-003.yaml')).length,
    3,
  );
});

test('writeExpandedCompareConfig materializes an explicit repeated compare config on disk', () => {
  const outputPath = path.join(os.tmpdir(), 'strava-coach-expanded-compare-config.yaml');

  writeExpandedCompareConfig(COMPARE_CONFIG_PATH, outputPath);
  const materialized = readYaml(outputPath);

  assert.equal(materialized.tests.length, 8);
  assert.match(materialized.tests[0], /^file:\/\/\/.*\.yaml$/);
});

test('smoke canary promptfoo config stays scoped to smoke self cases', () => {
  const config = readYaml(SMOKE_CANARY_CONFIG_PATH);

  assert.deepEqual(config.prompts, ['file://prompts.cjs:candidatePrompt']);
  assert.deepEqual(config.tests, ['file://../cases/self/smoke/*.yaml']);
  assert.equal(config.evaluateOptions.maxConcurrency, 4);
  assert.equal(config.evaluateOptions.timeoutMs, 90000);
});

test('native promptfoo configs inline the current repo runtime settings', () => {
  const runtimeConfig = readRuntimeConfig();
  const canaryConfig = readCanaryConfig();
  const selfConfig = readYaml(SELF_CONFIG_PATH);
  const compareConfig = readYaml(COMPARE_CONFIG_PATH);
  const smokeCanaryConfig = readYaml(SMOKE_CANARY_CONFIG_PATH);

  for (const config of [selfConfig, compareConfig]) {
    const provider = config.providers[0];
    assert.equal(provider.id, `openai:responses:${readRepoConfig().models.response}`);
    assert.equal(provider.config.max_output_tokens, runtimeConfig.max_output_tokens);
    assert.equal(provider.config.reasoning_effort, runtimeConfig.reasoning_effort);
    assert.equal(provider.config.temperature, runtimeConfig.temperature);
    assert.equal(provider.config.passthrough.text.verbosity, runtimeConfig.text_verbosity);
    assert.equal(config.evaluateOptions.timeoutMs, runtimeConfig.request_timeout_seconds * 1000);
  }

  const canaryProvider = smokeCanaryConfig.providers[0];
  assert.equal(canaryProvider.id, `openai:responses:${readRepoConfig().models.response}`);
  assert.equal(canaryProvider.config.max_output_tokens, runtimeConfig.max_output_tokens);
  assert.equal(canaryProvider.config.reasoning_effort, runtimeConfig.reasoning_effort);
  assert.equal(canaryProvider.config.temperature, canaryConfig.temperature);
  assert.equal(canaryProvider.config.passthrough.text.verbosity, runtimeConfig.text_verbosity);
  assert.equal(smokeCanaryConfig.evaluateOptions.timeoutMs, runtimeConfig.request_timeout_seconds * 1000);
});

test('repo config exposes retry defaults for hosted eval reruns', () => {
  const repoConfig = readRepoConfig();
  const retryPolicy = readRetryPolicy();

  assert.deepEqual(repoConfig.retries, {
    error_passes: 2,
    flaky_passes: 1,
    flaky_tag: 'flaky',
  });
  assert.deepEqual(retryPolicy, repoConfig.retries);
  assert.deepEqual(DEFAULT_RETRY_POLICY, {
    error_passes: 2,
    flaky_passes: 1,
    flaky_tag: 'flaky',
  });
});

test('repo config exposes deterministic runtime defaults and smoke canary policy', () => {
  const runtimeConfig = readRuntimeConfig();
  const canaryConfig = readCanaryConfig();

  assert.deepEqual(runtimeConfig, {
    request_timeout_seconds: 90,
    max_output_tokens: 1200,
    reasoning_effort: 'minimal',
    text_verbosity: 'low',
    temperature: 0,
  });
  assert.deepEqual(canaryConfig, {
    repeat: 5,
    allowed_failures: 1,
    temperature: 1,
  });
  assert.deepEqual(DEFAULT_RUNTIME_CONFIG, runtimeConfig);
  assert.deepEqual(DEFAULT_CANARY_CONFIG, canaryConfig);
});

test('repo config exposes the pinned baseline artifact source', () => {
  const repoConfig = readRepoConfig();
  const baselineConfig = readBaselineConfig();
  const expectedUrl = `https://github.com/michaelw/strava-coach/releases/download/prompt-baseline-v${repoConfig.baseline.version}/strava-coach-system-prompt.md`;

  assert.match(repoConfig.baseline.version, /^\d+\.\d+\.\d+$/);
  assert.equal(repoConfig.baseline.url, expectedUrl);
  assert.equal(deriveVersionFromUrl(repoConfig.baseline.url), repoConfig.baseline.version);
  assert.deepEqual(baselineConfig, repoConfig.baseline);
  assert.deepEqual(DEFAULT_BASELINE_CONFIG, {
    version: '',
    url: '',
  });
});
