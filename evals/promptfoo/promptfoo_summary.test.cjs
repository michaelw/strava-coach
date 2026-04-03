const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  aggregateLogicalTests,
  appendGithubStepSummary,
  buildCombinedReport,
  buildHighSignalSummary,
  buildMarkdownSummary,
  buildStepSummary,
  inferReliableCompareDecision,
  inferCompareWinner,
  parseArtifactFileName,
  listPromptfooJsonReports,
  summarizePromptfooPhaseReport,
  writeSummary,
} = require('./promptfoo_summary.cjs');

function createPromptfooReport(rows, prompts = [{ label: 'candidate' }]) {
  return {
    evalId: 'eval-test',
    results: {
      timestamp: '2026-04-02T01:00:00.000Z',
      prompts,
      results: rows,
    },
  };
}

test('inferCompareWinner distinguishes candidate, baseline, and unknown results', () => {
  assert.equal(inferCompareWinner({ success: true }, { success: false }), 'candidate');
  assert.equal(inferCompareWinner({ success: false }, { success: true }), 'baseline');
  assert.equal(inferCompareWinner({ success: false }, { success: false }), 'unknown');
});

test('inferReliableCompareDecision requires enough decisive repeats and a two-vote margin', () => {
  assert.equal(inferReliableCompareDecision({ candidate: 3, baseline: 0, tie: 0, unknown: 0 }), 'candidate');
  assert.equal(inferReliableCompareDecision({ candidate: 0, baseline: 3, tie: 0, unknown: 0 }), 'baseline');
  assert.equal(inferReliableCompareDecision({ candidate: 2, baseline: 1, tie: 0, unknown: 0 }), 'tie');
  assert.equal(inferReliableCompareDecision({ candidate: 1, baseline: 1, tie: 1, unknown: 0 }), 'noisy');
});

test('parseArtifactFileName distinguishes initial and retry artifacts', () => {
  assert.deepEqual(parseArtifactFileName('/tmp/self.json'), {
    phaseName: 'self',
    phaseMode: 'self',
    attemptKind: 'initial',
    attemptNumber: 0,
    attemptOrder: 0,
  });
  assert.deepEqual(parseArtifactFileName('/tmp/self.retry-errors.2.json'), {
    phaseName: 'self',
    phaseMode: 'self',
    attemptKind: 'errors',
    attemptNumber: 2,
    attemptOrder: 102,
  });
  assert.deepEqual(parseArtifactFileName('/tmp/compare.personalization.retry-flaky.1.json'), {
    phaseName: 'compare.personalization',
    phaseMode: 'compare',
    attemptKind: 'flaky',
    attemptNumber: 1,
    attemptOrder: 201,
  });
});

test('summarizePromptfooPhaseReport reduces self-grading rows to logical case summaries', () => {
  const phase = summarizePromptfooPhaseReport(
    createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: true,
        latencyMs: 1800,
        testCase: {
          metadata: {
            id: 'grounding-001',
            suite: 'grounding',
          },
        },
      },
    ]),
    {
      phaseName: 'self',
      artifactDir: '/tmp/artifacts/run-1',
      jsonPath: '/tmp/artifacts/run-1/report.self.json',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    },
  );

  assert.equal(phase.totals.tests, 1);
  assert.equal(phase.totals.passed, 1);
  assert.equal(phase.totals.errors, 0);
  assert.equal(phase.tests[0].status, 'passed');
  assert.equal(phase.tests[0].duration, '1.8s');
  assert.equal(phase.reportPath, 'report.self.json');
});

test('summarizePromptfooPhaseReport collapses compare rows onto the candidate result', () => {
  const phase = summarizePromptfooPhaseReport(
    createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: false,
        latencyMs: 2100,
        gradingResult: {
          reason: 'The baseline response was selected as the better answer.',
        },
        testCase: {
          repeat: 5,
          metadata: {
            id: 'personalization-001',
            suite: 'personalization',
            compare_gate: 'reliable-blocker',
          },
        },
      },
      {
        testIdx: 0,
        promptIdx: 1,
        success: true,
        latencyMs: 1900,
        testCase: {
          repeat: 5,
          metadata: {
            id: 'personalization-001',
            suite: 'personalization',
            compare_gate: 'reliable-blocker',
          },
        },
      },
    ], [{ label: 'candidate' }, { label: 'baseline' }]),
    {
      phaseName: 'compare',
      artifactDir: '/tmp/artifacts/run-1',
      jsonPath: '/tmp/artifacts/run-1/report.compare.json',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    },
  );

  assert.equal(phase.totals.tests, 1);
  assert.equal(phase.totals.failed, 1);
  assert.equal(phase.totals.errors, 0);
  assert.equal(phase.tests[0].winner, 'baseline');
  assert.equal(phase.tests[0].compareGate, 'reliable-blocker');
  assert.equal(phase.tests[0].repeat, 5);
  assert.match(phase.tests[0].reason, /baseline response was selected/i);
  assert.equal(phase.tests[0].duration, '4.0s');
});

test('summarizePromptfooPhaseReport ignores select-best loser rows as infrastructure errors', () => {
  const phase = summarizePromptfooPhaseReport(
    createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: true,
        latencyMs: 2100,
        gradingResult: {
          pass: true,
          reason: 'All assertions passed',
        },
        testCase: {
          repeat: 5,
          metadata: {
            id: 'personalization-001',
            suite: 'personalization',
            compare_gate: 'reliable-blocker',
          },
        },
      },
      {
        testIdx: 0,
        promptIdx: 1,
        success: false,
        latencyMs: 1900,
        error: 'Output not selected: Prefer the candidate response.',
        gradingResult: {
          pass: false,
          reason: 'Output not selected: Prefer the candidate response.',
        },
        testCase: {
          repeat: 5,
          metadata: {
            id: 'personalization-001',
            suite: 'personalization',
            compare_gate: 'reliable-blocker',
          },
        },
      },
    ], [{ label: 'candidate' }, { label: 'baseline' }]),
    {
      phaseName: 'compare',
      artifactDir: '/tmp/artifacts/run-1',
      jsonPath: '/tmp/artifacts/run-1/report.compare.json',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    },
  );

  assert.equal(phase.totals.tests, 1);
  assert.equal(phase.totals.passed, 1);
  assert.equal(phase.totals.failed, 0);
  assert.equal(phase.totals.errors, 0);
  assert.equal(phase.tests[0].status, 'passed');
  assert.equal(phase.tests[0].winner, 'candidate');
  assert.equal(phase.tests[0].reason, '');
});

test('summarizePromptfooPhaseReport classifies API errors as infrastructure errors', () => {
  const phase = summarizePromptfooPhaseReport(
    createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: false,
        latencyMs: 900,
        error: 'API error: 400 Bad Request',
        testCase: {
          metadata: {
            id: 'grounding-001',
            suite: 'grounding',
          },
        },
      },
    ]),
    {
      phaseName: 'self',
      artifactDir: '/tmp/artifacts/run-1',
      jsonPath: '/tmp/artifacts/run-1/report.self.json',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    },
  );

  assert.equal(phase.totals.tests, 1);
  assert.equal(phase.totals.failed, 0);
  assert.equal(phase.totals.errors, 1);
  assert.equal(phase.tests[0].status, 'error');
  assert.match(phase.tests[0].reason, /API error/i);
});

test('summarizePromptfooPhaseReport treats assertion errors surfaced via row.error as failures, not infrastructure errors', () => {
  const phase = summarizePromptfooPhaseReport(
    createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: false,
        latencyMs: 900,
        error: 'Expected output to contain all of [return-to-run, running]. Missing: [running]',
        gradingResult: {
          pass: false,
          reason: 'Promptfoo assertion failed',
          componentResults: [
            {
              pass: false,
              score: 0,
              reason: 'Expected output to contain all of [return-to-run, running]. Missing: [running]',
            },
          ],
        },
        testCase: {
          metadata: {
            id: 'grounding-002',
            suite: 'grounding',
          },
        },
      },
    ]),
    {
      phaseName: 'self',
      artifactDir: '/tmp/artifacts/run-1',
      jsonPath: '/tmp/artifacts/run-1/report.self.json',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    },
  );

  assert.equal(phase.totals.tests, 1);
  assert.equal(phase.totals.failed, 1);
  assert.equal(phase.totals.errors, 0);
  assert.equal(phase.tests[0].status, 'failed');
  assert.match(phase.tests[0].reason, /return-to-run/);
});

test('buildCombinedReport aggregates logical tests across phases and markdown lists completed cases', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/report.self.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: true,
            latencyMs: 1200,
            testCase: {
              metadata: {
                id: 'grounding-001',
                suite: 'grounding',
              },
            },
          },
        ]),
      },
      {
        phaseName: 'compare',
        jsonPath: '/tmp/artifacts/workflow-001/report.compare.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            latencyMs: 2000,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
              },
            },
          },
          {
            testIdx: 0,
            promptIdx: 1,
            success: true,
            latencyMs: 1700,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
              },
            },
          },
        ], [{ label: 'candidate' }, { label: 'baseline' }]),
      },
    ],
  });

  const markdown = buildMarkdownSummary(runReport);

  assert.equal(runReport.result, 'PASS');
  assert.equal(runReport.totals.tests, 2);
  assert.equal(runReport.totals.passed, 2);
  assert.equal(runReport.totals.flakyPassed, 0);
  assert.equal(runReport.totals.recoveredErrors, 0);
  assert.equal(runReport.totals.failed, 0);
  assert.equal(runReport.totals.errors, 0);
  assert.equal(runReport.tests[1].compareDecision, 'noisy');
  assert.deepEqual(runReport.tests[1].compareCounts, {
    candidate: 0,
    baseline: 1,
    tie: 0,
    unknown: 0,
  });
  assert.match(markdown, /grounding\/grounding-001/);
  assert.match(markdown, /personalization\/personalization-001/);
  assert.match(markdown, /decision=noisy/);
  assert.match(markdown, /candidate=0 baseline=1 tie=0 unknown=0/);
  assert.match(markdown, /gate=pass/);
  assert.match(markdown, /report\.self\.json/);
  assert.doesNotMatch(markdown, /\.html/);
});

test('buildCombinedReport marks infrastructure errors as ERROR, not FAIL', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/report.self.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            error: 'API error: 400 Bad Request',
            latencyMs: 1200,
            testCase: {
              metadata: {
                id: 'grounding-001',
                suite: 'grounding',
              },
            },
          },
        ]),
      },
    ],
  });

  const markdown = buildMarkdownSummary(runReport);

  assert.equal(runReport.result, 'ERROR');
  assert.equal(runReport.totals.tests, 1);
  assert.equal(runReport.totals.flakyPassed, 0);
  assert.equal(runReport.totals.recoveredErrors, 0);
  assert.equal(runReport.totals.failed, 0);
  assert.equal(runReport.totals.errors, 1);
  assert.match(markdown, /Status: ERROR/);
  assert.match(markdown, /Errors: 1/);
  assert.match(markdown, /ERROR grounding\/grounding-001/);
  assert.match(markdown, /API error: 400 Bad Request/);
  assert.doesNotMatch(markdown, /\.html/);
});

test('buildHighSignalSummary makes PASS obvious in stdout-friendly form', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/self.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: true,
            latencyMs: 1200,
            testCase: {
              metadata: {
                id: 'smoke-001',
                suite: 'smoke',
              },
            },
          },
        ]),
      },
    ],
  });

  const summary = buildHighSignalSummary(runReport);

  assert.match(summary, /^Prompt Eval: PASS/m);
  assert.match(summary, /Totals: tests=1 passed=1 flaky_passed=0 recovered_errors=0 failed=0 errors=0/);
  assert.match(summary, /Needs Attention: none/);
});

test('buildStepSummary and markdown front-load failing case context', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'compare.personalization',
        phaseMode: 'compare',
        jsonPath: '/tmp/artifacts/workflow-001/compare.personalization.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 0,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 1,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 1,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 2,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 2,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
        ], [{ label: 'candidate' }, { label: 'baseline' }]),
      },
    ],
  });

  const stepSummary = buildStepSummary(runReport);
  const markdown = buildMarkdownSummary(runReport);

  assert.match(stepSummary, /## Prompt Eval Outcome/);
  assert.match(stepSummary, /- Status: FAIL/);
  assert.match(stepSummary, /### Needs Attention/);
  assert.match(stepSummary, /FAILED personalization\/personalization-001 \[compare\.personalization\]/);
  assert.match(stepSummary, /decision=baseline/);
  assert.match(stepSummary, /gate=fail/);
  assert.match(markdown, /## Prompt Eval Outcome/);
  assert.match(markdown, /### Needs Attention/);
  assert.match(markdown, /candidate=0 baseline=3 tie=0 unknown=0/);
});

test('aggregateLogicalTests marks error recovery and flaky passes distinctly', () => {
  const phases = [
    {
      name: 'self',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
      tests: [
        {
          id: 'grounding-001',
          suite: 'grounding',
          phase: 'self',
          status: 'error',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'API error: timeout',
          winner: null,
          tags: [],
        },
        {
          id: 'smoke-001',
          suite: 'smoke',
          phase: 'self',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'LLM rubric failed',
          winner: null,
          tags: ['flaky'],
        },
      ],
    },
    {
      name: 'self',
      attemptKind: 'errors',
      attemptNumber: 1,
      attemptOrder: 101,
      tests: [
        {
          id: 'grounding-001',
          suite: 'grounding',
          phase: 'self',
          status: 'passed',
          durationMs: 900,
          duration: '900ms',
          reason: '',
          winner: null,
          tags: [],
        },
      ],
    },
    {
      name: 'self',
      attemptKind: 'flaky',
      attemptNumber: 1,
      attemptOrder: 201,
      tests: [
        {
          id: 'smoke-001',
          suite: 'smoke',
          phase: 'self',
          status: 'passed',
          durationMs: 950,
          duration: '950ms',
          reason: '',
          winner: null,
          tags: ['flaky'],
        },
      ],
    },
  ];

  const tests = aggregateLogicalTests(phases);
  const grounding = tests.find((entry) => entry.id === 'grounding-001');
  const smoke = tests.find((entry) => entry.id === 'smoke-001');

  assert.equal(grounding.status, 'recovered_error');
  assert.equal(grounding.retries, 1);
  assert.equal(smoke.status, 'flaky_pass');
  assert.equal(smoke.retries, 1);
});

test('aggregateLogicalTests treats split compare repeats as non-failing tie or noisy results', () => {
  const phases = [
    {
      name: 'compare.personalization',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
      tests: [
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'candidate',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
      ],
    },
    {
      name: 'compare.personalization',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
      tests: [
        {
          id: 'personalization-003',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'advisory',
          repeat: 3,
        },
        {
          id: 'personalization-003',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'candidate',
          tags: ['flaky'],
          compareGate: 'advisory',
          repeat: 3,
        },
        {
          id: 'personalization-003',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'unknown',
          tags: ['flaky'],
          compareGate: 'advisory',
          repeat: 3,
        },
      ],
    },
  ];

  const tests = aggregateLogicalTests(phases);
  const reliable = tests.find((entry) => entry.id === 'personalization-001');
  const advisory = tests.find((entry) => entry.id === 'personalization-003');

  assert.equal(reliable.status, 'passed');
  assert.equal(reliable.compareDecision, 'tie');
  assert.equal(reliable.gateStatus, 'pass');
  assert.deepEqual(reliable.compareCounts, {
    candidate: 1,
    baseline: 2,
    tie: 0,
    unknown: 0,
  });
  assert.equal(advisory.status, 'passed');
  assert.equal(advisory.compareDecision, 'noisy');
  assert.equal(advisory.gateStatus, 'pass');
  assert.deepEqual(advisory.compareCounts, {
    candidate: 1,
    baseline: 1,
    tie: 0,
    unknown: 1,
  });
});

test('buildCombinedReport fails only on reliable compare losses', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'compare.personalization',
        phaseMode: 'compare',
        jsonPath: '/tmp/artifacts/workflow-001/compare.personalization.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 0,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 1,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 1,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 2,
            promptIdx: 0,
            success: false,
            latencyMs: 1200,
            gradingResult: {
              reason: 'The baseline response was selected as the better answer.',
            },
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
          {
            testIdx: 2,
            promptIdx: 1,
            success: true,
            latencyMs: 1200,
            testCase: {
              repeat: 5,
              metadata: {
                id: 'personalization-001',
                suite: 'personalization',
                compare_gate: 'reliable-blocker',
                tags: ['flaky'],
              },
            },
          },
        ], [{ label: 'candidate' }, { label: 'baseline' }]),
      },
    ],
  });

  assert.equal(runReport.result, 'FAIL');
  assert.equal(runReport.totals.failed, 1);
  assert.equal(runReport.tests[0].status, 'failed');
  assert.equal(runReport.tests[0].compareDecision, 'baseline');
  assert.equal(runReport.tests[0].gateStatus, 'fail');
  assert.match(runReport.tests[0].reason, /Reliable compare loss/);
});

test('aggregateLogicalTests marks retried compare losses as flaky passes when retries remove a reliable loss', () => {
  const phases = [
    {
      name: 'compare.personalization',
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
      tests: [
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'failed',
          durationMs: 1000,
          duration: '1.0s',
          reason: 'Baseline selected',
          winner: 'baseline',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
      ],
    },
    {
      name: 'compare.personalization',
      attemptKind: 'flaky',
      attemptNumber: 1,
      attemptOrder: 201,
      tests: [
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'candidate',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'candidate',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
        {
          id: 'personalization-001',
          suite: 'personalization',
          phase: 'compare.personalization',
          status: 'passed',
          durationMs: 1000,
          duration: '1.0s',
          reason: '',
          winner: 'candidate',
          tags: ['flaky'],
          compareGate: 'reliable-blocker',
          repeat: 5,
        },
      ],
    },
  ];

  const tests = aggregateLogicalTests(phases);
  assert.equal(tests[0].status, 'flaky_pass');
  assert.equal(tests[0].compareDecision, 'tie');
  assert.equal(tests[0].gateStatus, 'pass');
  assert.equal(tests[0].retries, 1);
});

test('buildCombinedReport treats recovered and flaky passes as overall PASS', () => {
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'self',
        phaseMode: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/self.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            error: 'API error: timeout',
            latencyMs: 1200,
            testCase: {
              metadata: {
                id: 'grounding-001',
                suite: 'grounding',
                tags: [],
              },
            },
          },
          {
            testIdx: 1,
            promptIdx: 0,
            success: false,
            latencyMs: 1500,
            gradingResult: {
              reason: 'LLM rubric failed',
            },
            testCase: {
              metadata: {
                id: 'smoke-001',
                suite: 'smoke',
                tags: ['flaky'],
              },
            },
          },
        ]),
      },
      {
        phaseName: 'self',
        phaseMode: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/self.retry-errors.1.json',
        attemptKind: 'errors',
        attemptNumber: 1,
        attemptOrder: 101,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: true,
            latencyMs: 1000,
            testCase: {
              metadata: {
                id: 'grounding-001',
                suite: 'grounding',
                tags: [],
              },
            },
          },
        ]),
      },
      {
        phaseName: 'self',
        phaseMode: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/self.retry-flaky.1.json',
        attemptKind: 'flaky',
        attemptNumber: 1,
        attemptOrder: 201,
        report: createPromptfooReport([
          {
            testIdx: 1,
            promptIdx: 0,
            success: true,
            latencyMs: 900,
            testCase: {
              metadata: {
                id: 'smoke-001',
                suite: 'smoke',
                tags: ['flaky'],
              },
            },
          },
        ]),
      },
    ],
  });

  const markdown = buildMarkdownSummary(runReport);

  assert.equal(runReport.result, 'PASS');
  assert.equal(runReport.totals.tests, 2);
  assert.equal(runReport.totals.passed, 0);
  assert.equal(runReport.totals.flakyPassed, 1);
  assert.equal(runReport.totals.recoveredErrors, 1);
  assert.equal(runReport.totals.failed, 0);
  assert.equal(runReport.totals.errors, 0);
  assert.match(markdown, /Flaky Passed: 1/);
  assert.match(markdown, /Recovered Errors: 1/);
  assert.match(markdown, /FLAKY_PASS smoke\/smoke-001/);
  assert.match(markdown, /RECOVERED_ERROR grounding\/grounding-001/);
});

test('appendGithubStepSummary writes a compact summary for failing runs', () => {
  const stepSummaryPath = path.join(os.tmpdir(), `strava-coach-step-summary-${Date.now()}.md`);
  const runReport = buildCombinedReport({
    artifactDir: '/tmp/artifacts/workflow-001',
    phaseReports: [
      {
        phaseName: 'self',
        jsonPath: '/tmp/artifacts/workflow-001/self.json',
        attemptKind: 'initial',
        attemptNumber: 0,
        attemptOrder: 0,
        report: createPromptfooReport([
          {
            testIdx: 0,
            promptIdx: 0,
            success: false,
            error: 'API error: 400 Bad Request',
            latencyMs: 1200,
            testCase: {
              metadata: {
                id: 'grounding-001',
                suite: 'grounding',
              },
            },
          },
        ]),
      },
    ],
  });

  const wroteSummary = appendGithubStepSummary(runReport, stepSummaryPath);
  const summary = fs.readFileSync(stepSummaryPath, 'utf8');

  assert.equal(wroteSummary, true);
  assert.match(summary, /## Prompt Eval Outcome/);
  assert.match(summary, /- Status: ERROR/);
  assert.match(summary, /ERROR grounding\/grounding-001 \[self\]/);
  assert.match(summary, /API error: 400 Bad Request/);
});

test('listPromptfooJsonReports loads native promptfoo json outputs from an artifact directory', () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-summary-'));
  fs.writeFileSync(path.join(artifactDir, 'self.json'), JSON.stringify(createPromptfooReport([])), 'utf8');
  fs.writeFileSync(path.join(artifactDir, 'compare.personalization.json'), JSON.stringify(createPromptfooReport([])), 'utf8');
  fs.writeFileSync(path.join(artifactDir, 'notes.json'), JSON.stringify({ unrelated: true }), 'utf8');

  const phaseReports = listPromptfooJsonReports(artifactDir);

  assert.deepEqual(phaseReports.map((entry) => path.basename(entry.jsonPath)), [
    'compare.personalization.json',
    'self.json',
  ]);
  assert.deepEqual(phaseReports.map((entry) => entry.phaseName), ['compare.personalization', 'self']);
  assert.deepEqual(phaseReports.map((entry) => entry.phaseMode), ['compare', 'self']);
  assert.deepEqual(phaseReports.map((entry) => entry.attemptKind), ['initial', 'initial']);
});

test('writeSummary writes markdown from all promptfoo reports in a directory', () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-summary-'));
  fs.writeFileSync(
    path.join(artifactDir, 'self.json'),
    JSON.stringify(createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: true,
        latencyMs: 1250,
        testCase: {
          metadata: {
            id: 'smoke-001',
            suite: 'smoke',
          },
        },
      },
    ])),
    'utf8',
  );

  const { runReport, summaryPath } = writeSummary({ artifactDir });
  const summary = fs.readFileSync(summaryPath, 'utf8');

  assert.equal(runReport.result, 'PASS');
  assert.equal(runReport.totals.errors, 0);
  assert.equal(runReport.totals.flakyPassed, 0);
  assert.equal(runReport.totals.recoveredErrors, 0);
  assert.match(summary, /smoke\/smoke-001/);
  assert.match(summary, /Errors: 0/);
  assert.match(summary, /Flaky Passed: 0/);
  assert.match(summary, /Recovered Errors: 0/);
  assert.match(summary, /self\.json/);
  assert.doesNotMatch(summary, /\.html/);
});

test('summary cli prints a high-signal failure block before exiting non-zero', () => {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-summary-cli-'));
  const stepSummaryPath = path.join(artifactDir, 'step-summary.md');
  fs.writeFileSync(
    path.join(artifactDir, 'self.json'),
    JSON.stringify(createPromptfooReport([
      {
        testIdx: 0,
        promptIdx: 0,
        success: false,
        error: 'API error: 429 Too Many Requests',
        latencyMs: 1250,
        testCase: {
          metadata: {
            id: 'smoke-001',
            suite: 'smoke',
          },
        },
      },
    ])),
    'utf8',
  );

  const result = spawnSync('node', [
    path.join(__dirname, 'promptfoo_summary.cjs'),
    '--artifact-dir',
    artifactDir,
    '--check',
  ], {
    env: {
      ...process.env,
      GITHUB_STEP_SUMMARY: stepSummaryPath,
    },
    encoding: 'utf8',
  });

  const stepSummary = fs.readFileSync(stepSummaryPath, 'utf8');

  assert.equal(result.status, 1);
  assert.match(result.stdout, /^Prompt Eval: ERROR/m);
  assert.match(result.stdout, /Needs Attention:/);
  assert.match(result.stdout, /ERROR smoke\/smoke-001 \[self\] reason=API error: 429 Too Many Requests/);
  assert.match(result.stdout, /Artifact Dir: /);
  assert.match(result.stdout, /Summary Path: /);
  assert.match(stepSummary, /- Status: ERROR/);
  assert.match(stepSummary, /ERROR smoke\/smoke-001 \[self\]/);
});
