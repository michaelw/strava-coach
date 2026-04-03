const fs = require('fs');
const path = require('path');
const { resolveConversationContext, resolveStravaContext } = require('./fixtures.cjs');
const { readResolvedBaselinePromptPath } = require('../prompts/baseline.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_PROMPT_PATH = path.join(ROOT, 'system_prompt.md');

function readPromptText(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim();
}

function readBaselinePromptPath() {
  const baselinePromptPath = readResolvedBaselinePromptPath();
  if (!baselinePromptPath) {
    throw new Error(
      'No baseline prompt artifact is available. Run compare evals via task eval:compare or sh evals/promptfoo/run_promptfoo_phase.sh so the baseline artifact URL is resolved first, or set STRAVA_COACH_BASELINE_URL explicitly.',
    );
  }

  return baselinePromptPath;
}

function buildScenarioPrompt(promptText, vars) {
  const conversationContext = resolveConversationContext(vars);
  return [
    'System instructions:',
    promptText,
    'Harness instructions:',
    '- The Strava data shown below is already fetched and available.',
    '- Do not narrate API calls, data retrieval, or tool use.',
    '- Respond with the final user-facing coaching answer only.',
    '',
    'Respond to the following Strava Coach scenario.',
    '',
    'Athlete profile:',
    vars.athlete_profile || '(none provided)',
    '',
    ...(conversationContext
      ? [
          'Captured prior conversation context:',
          conversationContext,
          '',
        ]
      : []),
    'Strava data:',
    resolveStravaContext(vars),
    '',
    'User query:',
    vars.user_query,
  ].join('\n');
}

function candidatePrompt(context) {
  return buildScenarioPrompt(readPromptText(CANDIDATE_PROMPT_PATH), context.vars);
}

function baselinePrompt(context) {
  return buildScenarioPrompt(readPromptText(readBaselinePromptPath()), context.vars);
}

module.exports = {
  candidatePrompt,
  baselinePrompt,
};
