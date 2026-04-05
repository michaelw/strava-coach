const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildMarkdownSummary,
  createRunReport,
  writeSummary,
} = require('./canary_summary.cjs');

function makeRow({
  id,
  suite = 'smoke',
  success = true,
  error = '',
  reason = '',
  repeatIndex = 0,
}) {
  return {
    testIdx: repeatIndex,
    promptIdx: 0,
    repeatIndex,
    success,
    error,
    gradingResult: reason ? { reason } : undefined,
    testCase: {
      metadata: {
        id,
        suite,
        priority: 'critical',
        tags: [],
      },
    },
  };
}

function makePhaseReport(rows, jsonPath = '/tmp/smoke.canary.json') {
  return {
    jsonPath,
    report: {
      results: {
        results: rows,
      },
    },
  };
}

test('createRunReport passes clean canary samples', () => {
  const runReport = createRunReport({
    artifactDir: '/tmp/artifacts',
    phaseReports: [
      makePhaseReport([
        makeRow({ id: 'smoke-001', repeatIndex: 0 }),
        makeRow({ id: 'smoke-001', repeatIndex: 1 }),
        makeRow({ id: 'smoke-001', repeatIndex: 2 }),
      ]),
    ],
    canaryConfig: {
      repeat: 3,
      allowed_failures: 1,
      temperature: 1,
    },
  });

  assert.equal(runReport.result, 'PASS');
  assert.deepEqual(runReport.totals, {
    tests: 1,
    passed: 1,
    warnings: 0,
    failed: 0,
    errors: 0,
    samples: 3,
    samplePasses: 3,
    sampleFailures: 0,
    sampleErrors: 0,
  });
  assert.equal(runReport.tests[0].status, 'passed');
});

test('createRunReport warns on a single unlucky sample within the allowed budget', () => {
  const runReport = createRunReport({
    artifactDir: '/tmp/artifacts',
    phaseReports: [
      makePhaseReport([
        makeRow({ id: 'smoke-005', repeatIndex: 0 }),
        makeRow({ id: 'smoke-005', repeatIndex: 1, success: false, reason: 'Refusal drifted into implementation details.' }),
        makeRow({ id: 'smoke-005', repeatIndex: 2 }),
        makeRow({ id: 'smoke-005', repeatIndex: 3 }),
        makeRow({ id: 'smoke-005', repeatIndex: 4 }),
      ]),
    ],
    canaryConfig: {
      repeat: 5,
      allowed_failures: 1,
      temperature: 1,
    },
  });

  assert.equal(runReport.result, 'WARN');
  assert.equal(runReport.tests[0].status, 'warning');
  assert.equal(runReport.tests[0].failedSamples, 1);
  assert.equal(runReport.tests[0].allowedFailures, 1);
  assert.match(buildMarkdownSummary(runReport), /WARNING smoke\/smoke-005/);
});

test('createRunReport fails when repeated bad samples exceed the allowed budget', () => {
  const runReport = createRunReport({
    artifactDir: '/tmp/artifacts',
    phaseReports: [
      makePhaseReport([
        makeRow({ id: 'smoke-005', repeatIndex: 0, success: false, reason: 'First bad sample.' }),
        makeRow({ id: 'smoke-005', repeatIndex: 1, success: false, reason: 'Second bad sample.' }),
        makeRow({ id: 'smoke-005', repeatIndex: 2 }),
        makeRow({ id: 'smoke-005', repeatIndex: 3 }),
        makeRow({ id: 'smoke-005', repeatIndex: 4 }),
      ]),
    ],
    canaryConfig: {
      repeat: 5,
      allowed_failures: 1,
      temperature: 1,
    },
  });

  assert.equal(runReport.result, 'FAIL');
  assert.equal(runReport.tests[0].status, 'failed');
  assert.equal(runReport.tests[0].failedSamples, 2);
});

test('createRunReport treats self-grading assertion details in row.error as failed samples, not infrastructure errors', () => {
  const runReport = createRunReport({
    artifactDir: '/tmp/artifacts',
    phaseReports: [
      makePhaseReport([
        {
          ...makeRow({ id: 'smoke-005', repeatIndex: 0, success: false }),
          error: 'Promptfoo assertion failed',
          gradingResult: {
            pass: false,
            reason: 'Promptfoo assertion failed',
            componentResults: [
              { reason: 'Promptfoo assertion failed' },
            ],
          },
        },
        makeRow({ id: 'smoke-005', repeatIndex: 1 }),
        makeRow({ id: 'smoke-005', repeatIndex: 2 }),
      ]),
    ],
    canaryConfig: {
      repeat: 3,
      allowed_failures: 1,
      temperature: 1,
    },
  });

  assert.equal(runReport.result, 'WARN');
  assert.equal(runReport.tests[0].status, 'warning');
  assert.equal(runReport.tests[0].failedSamples, 1);
  assert.equal(runReport.tests[0].errorSamples, 0);
});

test('writeSummary writes markdown and json outputs for the canary lane', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-canary-summary-'));
  const reportPath = path.join(tempDir, 'smoke.canary.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    results: {
      results: [
        makeRow({ id: 'smoke-001', repeatIndex: 0 }),
        makeRow({ id: 'smoke-001', repeatIndex: 1, error: '429 Too Many Requests' }),
      ],
    },
  }, null, 2));

  const { runReport, summaryPath, jsonOutputPath } = writeSummary({
    artifactDir: tempDir,
  });

  assert.equal(runReport.result, 'ERROR');
  assert.ok(fs.existsSync(summaryPath));
  assert.ok(fs.existsSync(jsonOutputPath));
  assert.match(fs.readFileSync(summaryPath, 'utf8'), /Smoke Canary Outcome/);
  assert.match(fs.readFileSync(jsonOutputPath, 'utf8'), /"result": "ERROR"/);
});
