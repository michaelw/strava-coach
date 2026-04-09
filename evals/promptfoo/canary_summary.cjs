#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { readCanaryConfig } = require('./config.cjs');
const { readJson, writeJson, writeText } = require('./fs_utils.cjs');

function relativeArtifactPath(artifactDir, filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(artifactDir, filePath) || path.basename(filePath);
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

function listPromptfooJsonReports(artifactDir) {
  if (!fs.existsSync(artifactDir)) {
    return [];
  }

  return fs
    .readdirSync(artifactDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => path.join(artifactDir, entry.name))
    .filter((filePath) => {
      const baseName = path.basename(filePath);
      return baseName !== 'summary.json' && baseName !== 'canary-summary.json';
    })
    .map((jsonPath) => {
      const report = readJson(jsonPath);
      if (!Array.isArray(report?.results?.results)) {
        return null;
      }
      return {
        jsonPath,
        report,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.jsonPath.localeCompare(right.jsonPath));
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

function getInfrastructureError(row) {
  const candidateError = String(row?.error || '').trim();
  if (!candidateError) {
    return '';
  }

  return isExpectedGradingFailure(row) ? '' : candidateError;
}

function getFailureReason(row) {
  return String(
    row?.gradingResult?.reason
      || row?.failureReason
      || row?.error
      || 'Promptfoo assertion failed',
  );
}

function summarizeRow(row) {
  const metadata = row?.testCase?.metadata || {};
  const error = getInfrastructureError(row);
  if (error) {
    return {
      id: metadata.id || `test-${row?.testIdx ?? 'unknown'}`,
      suite: metadata.suite || 'unknown',
      status: 'error',
      reason: error,
      repeatIndex: row?.repeatIndex ?? 0,
    };
  }

  return {
    id: metadata.id || `test-${row?.testIdx ?? 'unknown'}`,
    suite: metadata.suite || 'unknown',
    status: row?.success ? 'passed' : 'failed',
    reason: row?.success ? '' : getFailureReason(row),
    repeatIndex: row?.repeatIndex ?? 0,
  };
}

function createCaseCounts() {
  return {
    passed: 0,
    failed: 0,
    errors: 0,
  };
}

function createRunReport({ artifactDir, phaseReports, canaryConfig }) {
  const grouped = new Map();

  for (const phaseReport of phaseReports) {
    const rows = phaseReport.report.results.results;
    for (const row of rows) {
      const sample = summarizeRow(row);
      const key = `${sample.suite}/${sample.id}`;
      if (!grouped.has(key)) {
        grouped.set(key, {
          suite: sample.suite,
          id: sample.id,
          samples: [],
          reasons: [],
        });
      }
      const entry = grouped.get(key);
      entry.samples.push(sample);
      if (sample.reason) {
        entry.reasons.push(sample.reason);
      }
    }
  }

  const tests = [...grouped.values()]
    .map((entry) => {
      const counts = createCaseCounts();
      for (const sample of entry.samples) {
        counts[sample.status === 'error' ? 'errors' : sample.status] += 1;
      }

      const sampleCount = entry.samples.length;
      const badSampleCount = counts.failed + counts.errors;
      let status = 'passed';
      if (badSampleCount > canaryConfig.allowed_failures) {
        status = 'failed';
      } else if (badSampleCount > 0) {
        status = 'warning';
      }

      return {
        suite: entry.suite,
        id: entry.id,
        status,
        sampleCount,
        passedSamples: counts.passed,
        failedSamples: counts.failed,
        errorSamples: counts.errors,
        badSampleCount,
        failureRate: sampleCount > 0 ? counts.failed / sampleCount : 0,
        errorRate: sampleCount > 0 ? counts.errors / sampleCount : 0,
        badSampleRate: sampleCount > 0 ? badSampleCount / sampleCount : 0,
        allowedFailures: canaryConfig.allowed_failures,
        reason: status === 'passed'
          ? ''
          : truncateReason(entry.reasons[entry.reasons.length - 1] || ''),
      };
    })
    .sort((left, right) => `${left.suite}/${left.id}`.localeCompare(`${right.suite}/${right.id}`));

  const passed = tests.filter((test) => test.status === 'passed').length;
  const warnings = tests.filter((test) => test.status === 'warning').length;
  const failed = tests.filter((test) => test.status === 'failed').length;
  const errors = 0;
  const samples = tests.reduce((total, test) => total + test.sampleCount, 0);
  const samplePasses = tests.reduce((total, test) => total + test.passedSamples, 0);
  const sampleFailures = tests.reduce((total, test) => total + test.failedSamples, 0);
  const sampleErrors = tests.reduce((total, test) => total + test.errorSamples, 0);

  let result = 'PASS';
  if (failed > 0) {
    result = 'FAIL';
  } else if (warnings > 0) {
    result = 'WARN';
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    result,
    policy: {
      repeat: canaryConfig.repeat,
      allowedFailures: canaryConfig.allowed_failures,
      temperature: canaryConfig.temperature,
    },
    totals: {
      tests: tests.length,
      passed,
      warnings,
      failed,
      errors,
      samples,
      samplePasses,
      sampleFailures,
      sampleErrors,
    },
    artifacts: phaseReports.map((phaseReport) => relativeArtifactPath(artifactDir, phaseReport.jsonPath)),
    tests,
  };
}

function formatRate(rate) {
  return `${Math.round(rate * 100)}%`;
}

function formatTotalsLine(totals) {
  return `cases=${totals.tests} passed=${totals.passed} warnings=${totals.warnings} failed=${totals.failed} errors=${totals.errors} samples=${totals.samples} sample_passes=${totals.samplePasses} sample_failures=${totals.sampleFailures} sample_errors=${totals.sampleErrors}`;
}

function getAttentionTests(runReport) {
  return runReport.tests.filter((test) => test.status !== 'passed');
}

function formatAttentionEntry(test) {
  const parts = [
    `${test.status.toUpperCase()} ${test.suite}/${test.id}`,
    `bad_samples=${test.badSampleCount}/${test.sampleCount}`,
    `failure_rate=${formatRate(test.failureRate)}`,
    `error_rate=${formatRate(test.errorRate)}`,
    `allowed_failures=${test.allowedFailures}`,
  ];
  if (test.reason) {
    parts.push(`reason=${test.reason}`);
  }
  return parts.join(' ');
}

function buildHighSignalSummary(runReport, { artifactDir, summaryPath } = {}) {
  const lines = [
    `Smoke Canary: ${runReport.result}`,
    `Policy: repeat=${runReport.policy.repeat} allowed_failures=${runReport.policy.allowedFailures} temperature=${runReport.policy.temperature}`,
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
    lines.push(`Artifact Dir: ${artifactDir}`);
  }
  if (summaryPath) {
    lines.push(`Summary Path: ${summaryPath}`);
  }

  return `${lines.join('\n')}\n`;
}

function buildMarkdownSummary(runReport) {
  const lines = [
    '## Smoke Canary Outcome',
    '',
    `- Status: ${runReport.result}`,
    `- Policy: repeat=${runReport.policy.repeat}, allowed_failures=${runReport.policy.allowedFailures}, temperature=${runReport.policy.temperature}`,
    `- Totals: ${formatTotalsLine(runReport.totals)}`,
  ];

  const attentionTests = getAttentionTests(runReport);
  if (attentionTests.length) {
    lines.push('', '### Needs Attention', '');
    for (const test of attentionTests) {
      lines.push(`- ${formatAttentionEntry(test)}`);
    }
  }

  if (runReport.artifacts.length) {
    lines.push('', '### Promptfoo Reports', '');
    for (const artifact of runReport.artifacts) {
      lines.push(`- ${artifact}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function appendGithubStepSummary(runReport, stepSummaryPath = process.env.GITHUB_STEP_SUMMARY) {
  if (!stepSummaryPath) {
    return false;
  }

  const content = buildMarkdownSummary(runReport);
  const prefix = fs.existsSync(stepSummaryPath) && fs.statSync(stepSummaryPath).size > 0 ? '\n' : '';
  fs.appendFileSync(stepSummaryPath, `${prefix}${content}`, 'utf8');
  return true;
}

function writeSummary({ artifactDir, outputPath, jsonOutputPath, repoConfigPath } = {}) {
  const phaseReports = listPromptfooJsonReports(artifactDir);
  if (!phaseReports.length) {
    throw new Error(`No Promptfoo json reports found under ${artifactDir}`);
  }

  const canaryConfig = readCanaryConfig(repoConfigPath);
  const runReport = createRunReport({
    artifactDir,
    phaseReports,
    canaryConfig,
  });
  const summaryPath = outputPath || path.join(artifactDir, 'canary-summary.md');
  const resolvedJsonOutputPath = jsonOutputPath || path.join(artifactDir, 'canary-summary.json');
  writeText(summaryPath, buildMarkdownSummary(runReport));
  writeJson(resolvedJsonOutputPath, runReport);

  return {
    runReport,
    summaryPath,
    jsonOutputPath: resolvedJsonOutputPath,
  };
}

function parseArgs(argv) {
  const args = {
    artifactDir: null,
    outputPath: null,
    jsonOutputPath: null,
    repoConfigPath: null,
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
    } else if (arg === '--json-output') {
      args.jsonOutputPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--repo-config') {
      args.repoConfigPath = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--check') {
      args.check = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: node evals/promptfoo/canary_summary.cjs --artifact-dir <dir> [--output <path>] [--json-output <path>] [--repo-config <path>] [--check]');
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
  if (args.check && runReport.result === 'FAIL') {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  appendGithubStepSummary,
  buildHighSignalSummary,
  buildMarkdownSummary,
  createRunReport,
  formatAttentionEntry,
  formatTotalsLine,
  listPromptfooJsonReports,
  parseArgs,
  summarizeRow,
  writeSummary,
};
