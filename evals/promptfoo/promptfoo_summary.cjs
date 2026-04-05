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

function normalizeRepeat(value) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function createEmptyCompareCounts() {
  return {
    candidate: 0,
    baseline: 0,
    tie: 0,
    unknown: 0,
    errors: 0,
  };
}

function countCompareWinners(entries) {
  const counts = createEmptyCompareCounts();
  for (const entry of entries) {
    if (entry.status === 'error') {
      counts.errors += 1;
      continue;
    }
    const winner = entry.winner || 'unknown';
    counts[winner] = (counts[winner] || 0) + 1;
  }
  return counts;
}

function countDecisiveCompareRepeats(compareCounts) {
  return compareCounts.candidate + compareCounts.baseline;
}

function countVisibleCompareRepeats(compareCounts) {
  return compareCounts.candidate + compareCounts.baseline + compareCounts.tie + compareCounts.unknown;
}

function inferReliableCompareDecision(compareCounts) {
  const decisive = countDecisiveCompareRepeats(compareCounts);
  if (decisive < 3) {
    return 'noisy';
  }

  const margin = Math.abs(compareCounts.candidate - compareCounts.baseline);
  if (margin >= 2) {
    return compareCounts.candidate > compareCounts.baseline ? 'candidate' : 'baseline';
  }

  return 'tie';
}

function formatCompareCounts(compareCounts) {
  const parts = [
    `candidate=${compareCounts.candidate}`,
    `baseline=${compareCounts.baseline}`,
    `tie=${compareCounts.tie}`,
    `unknown=${compareCounts.unknown}`,
  ];
  if (compareCounts.errors > 0) {
    parts.push(`errors=${compareCounts.errors}`);
  }
  return parts.join(' ');
}

function formatCompareSummary(test) {
  const parts = [formatCompareCounts(test.compareCounts)];
  if (test.compareCounts?.errors > 0 && test.repeat) {
    parts.push(`decisive=${countDecisiveCompareRepeats(test.compareCounts)}/${test.repeat}`);
  }
  return parts.join(' ');
}

function formatDisplayPath(filePath) {
  const relativePath = path.relative(process.cwd(), filePath);
  if (relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)) {
    return relativePath;
  }
  return filePath;
}

function truncateReason(reason, maxLength = 200) {
  const normalized = String(reason || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 3)}...`;
}

function formatTotalsLine(totals) {
  return `tests=${totals.tests} passed=${totals.passed} flaky_passed=${totals.flakyPassed} recovered_errors=${totals.recoveredErrors} failed=${totals.failed} errors=${totals.errors}`;
}

function getAttentionTests(runReport) {
  return runReport.tests.filter((test) => test.status === 'error' || test.status === 'failed');
}

function formatAttentionEntry(test) {
  const parts = [
    `${test.status.toUpperCase()} ${test.suite}/${test.id}`,
    `[${test.phase}]`,
  ];
  if (test.compareDecision) {
    parts.push(`decision=${test.compareDecision}`);
  }
  if (test.compareCounts) {
    parts.push(formatCompareSummary(test));
  }
  if (test.gateStatus) {
    parts.push(`gate=${test.gateStatus}`);
  }
  if (test.reason) {
    parts.push(`reason=${truncateReason(test.reason)}`);
  }
  return parts.join(' ');
}

function buildHighSignalSummary(runReport, { artifactDir, summaryPath } = {}) {
  const lines = [
    `Prompt Eval: ${runReport.result}`,
    `Totals: ${formatTotalsLine(runReport.totals)}`,
  ];
  const attentionTests = getAttentionTests(runReport);
  if (attentionTests.length) {
    lines.push('Needs Attention:');
    for (const test of attentionTests) {
      lines.push(`- ${formatAttentionEntry(test)}`);
    }
  } else {
    lines.push('Needs Attention: none');
  }
  if (artifactDir) {
    lines.push(`Artifact Dir: ${formatDisplayPath(artifactDir)}`);
  }
  if (summaryPath) {
    lines.push(`Summary Path: ${formatDisplayPath(summaryPath)}`);
  }
  return `${lines.join('\n')}\n`;
}

function buildStepSummary(runReport) {
  const lines = [
    '## Prompt Eval Outcome',
    '',
    `- Status: ${runReport.result}`,
    `- Totals: ${formatTotalsLine(runReport.totals)}`,
  ];
  const attentionTests = getAttentionTests(runReport);
  if (attentionTests.length) {
    lines.push('', '### Needs Attention', '');
    for (const test of attentionTests) {
      lines.push(`- ${formatAttentionEntry(test)}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

function appendGithubStepSummary(runReport, stepSummaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!stepSummaryPath) {
    return false;
  }
  const content = buildStepSummary(runReport);
  const prefix = fs.existsSync(stepSummaryPath) && fs.statSync(stepSummaryPath).size > 0 ? '\n' : '';
  fs.appendFileSync(stepSummaryPath, `${prefix}${content}`, 'utf8');
  return true;
}

function summarizeGroupedRows(rows, phaseMode, phaseName) {
  const sortedRows = [...rows].sort((left, right) => (left.promptIdx || 0) - (right.promptIdx || 0));
  const candidateRow = sortedRows.find((row) => row.promptIdx === 0) || sortedRows[0];
  const baselineRow = sortedRows.find((row) => row.promptIdx === 1) || null;
  const testCase = candidateRow?.testCase || sortedRows[0]?.testCase || {};
  const metadata = testCase?.metadata || {};
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
    compareGate: metadata.compare_gate || null,
    repeat: normalizeRepeat(testCase.repeat),
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
      const attemptGroups = [];
      for (const entry of sortedHistory) {
        const lastGroup = attemptGroups[attemptGroups.length - 1];
        if (lastGroup && lastGroup.attemptOrder === entry.phaseAttemptOrder) {
          lastGroup.entries.push(entry);
        } else {
          attemptGroups.push({
            attemptKind: entry.phaseAttemptKind,
            attemptNumber: entry.phaseAttemptNumber,
            attemptOrder: entry.phaseAttemptOrder,
            entries: [entry],
          });
        }
      }

      const retries = Math.max(0, attemptGroups.length - 1);
      const finalGroup = attemptGroups[attemptGroups.length - 1];
      const finalAttempt = finalGroup.entries[finalGroup.entries.length - 1];
      const hadErrorAttempt = attemptGroups.slice(0, -1).some((group) => group.entries.every((entry) => entry.status === 'error'));

      if (finalAttempt.phase.startsWith('compare')) {
        const compareCounts = countCompareWinners(sortedHistory);
        const compareDecision = inferReliableCompareDecision(compareCounts);
        const hasNonErrorCompareResult = countVisibleCompareRepeats(compareCounts) > 0;
        const hadFailingAttempt = attemptGroups.slice(0, -1).some((group) => {
          const attemptCounts = countCompareWinners(group.entries);
          const attemptDecision = inferReliableCompareDecision(attemptCounts);
          return finalAttempt.compareGate === 'reliable-blocker'
            && finalAttempt.repeat >= 3
            && attemptDecision === 'baseline';
        });
        const gateStatus = finalAttempt.compareGate === 'reliable-blocker'
          && finalAttempt.repeat >= 3
          && compareDecision === 'baseline'
          ? 'fail'
          : 'pass';

        let finalStatus = gateStatus === 'fail' ? 'failed' : 'passed';
        if (!hasNonErrorCompareResult) {
          finalStatus = 'error';
        } else if (gateStatus !== 'fail') {
          if (hadFailingAttempt) {
            finalStatus = 'flaky_pass';
          } else if (hadErrorAttempt) {
            finalStatus = 'recovered_error';
          }
        }

        return {
          ...finalAttempt,
          status: finalStatus,
          retries,
          attemptCount: attemptGroups.length,
          compareCounts,
          compareDecision,
          decisiveRepeatCount: countDecisiveCompareRepeats(compareCounts),
          gateStatus,
          reason: finalStatus === 'failed'
            ? `Reliable compare loss: decision=${compareDecision}; ${formatCompareCounts(compareCounts)}`
            : (finalStatus === 'error' ? finalAttempt.reason : ''),
        };
      }

      const hadFailureAttempt = attemptGroups.slice(0, -1).some((group) => group.entries.some((entry) => entry.status === 'failed'));
      let finalStatus = finalAttempt.status;
      if (finalAttempt.status === 'passed') {
        if (hadFailureAttempt) {
          finalStatus = 'flaky_pass';
        } else if (hadErrorAttempt) {
          finalStatus = 'recovered_error';
        }
      }

      return {
        ...finalAttempt,
        status: finalStatus,
        retries,
        attemptCount: attemptGroups.length,
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
    '## Prompt Eval Outcome',
    '',
    `- Status: ${runReport.result}`,
    `- Totals: ${formatTotalsLine(runReport.totals)}`,
    `- Tests: ${runReport.totals.tests}`,
    `- Passed: ${runReport.totals.passed}`,
    `- Flaky Passed: ${runReport.totals.flakyPassed}`,
    `- Recovered Errors: ${runReport.totals.recoveredErrors}`,
    `- Failed: ${runReport.totals.failed}`,
    `- Errors: ${runReport.totals.errors}`,
  ];

  const attentionTests = getAttentionTests(runReport);
  if (attentionTests.length) {
    lines.push('', '### Needs Attention', '');
    for (const test of attentionTests) {
      lines.push(`- ${formatAttentionEntry(test)}`);
    }
  }

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
      if (test.compareDecision) {
        parts.push(`decision=${test.compareDecision}`);
      }
      if (test.compareCounts) {
        parts.push(formatCompareSummary(test));
      }
      if (test.gateStatus) {
        parts.push(`gate=${test.gateStatus}`);
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
  process.stdout.write(buildHighSignalSummary(runReport, {
    artifactDir: args.artifactDir,
    summaryPath,
  }));
  appendGithubStepSummary(runReport);
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
  buildHighSignalSummary,
  buildMarkdownSummary,
  buildStepSummary,
  appendGithubStepSummary,
  formatDuration,
  getPromptfooRows,
  inferReliableCompareDecision,
  inferCompareWinner,
  parseArtifactFileName,
  listPromptfooJsonReports,
  summarizePromptfooPhaseReport,
  writeSummary,
};
