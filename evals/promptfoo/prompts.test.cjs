const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { baselinePrompt, candidatePrompt } = require('./prompts.cjs');
const { RESOLVED_BASELINE_PROMPT_PATH_ENV } = require('../prompts/baseline.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_PROMPT_PATH = path.join(ROOT, 'system_prompt.md');

function buildContext() {
  return {
    vars: {
      athlete_profile: 'Runner building back after injury.',
      strava_data: 'GET /athlete/activities?per_page=5\n[]',
      user_query: 'Analyze my last run.',
    },
  };
}

test('candidate prompt reads the raw repo-root system prompt file', () => {
  const promptText = fs.readFileSync(CANDIDATE_PROMPT_PATH, 'utf8').trim();
  const rendered = candidatePrompt(buildContext());

  assert.ok(rendered.includes(`System instructions:\n${promptText}\nHarness instructions:`));
  assert.doesNotMatch(rendered, /```/);
  assert.doesNotMatch(rendered, /This file is the source of truth for the public/);
});

test('baseline prompt reads the resolved baseline prompt artifact path', async (t) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'strava-coach-baseline-'));
  const baselinePath = path.join(tempDir, 'baseline.md');
  const promptText = 'Pinned baseline prompt artifact text.';
  fs.writeFileSync(baselinePath, `${promptText}\n`, 'utf8');
  const previousValue = process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV];

  t.after(() => {
    if (previousValue === undefined) {
      delete process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV];
    } else {
      process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV] = previousValue;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV] = baselinePath;

  const rendered = baselinePrompt(buildContext());

  assert.ok(rendered.includes(`System instructions:\n${promptText}\nHarness instructions:`));
});

test('baseline prompt fails clearly when no resolved baseline artifact is available', (t) => {
  const previousValue = process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV];

  t.after(() => {
    if (previousValue === undefined) {
      delete process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV];
    } else {
      process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV] = previousValue;
    }
  });

  delete process.env[RESOLVED_BASELINE_PROMPT_PATH_ENV];

  assert.throws(
    () => baselinePrompt(buildContext()),
    /No baseline prompt artifact is available/,
  );
});
