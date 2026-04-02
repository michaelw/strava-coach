#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readJson, writeText } = require('./fs_utils.cjs');

function getPromptfooRows(report) {
  return Array.isArray(report?.results?.results) ? report.results.results : [];
}

function formatDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  if (durationMs >= 1000) {
    return `${(durationMs / 1000).toFixed(1)}s`;
  }
  return `${Math.round(durationMs)}ms`;
}

function relativeArtifactPath(artifactDir, filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(artifactDir, filePath) || path.basename(filePath);
}

function parseArtifactFileName(filePath) {
  const baseName = path.basename(filePath, '.json');
  const match = baseName.match(/^(.*)\.retry-(errors|flaky)\.(\d+)$/);
  if (!match) {
    return {
      phaseName: baseName,
      phaseMode: baseName.split('.')[0],
      attemptKind: 'initial',
      attemptNumber: 0,
      attemptOrder: 0,
    };
  }

  const [, phaseName, attemptKind, attemptNumberRaw] = match;
  const attemptNumber = Number.parseInt(attemptNumberRaw, 10);
  const attemptBase = attemptKind === 'errors' ? 100 : 200;
  return {
    phaseName,
    phaseMode: phaseName.split('.')[0],
    attemptKind,
    attemptNumber,
    attemptOrder: attemptBase + attemptNumber,
  };
}

function getFailureReason(row, fallbackRow) {
  return String(
    row?.error
      || row?.gradingResult?.reason
      || row?.failureReason
      || fallbackRow?.error
      || fallbackRow?.gradingResult?.reason
      || fallbackRow?.failureReason
      || 'Promptfoo assertion failed',
  );
}

function isExpectedGradingFailure(row) {
  const candidateError = row?.error || '';
  if (!candidateError || row?.gradingResult?.pass !== false) {
    return false;
  }

  if (
    candidateError === row.gradingResult.reason
    && candidateError.startsWith('Output not selected:')
  ) {
    return true;
  }

  return Array.isArray(row.gradingResult.componentResults)
    && row.gradingResult.componentResults.some((component) => component?.reason === candidateError);
}

function getInfrastructureError(row, fallbackRow) {
  const candidateError = row?.error || '';
  if (candidateError && !isExpectedGradingFailure(row)) {
    return candidateError;
  }

  const fallbackError = fallbackRow?.error || '';
  if (!fallbackError) {
    return '';
  }

  return isExpectedGradingFailure(fallbackRow) ? '' : fallbackError;
}

function inferCompareWinner(candidateRow, baselineRow) {
  if (candidateRow?.success && !baselineRow?.success) {
    return 'candidate';
  }
  if (!candidateRow?.success && baselineRow?.success) {
    return 'baseline';
  }
  if (candidateRow?.success && baselineRow?.success) {
    return 'tie';
  }
  return 'unknown';
}

function summarizeGroupedRows(rows, phaseMode, phaseName) {
  const sortedRows = [...rows].sort((left, right) => (left.promptIdx || 0) - (right.promptIdx || 0));
  const candidateRow = sortedRows.find((row) => row.promptIdx === 0) || sortedRows[0];
  const baselineRow = sortedRows.find((row) => row.promptIdx === 1) || null;
  const metadata = candidateRow?.testCase?.metadata || sortedRows[0]?.testCase?.metadata || {};
  const durationMs = sortedRows.reduce((total, row) => total + (row.latencyMs || 0), 0);
  const infrastructureError = getInfrastructureError(candidateRow, baselineRow);
  const status = infrastructureError
    ? 'error'
    : (candidateRow?.success ? 'passed' : 'failed');

  return {
    id: metadata.id || `test-${candidateRow?.testIdx ?? 'unknown'}`,
    suite: metadata.suite || 'unknown',
    phase: phaseName,
    status,
    durationMs,
    duration: formatDuration(durationMs),
    reason: status === 'passed' ? '' : getFailureReason(candidateRow, baselineRow),
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    winner: phaseMode === 'compare' ? inferCompareWinner(candidateRow, baselineRow) : null,
  };
}

function summarizePromptfooPhaseReport(report, {
  phaseName,
  phaseMode = phaseName.split('.')[0],
  artifactDir,
  jsonPath,
  attemptKind = 'initial',
  attemptNumber = 0,
  attemptOrder = 0,
}) {
  const rows = getPromptfooRows(report);
  const groupedRows = new Map();

  for (const row of rows) {
    const groupKey = row.testIdx != null
      ? String(row.testIdx)
      : `${row.testCase?.metadata?.suite || 'unknown'}:${row.testCase?.metadata?.id || row.id || groupedRows.size}`;
    if (!groupedRows.has(groupKey)) {
      groupedRows.set(groupKey, []);
    }
    groupedRows.get(groupKey).push(row);
  }

  const tests = [...groupedRows.values()]
    .map((group) => summarizeGroupedRows(group, phaseMode, phaseName))
    .sort((left, right) => `${left.suite}/${left.id}`.localeCompare(`${right.suite}/${right.id}`));
  const passed = tests.filter((test) => test.status === 'passed').length;
  const failed = tests.filter((test) => test.status === 'failed').length;
  const errors = tests.filter((test) => test.status === 'error').length;

  return {
    name: phaseName,
    evalId: report?.evalId || null,
    timestamp: report?.results?.timestamp || null,
    promptCount: Array.isArray(report?.results?.prompts) ? report.results.prompts.length : 0,
    reportPath: relativeArtifactPath(artifactDir, jsonPath),
    attemptKind,
    attemptNumber,
    attemptOrder,
    totals: {
      tests: tests.length,
      passed,
      failed,
      errors,
    },
    tests,
  };
}

function aggregateLogicalTests(phases) {
  const groupedTests = new Map();

  for (const phase of phases) {
    const sortedTests = [...phase.tests].sort((left, right) => `${left.suite}/${left.id}`.localeCompare(`${right.suite}/${right.id}`));
    for (const test of sortedTests) {
      const logicalKey = `${phase.name}:${test.suite}/${test.id}`;
      if (!groupedTests.has(logicalKey)) {
        groupedTests.set(logicalKey, []);
      }
      groupedTests.get(logicalKey).push({
        ...test,
        phaseAttemptKind: phase.attemptKind,
        phaseAttemptNumber: phase.attemptNumber,
        phaseAttemptOrder: phase.attemptOrder,
      });
    }
  }

  return [...groupedTests.values()]
    .map((history) => {
      const sortedHistory = [...history].sort((left, right) => left.phaseAttemptOrder - right.phaseAttemptOrder);
      const finalAttempt = sortedHistory[sortedHistory.length - 1];
      const retries = Math.max(0, sortedHistory.length - 1);
      const hadFailure = sortedHistory.some((attempt) => attempt.status === 'failed');
      const hadError = sortedHistory.some((attempt) => attempt.status === 'error');

      let finalStatus = finalAttempt.status;
      if (finalAttempt.status === 'passed') {
        if (hadFailure) {
          finalStatus = 'flaky_pass';
        } else if (hadError) {
          finalStatus = 'recovered_error';
        }
      }

      return {
        ...finalAttempt,
        status: finalStatus,
        retries,
        attemptCount: sortedHistory.length,
      };
    })
    .sort((left, right) => `${left.suite}/${left.id}`.localeCompare(`${right.suite}/${right.id}`));
}

function buildCombinedReport({ artifactDir, phaseReports }) {
  const phases = phaseReports
    .map((phaseReport) => summarizePromptfooPhaseReport(phaseReport.report, {
      phaseName: phaseReport.phaseName,
      phaseMode: phaseReport.phaseMode,
      artifactDir,
      jsonPath: phaseReport.jsonPath,
      attemptKind: phaseReport.attemptKind,
      attemptNumber: phaseReport.attemptNumber,
      attemptOrder: phaseReport.attemptOrder,
    }))
    .sort((left, right) => {
      const phaseCompare = left.name.localeCompare(right.name);
      return phaseCompare !== 0 ? phaseCompare : left.attemptOrder - right.attemptOrder;
    });
  const tests = aggregateLogicalTests(phases);
  const passed = tests.filter((test) => test.status === 'passed').length;
  const flakyPassed = tests.filter((test) => test.status === 'flaky_pass').length;
  const recoveredErrors = tests.filter((test) => test.status === 'recovered_error').length;
  const failed = tests.filter((test) => test.status === 'failed').length;
  const errors = tests.filter((test) => test.status === 'error').length;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    result: errors > 0 ? 'ERROR' : (failed === 0 ? 'PASS' : 'FAIL'),
    totals: {
      tests: tests.length,
      passed,
      flakyPassed,
      recoveredErrors,
      failed,
      errors,
    },
    phases,
    tests,
  };
}

function buildMarkdownSummary(runReport) {
  const lines = [
    '## Prompt Eval Summary',
    '',
    `- Result: ${runReport.result}`,
    `- Tests: ${runReport.totals.tests}`,
    `- Passed: ${runReport.totals.passed}`,
    `- Flaky Passed: ${runReport.totals.flakyPassed}`,
    `- Recovered Errors: ${runReport.totals.recoveredErrors}`,
    `- Failed: ${runReport.totals.failed}`,
    `- Errors: ${runReport.totals.errors}`,
  ];

  if (runReport.phases.length) {
    lines.push('', '### Promptfoo Reports', '');
    for (const phase of runReport.phases) {
      lines.push(`- ${phase.name}: ${phase.reportPath}`);
    }
  }

  if (runReport.tests.length) {
    lines.push('', '### Completed Cases', '');
    for (const test of runReport.tests) {
      const parts = [
        `- ${test.status.toUpperCase()}`,
        `${test.suite}/${test.id}`,
      ];
      if (test.duration) {
        parts.push(`(${test.duration})`);
      }
      parts.push(`[${test.phase}]`);
      if (test.retries) {
        parts.push(`retries=${test.retries}`);
      }
      if (test.winner) {
        parts.push(`winner=${test.winner}`);
      }
      if (test.reason) {
        parts.push(`reason: ${test.reason}`);
      }
      lines.push(parts.join(' '));
    }
  }

  return `${lines.join('\n')}\n`;
}

function listPromptfooJsonReports(artifactDir) {
  if (!fs.existsSync(artifactDir)) {
    return [];
  }
  return fs
    .readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .filter((name) => name !== 'summary.json')
    .map((name) => path.join(artifactDir, name))
    .map((jsonPath) => {
      const report = readJson(jsonPath);
      if (!Array.isArray(report?.results?.results)) {
        return null;
      }
      const parsedName = parseArtifactFileName(jsonPath);
      return {
        phaseName: parsedName.phaseName,
        phaseMode: parsedName.phaseMode,
        attemptKind: parsedName.attemptKind,
        attemptNumber: parsedName.attemptNumber,
        attemptOrder: parsedName.attemptOrder,
        jsonPath,
        report,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const phaseCompare = left.phaseName.localeCompare(right.phaseName);
      return phaseCompare !== 0 ? phaseCompare : left.attemptOrder - right.attemptOrder;
    });
}

function writeSummary({ artifactDir, outputPath }) {
  const phaseReports = listPromptfooJsonReports(artifactDir);
  if (!phaseReports.length) {
    throw new Error(`No Promptfoo json reports found under ${artifactDir}`);
  }
  const runReport = buildCombinedReport({
    artifactDir,
    phaseReports,
  });
  const summaryPath = outputPath || path.join(artifactDir, 'summary.md');
  writeText(summaryPath, buildMarkdownSummary(runReport));
  return {
    runReport,
    summaryPath,
  };
}

function parseArgs(argv) {
  const args = {
    artifactDir: null,
    outputPath: null,
    check: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact-dir') {
      args.artifactDir = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--output') {
      args.outputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node evals/promptfoo/promptfoo_summary.cjs --artifact-dir <dir> [--output <path>] [--check]');
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.artifactDir) {
    throw new Error('--artifact-dir is required');
  }

  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { runReport, summaryPath } = writeSummary(args);
  console.log(`summary_path=${summaryPath}`);
  console.log(`result=${runReport.result}`);
  if (args.check && runReport.result !== 'PASS') {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  aggregateLogicalTests,
  buildCombinedReport,
  buildMarkdownSummary,
  formatDuration,
  getPromptfooRows,
  inferCompareWinner,
  parseArtifactFileName,
  listPromptfooJsonReports,
  summarizePromptfooPhaseReport,
  writeSummary,
};
