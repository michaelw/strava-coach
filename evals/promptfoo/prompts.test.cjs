const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { baselinePrompt, candidatePrompt } = require('./prompts.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_PROMPT_PATH = path.join(ROOT, 'system_prompt.md');
const BASELINE_PROMPT_PATH = path.join(ROOT, 'evals', 'prompts', 'system_prompt.baseline.md');

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

test('baseline prompt reads the tracked baseline prompt file directly', () => {
  const promptText = fs.readFileSync(BASELINE_PROMPT_PATH, 'utf8').trim();
  const rendered = baselinePrompt(buildContext());

  assert.ok(rendered.includes(`System instructions:\n${promptText}\nHarness instructions:`));
});
