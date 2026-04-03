const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  DEFAULT_BASELINE_CONFIG,
  DEFAULT_RETRY_POLICY,
  readBaselineConfig,
  readRepoConfig,
  readRetryPolicy,
  readYaml,
} = require('./config.cjs');

const SELF_CONFIG_PATH = path.resolve('evals/promptfoo/promptfooconfig.self.yaml');
const COMPARE_CONFIG_PATH = path.resolve('evals/promptfoo/promptfooconfig.compare.yaml');

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

test('native promptfoo configs inline the current repo runtime settings', () => {
  const repoConfig = readRepoConfig();
  const selfConfig = readYaml(SELF_CONFIG_PATH);
  const compareConfig = readYaml(COMPARE_CONFIG_PATH);

  for (const config of [selfConfig, compareConfig]) {
    const provider = config.providers[0];
    assert.equal(provider.id, `openai:responses:${repoConfig.models.response}`);
    assert.equal(provider.config.max_output_tokens, repoConfig.runtime.max_output_tokens);
    assert.equal(provider.config.reasoning_effort, repoConfig.runtime.reasoning_effort);
    assert.equal(provider.config.passthrough.text.verbosity, repoConfig.runtime.text_verbosity);
    assert.equal(config.evaluateOptions.timeoutMs, repoConfig.runtime.request_timeout_seconds * 1000);
  }
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

test('repo config exposes the pinned baseline artifact source', () => {
  const repoConfig = readRepoConfig();
  const baselineConfig = readBaselineConfig();

  assert.deepEqual(repoConfig.baseline, {
    version: '1.0.0',
    url: 'https://github.com/michaelw/strava-coach/releases/download/prompt-baseline-v1.0.0/strava-coach-system-prompt.md',
  });
  assert.deepEqual(baselineConfig, repoConfig.baseline);
  assert.deepEqual(DEFAULT_BASELINE_CONFIG, {
    version: '',
    url: '',
  });
});
