const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT_PATH = path.join(ROOT, 'evals', 'promptfoo', 'run_promptfoo_phase.sh');

function writeExecutable(filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function createPromptfooReport({
  success = true,
  error = '',
  reason = '',
  tags = ['sample'],
  componentResults = [],
}) {
  return JSON.stringify({
    evalId: 'eval-test',
    results: {
      timestamp: '2026-04-02T01:00:00.000Z',
      prompts: [{ label: 'candidate' }],
      results: [
        {
          testIdx: 0,
          promptIdx: 0,
          success,
          error,
          latencyMs: 1200,
          gradingResult: {
            pass: success && !error,
            reason: reason || error || (success ? 'All assertions passed' : 'Promptfoo assertion failed'),
            componentResults,
          },
          testCase: {
            metadata: {
              id: 'sample-001',
              suite: 'smoke',
              tags,
            },
          },
        },
      ],
    },
  });
}

function createFakePromptfoo(tempDir, behavior = 'pass') {
  const promptfooPath = path.join(tempDir, 'promptfoo');
  const argsDir = path.join(tempDir, 'args');
  const countFile = path.join(tempDir, 'count.txt');
  fs.mkdirSync(argsDir, { recursive: true });
  fs.writeFileSync(countFile, '0', 'utf8');

  writeExecutable(
    promptfooPath,
    [
      '#!/bin/sh',
      'set -eu',
      'COUNT=$(cat "$FAKE_PROMPTFOO_COUNT_FILE")',
      'COUNT=$((COUNT + 1))',
      'printf "%s" "$COUNT" > "$FAKE_PROMPTFOO_COUNT_FILE"',
      'ARGS_FILE="$FAKE_PROMPTFOO_ARGS_DIR/args-$COUNT.txt"',
      'printf "%s\\n" "$@" > "$ARGS_FILE"',
      'OUTPUT=""',
      'RETRY_ERRORS="false"',
      'RETRY_FLAKY="false"',
      'while [ "$#" -gt 0 ]; do',
      '  case "$1" in',
      '    -o)',
      '      OUTPUT="$2"',
      '      shift 2',
      '      ;;',
      '    --retry-errors)',
      '      RETRY_ERRORS="true"',
      '      shift 1',
      '      ;;',
      '    --filter-failing-only)',
      '      RETRY_FLAKY="true"',
      '      shift 2',
      '      ;;',
      '    *)',
      '      shift 1',
      '      ;;',
      '  esac',
      'done',
      'if [ -z "$OUTPUT" ]; then exit 0; fi',
      'mkdir -p "$(dirname "$OUTPUT")"',
      'case "${FAKE_PROMPTFOO_BEHAVIOR:-pass}" in',
      '  pass)',
      "    printf '%s' \"$FAKE_PROMPTFOO_REPORT_PASS\" > \"$OUTPUT\"",
      '    ;;',
      '  error-then-pass)',
      '    if [ "$RETRY_ERRORS" = "true" ]; then',
      "      printf '%s' \"$FAKE_PROMPTFOO_REPORT_PASS\" > \"$OUTPUT\"",
      '    else',
      "      printf '%s' \"$FAKE_PROMPTFOO_REPORT_ERROR\" > \"$OUTPUT\"",
      '    fi',
      '    ;;',
      '  flaky-fail-then-pass)',
      '    if [ "$RETRY_FLAKY" = "true" ]; then',
      "      printf '%s' \"$FAKE_PROMPTFOO_REPORT_PASS\" > \"$OUTPUT\"",
      '    else',
      "      printf '%s' \"$FAKE_PROMPTFOO_REPORT_FLAKY_FAIL\" > \"$OUTPUT\"",
      '    fi',
      '    ;;',
      '  always-error)',
      "    printf '%s' \"$FAKE_PROMPTFOO_REPORT_ERROR\" > \"$OUTPUT\"",
      '    ;;',
      '  always-fail)',
      "    printf '%s' \"$FAKE_PROMPTFOO_REPORT_FLAKY_FAIL\" > \"$OUTPUT\"",
      '    ;;',
      '  *)',
      "    printf '%s' \"$FAKE_PROMPTFOO_REPORT_PASS\" > \"$OUTPUT\"",
      '    ;;',
      'esac',
    ].join('\n'),
  );

  return { promptfooPath, argsDir, countFile };
}

function readInvocationArgs(argsDir) {
  return fs
    .readdirSync(argsDir)
    .filter((name) => name.endsWith('.txt'))
    .sort((left, right) => left.localeCompare(right, 'en', { numeric: true }))
    .map((name) => fs.readFileSync(path.join(argsDir, name), 'utf8').trim().split('\n').filter(Boolean));
}

function runHelper(args, envOverrides = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-phase-'));
  const { promptfooPath, argsDir, countFile } = createFakePromptfoo(tempDir, envOverrides.FAKE_PROMPTFOO_BEHAVIOR);
  const outputDir = path.join(tempDir, 'artifacts');
  const result = spawnSync('sh', args, {
    cwd: ROOT,
    env: {
      ...process.env,
      FAKE_PROMPTFOO_ARGS_DIR: argsDir,
      FAKE_PROMPTFOO_COUNT_FILE: countFile,
      FAKE_PROMPTFOO_BEHAVIOR: envOverrides.FAKE_PROMPTFOO_BEHAVIOR || 'pass',
      FAKE_PROMPTFOO_REPORT_PASS: createPromptfooReport({ success: true }),
      FAKE_PROMPTFOO_REPORT_ERROR: createPromptfooReport({ success: false, error: 'API error: 429 Too Many Requests' }),
      FAKE_PROMPTFOO_REPORT_FLAKY_FAIL: createPromptfooReport({ success: false, reason: 'LLM rubric failed', tags: ['sample', 'flaky'] }),
      PROMPTFOO_BIN: promptfooPath,
      PROMPT_EVAL_OUTPUT_DIR: outputDir,
      PROMPT_EVAL_SKIP_SUMMARY: 'true',
      ...envOverrides,
    },
    encoding: 'utf8',
  });

  return {
    result,
    outputDir,
    invocations: readInvocationArgs(argsDir),
  };
}

test('helper derives self output names from config filename', () => {
  const { result, invocations } = runHelper([SCRIPT_PATH, 'evals/promptfoo/promptfooconfig.self.yaml']);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 1);
  assert.deepEqual(invocations[0].slice(0, 3), ['eval', '-c', path.join(ROOT, 'evals', 'promptfoo', 'promptfooconfig.self.yaml')]);
  const jsonPath = invocations[0][invocations[0].indexOf('-o') + 1];
  assert.match(jsonPath, /artifacts\/self\.json$/);
});

test('helper honors config retry defaults for infrastructure error retries', () => {
  const { result, invocations, outputDir } = runHelper(
    [SCRIPT_PATH, 'evals/promptfoo/promptfooconfig.self.yaml'],
    { FAKE_PROMPTFOO_BEHAVIOR: 'error-then-pass' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[1].includes('--retry-errors'));
  assert.equal(invocations[1][invocations[1].indexOf('-o') + 1], path.join(outputDir, 'self.retry-errors.1.json'));
});

test('helper retries flaky failures only for tagged cases', () => {
  const { result, invocations, outputDir } = runHelper(
    [SCRIPT_PATH, 'evals/promptfoo/promptfooconfig.self.yaml'],
    { FAKE_PROMPTFOO_BEHAVIOR: 'flaky-fail-then-pass' },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 2);
  assert.ok(invocations[1].includes('--filter-failing-only'));
  assert.ok(invocations[1].includes('tags=flaky'));
  assert.equal(invocations[1][invocations[1].indexOf('-o') + 1], path.join(outputDir, 'self.retry-flaky.1.json'));
});

test('helper honors env overrides over config defaults', () => {
  const { result, invocations } = runHelper(
    [SCRIPT_PATH, 'evals/promptfoo/promptfooconfig.self.yaml'],
    {
      FAKE_PROMPTFOO_BEHAVIOR: 'always-error',
      PROMPT_EVAL_RETRY_ERRORS_PASSES: '0',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 1);
});

test('helper does not retry assertion failures that are reported via row.error', () => {
  const assertionFailureReport = createPromptfooReport({
    success: false,
    error: 'Expected output to contain all of [return-to-run, running]. Missing: [running]',
    reason: 'Promptfoo assertion failed',
    componentResults: [
      {
        pass: false,
        score: 0,
        reason: 'Expected output to contain all of [return-to-run, running]. Missing: [running]',
      },
    ],
  });

  const { result, invocations } = runHelper(
    [SCRIPT_PATH, 'evals/promptfoo/promptfooconfig.self.yaml'],
    {
      FAKE_PROMPTFOO_BEHAVIOR: 'always-error',
      FAKE_PROMPTFOO_REPORT_ERROR: assertionFailureReport,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 1);
});

test('helper honors CLI retry overrides over env and config', () => {
  const { result, invocations } = runHelper(
    [
      SCRIPT_PATH,
      '--retry-errors-passes',
      '0',
      '--retry-flaky-passes',
      '0',
      '--flaky-tag',
      'nondeterministic',
      'evals/promptfoo/promptfooconfig.compare.yaml',
    ],
    {
      FAKE_PROMPTFOO_BEHAVIOR: 'error-then-pass',
      PROMPT_EVAL_RETRY_ERRORS_PASSES: '2',
      PROMPT_EVAL_RETRY_FLAKY_PASSES: '1',
      PROMPT_EVAL_FLAKY_TAG: 'flaky',
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(invocations.length, 1);
});

test('helper honors output-dir, output-prefix, and skip-summary flags', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-phase-compare-'));
  const outputDir = path.join(tempDir, 'artifacts');
  const { promptfooPath, argsDir, countFile } = createFakePromptfoo(tempDir, 'pass');

  const result = spawnSync('sh', [
    SCRIPT_PATH,
    '--output-dir',
    outputDir,
    '--output-prefix',
    'compare.personalization',
    '--skip-summary',
    'evals/promptfoo/promptfooconfig.compare.yaml',
  ], {
    cwd: ROOT,
    env: {
      ...process.env,
      FAKE_PROMPTFOO_ARGS_DIR: argsDir,
      FAKE_PROMPTFOO_COUNT_FILE: countFile,
      FAKE_PROMPTFOO_BEHAVIOR: 'pass',
      FAKE_PROMPTFOO_REPORT_PASS: createPromptfooReport({ success: true }),
      FAKE_PROMPTFOO_REPORT_ERROR: createPromptfooReport({ success: false, error: 'API error: 429 Too Many Requests' }),
      FAKE_PROMPTFOO_REPORT_FLAKY_FAIL: createPromptfooReport({ success: false, reason: 'LLM rubric failed', tags: ['sample', 'flaky'] }),
      PROMPTFOO_BIN: promptfooPath,
    },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  const invocations = readInvocationArgs(argsDir);
  assert.equal(invocations.length, 1);
  assert.equal(invocations[0][invocations[0].indexOf('-o') + 1], path.join(outputDir, 'compare.personalization.json'));
  assert.doesNotMatch(result.stdout, /summary_path=/);
});
