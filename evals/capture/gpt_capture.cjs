#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yaml = require('js-yaml');
const { chromium } = require('playwright');
const { RAW_CAPTURE_ROOT, ensureDir, timestampForFile, writeJson } = require('./common.cjs');

const DEFAULT_GPT_URL = 'https://chatgpt.com/g/g-69bd636fa99c8191ac5ffce9859deef2-strava-coach';
const DEFAULT_PROFILE_DIR = path.join(RAW_CAPTURE_ROOT, '..', '..', '.playwright', 'strava-coach-gpt');

function usage() {
  return [
    'Usage: node evals/capture/gpt_capture.cjs (--prompt <text> | --scenario <path>) [options]',
    '',
    'Required:',
    '  --prompt <text>                Prompt text to submit directly.',
    '  --scenario <path>              YAML scenario file with an id and prompt.',
    '',
    'Options:',
    `  --url <url>                    GPT URL to open. Default: ${DEFAULT_GPT_URL}`,
    '  --label <name>                 Optional capture label. Defaults to the scenario id or "ad-hoc".',
    '  --headless                     Run Playwright headless instead of opening the browser UI.',
    '  --help                         Show this help message.',
    '',
    'Examples:',
    '  node evals/capture/gpt_capture.cjs --scenario evals/capture/scenarios/private-notes.yaml --label private-notes',
    '  node evals/capture/gpt_capture.cjs --prompt "Analyze my last run" --label ad-hoc-run',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    url: DEFAULT_GPT_URL,
    headed: true,
    prompt: null,
    scenarioPath: null,
    label: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--prompt') {
      args.prompt = argv[index + 1];
      index += 1;
    } else if (arg === '--scenario') {
      args.scenarioPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--label') {
      args.label = argv[index + 1];
      index += 1;
    } else if (arg === '--url') {
      args.url = argv[index + 1];
      index += 1;
    } else if (arg === '--headless') {
      args.headed = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && !args.prompt && !args.scenarioPath) {
    throw new Error('Provide --prompt or --scenario');
  }
  return args;
}

function waitForEnter(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(`${message}\n`, () => {
      rl.close();
      resolve();
    });
  });
}

function loadScenario(args) {
  if (args.scenarioPath) {
    const payload = yaml.load(fs.readFileSync(args.scenarioPath, 'utf8'));
    if (!payload?.prompt) {
      throw new Error(`Scenario file missing prompt: ${args.scenarioPath}`);
    }
    return {
      label: args.label || payload.id || path.basename(args.scenarioPath, path.extname(args.scenarioPath)),
      prompt: payload.prompt,
    };
  }
  return {
    label: args.label || 'ad-hoc',
    prompt: args.prompt,
  };
}

async function composerLocator(page) {
  const selectors = [
    'textarea',
    '[contenteditable="true"]',
    'div[role="textbox"]',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector).last();
    if (await locator.count()) {
      return locator;
    }
  }
  throw new Error('Could not find a ChatGPT composer element');
}

async function submitPrompt(page, prompt) {
  const composer = await composerLocator(page);
  await composer.click();
  await composer.fill(prompt);
  await composer.press('Enter');
}

async function extractConversation(page) {
  return page.evaluate(() => {
    const messages = [];
    const nodes = document.querySelectorAll('[data-message-author-role]');
    for (const node of nodes) {
      const role = node.getAttribute('data-message-author-role');
      const content = node.innerText.trim();
      if (!role || !content) {
        continue;
      }
      messages.push({ role, content });
    }
    return messages;
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const scenario = loadScenario(args);
  ensureDir(path.join(RAW_CAPTURE_ROOT, 'gpt'));
  ensureDir(DEFAULT_PROFILE_DIR);

  const context = await chromium.launchPersistentContext(DEFAULT_PROFILE_DIR, {
    headless: !args.headed,
    viewport: { width: 1440, height: 1024 },
  });
  const page = context.pages()[0] || await context.newPage();
  await page.goto(args.url, { waitUntil: 'domcontentloaded' });

  await waitForEnter('Authenticate in the browser if needed, then press Enter here to submit the scenario prompt.');
  await submitPrompt(page, scenario.prompt);
  await waitForEnter('Wait for the GPT answer to finish, then press Enter here to capture the visible transcript.');

  const conversation = await extractConversation(page);
  const payload = {
    fixture_id: `${scenario.label}-${timestampForFile()}`,
    captured_at: new Date().toISOString(),
    source: {
      type: 'gpt',
      url: args.url,
      scenario: scenario.label,
    },
    prompt: scenario.prompt,
    conversation,
  };

  const outputPath = path.join(
    RAW_CAPTURE_ROOT,
    'gpt',
    `${scenario.label}-${timestampForFile()}.json`,
  );
  writeJson(outputPath, payload);
  console.log(`raw_capture=${outputPath}`);
  await context.close();
}

main().catch((error) => {
  console.error(`Error: ${error.message || String(error)}\n\n${usage()}`);
  process.exit(1);
});
