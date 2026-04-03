const fs = require('node:fs');
const path = require('node:path');

const { DEFAULT_REPO_CONFIG_PATH } = require('../promptfoo/config.cjs');
const {
  buildBaselineCacheFileName,
  resolveBaselineSource,
} = require('./baseline.cjs');

const ROOT = path.resolve(__dirname, '..', '..');

function parseArgs(argv) {
  const promptfooStateDir = process.env.PROMPTFOO_CONFIG_DIR
    ? path.resolve(process.env.PROMPTFOO_CONFIG_DIR)
    : path.join(ROOT, '.promptfoo');

  const args = {
    outputDir: path.join(promptfooStateDir, 'baselines'),
    json: false,
    configPath: process.env.PROMPT_EVAL_REPO_CONFIG_PATH
      ? path.resolve(process.env.PROMPT_EVAL_REPO_CONFIG_PATH)
      : DEFAULT_REPO_CONFIG_PATH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--output-dir') {
      args.outputDir = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === '--json') {
      args.json = true;
      continue;
    }
    if (arg === '--repo-config') {
      args.configPath = path.resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

async function fetchPromptText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'strava-coach-prompt-evals',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch baseline prompt artifact from ${url} (${response.status} ${response.statusText}).`);
  }

  const promptText = await response.text();
  if (!promptText.trim()) {
    throw new Error(`Fetched baseline prompt artifact from ${url} but it was empty.`);
  }

  return promptText;
}

function ensureReadableFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Baseline prompt override file does not exist: ${filePath}`);
  }
  fs.accessSync(filePath, fs.constants.R_OK);
}

async function resolveBaselinePrompt({ outputDir, configPath } = {}) {
  const source = resolveBaselineSource({ configPath });

  if (source.kind === 'local-path' || source.kind === 'file-url') {
    ensureReadableFile(source.promptPath);
    return {
      promptPath: source.promptPath,
      source,
      cached: false,
    };
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const promptPath = path.join(outputDir, buildBaselineCacheFileName(source));
  const promptText = await fetchPromptText(source.url);
  fs.writeFileSync(promptPath, promptText, 'utf8');
  fs.writeFileSync(
    `${promptPath}.json`,
    `${JSON.stringify({
      resolved_at: new Date().toISOString(),
      source,
      prompt_path: promptPath,
    }, null, 2)}\n`,
    'utf8',
  );

  return {
    promptPath,
    source,
    cached: true,
  };
}

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const resolved = await resolveBaselinePrompt(args);
    if (args.json) {
      process.stdout.write(`${JSON.stringify({
        path: resolved.promptPath,
        cached: resolved.cached,
        source: resolved.source,
      }, null, 2)}\n`);
      return;
    }

    process.stdout.write(`${resolved.promptPath}\n`);
  } catch (error) {
    process.stderr.write(`Baseline prompt resolution failed: ${error.message}\n`);
    process.stderr.write(
      'Set STRAVA_COACH_BASELINE_URL to an https:// or file:// URL, or STRAVA_COACH_BASELINE_PROMPT_PATH for an explicit local-path override.\n',
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  fetchPromptText,
  parseArgs,
  resolveBaselinePrompt,
};
