const fs = require('fs');
const path = require('path');
const { resolveConversationContext, resolveStravaContext } = require('./fixtures.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CANDIDATE_PROMPT_PATH = path.join(ROOT, 'system_prompt.md');
const BASELINE_PROMPT_PATH = path.join(ROOT, 'evals', 'prompts', 'system_prompt.baseline.md');

function readPromptText(filePath) {
  return fs.readFileSync(filePath, 'utf8').trim();
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
  return buildScenarioPrompt(readPromptText(BASELINE_PROMPT_PATH), context.vars);
}

module.exports = {
  candidatePrompt,
  baselinePrompt,
};
