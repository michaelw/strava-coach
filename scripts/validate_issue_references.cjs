#!/usr/bin/env node

const fs = require('fs');
const { execFileSync } = require('child_process');

const BRANCH_ISSUE_PATTERNS = [
  /\b(?:github-)?issues?[-_/](\d+)\b/gi,
  /\bgh[-_/](\d+)\b/gi,
  /#(\d+)\b/g,
];

function parseArgs(argv) {
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      continue;
    }

    const optionName = token.slice(2);
    const optionValue = argv[index + 1];
    if (!optionValue || optionValue.startsWith('--')) {
      throw new Error(`Missing value for --${optionName}`);
    }

    options[optionName] = optionValue;
    index += 1;
  }

  return options;
}

function extractBranchIssueNumbers(branchName) {
  const issueNumbers = new Set();

  for (const pattern of BRANCH_ISSUE_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(branchName);
    while (match) {
      issueNumbers.add(Number.parseInt(match[1], 10));
      match = pattern.exec(branchName);
    }
  }

  return [...issueNumbers].filter(Number.isFinite).sort((left, right) => left - right);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildIssueReferencePattern(issueNumber) {
  const issue = escapeRegExp(String(issueNumber));
  return new RegExp(`(?:#${issue}\\b|issues/${issue}\\b)`, 'i');
}

function buildFixesIssuePattern(issueNumber) {
  const issue = escapeRegExp(String(issueNumber));
  return new RegExp(`\\bfixes\\s+#${issue}\\b`, 'i');
}

function readPullRequestEvent(eventPath) {
  const payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  if (!payload.pull_request) {
    throw new Error(`Expected pull_request payload in ${eventPath}`);
  }

  return payload.pull_request;
}

function collectPullRequestCommits(baseSha, headSha) {
  const stdout = execFileSync(
    'git',
    ['log', '--format=%H%x00%s%x00%b%x00', '--no-merges', `${baseSha}..${headSha}`],
    { encoding: 'utf8' },
  );

  const fields = stdout.split('\u0000');
  const commits = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const sha = fields[index].trim();
    const subject = fields[index + 1].trim();
    const body = fields[index + 2].trim();

    if (!sha) {
      continue;
    }

    commits.push({
      sha,
      subject,
      body,
      message: body ? `${subject}\n\n${body}` : subject,
    });
  }

  return commits;
}

function messageContainsIssueReference(message, issueNumber) {
  return buildIssueReferencePattern(issueNumber).test(message);
}

function messageContainsFixesIssueReference(message, issueNumber) {
  return buildFixesIssuePattern(issueNumber).test(message);
}

function validateIssueReferences({ branchName, prTitle = '', prBody = '', commits = [] }) {
  const branchIssues = extractBranchIssueNumbers(branchName);
  if (branchIssues.length === 0) {
    return {
      branchIssues,
      missingPrIssues: [],
      missingFixesCommitBodyIssues: [],
      skipped: true,
    };
  }

  const commitMessages = commits.map((commit) => commit.message).join('\n');
  const prContext = `${prTitle}\n${prBody}\n${commitMessages}`;
  const missingPrIssues = branchIssues.filter(
    (issueNumber) => !messageContainsIssueReference(prContext, issueNumber),
  );
  const missingFixesCommitBodyIssues = branchIssues.filter(
    (issueNumber) => !commits.some((commit) => messageContainsFixesIssueReference(commit.body || '', issueNumber)),
  );

  return {
    branchIssues,
    missingPrIssues,
    missingFixesCommitBodyIssues,
    skipped: false,
  };
}

function formatIssueList(issueNumbers) {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(', ');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const eventPath = options['event-path'] || process.env.GITHUB_EVENT_PATH;
  const baseSha = options['base-sha'] || process.env.PR_BASE_SHA || process.env.GITHUB_BASE_SHA;
  const headSha = options['head-sha'] || process.env.PR_HEAD_SHA || process.env.GITHUB_HEAD_SHA;

  if (!eventPath || !baseSha || !headSha) {
    console.log('Skipping issue reference validation because PR event context is incomplete.');
    return;
  }

  const pullRequest = readPullRequestEvent(eventPath);
  const branchName = pullRequest.head?.ref || '';
  const commits = collectPullRequestCommits(baseSha, headSha);
  const result = validateIssueReferences({
    branchName,
    prTitle: pullRequest.title || '',
    prBody: pullRequest.body || '',
    commits,
  });

  if (result.skipped) {
    console.log(`Skipping issue reference validation for branch "${branchName}" because it does not encode an issue number.`);
    return;
  }

  const expectedIssues = formatIssueList(result.branchIssues);
  const failures = [];

  if (result.missingPrIssues.length > 0) {
    failures.push(
      `PR (title, body, or commits) must reference ${formatIssueList(result.missingPrIssues)} because branch "${branchName}" encodes ${expectedIssues}.`,
    );
  }

  if (result.missingFixesCommitBodyIssues.length > 0) {
    failures.push(
      `At least one non-merge commit body must contain ${result.missingFixesCommitBodyIssues.map((issueNumber) => `Fixes #${issueNumber}`).join(', ')} because branch "${branchName}" encodes ${expectedIssues}.`,
    );
  }

  if (failures.length > 0) {
    throw new Error([
      'Issue reference validation failed.',
      'Add a plain reference like "#<issue-ref>" in the PR context and include `Fixes #<issue-ref>` in the body of at least one non-merge commit for each branch-encoded issue.',
      ...failures,
    ].join('\n\n'));
  }

  console.log(`Issue reference validation passed for ${expectedIssues} on branch "${branchName}".`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildIssueReferencePattern,
  collectPullRequestCommits,
  extractBranchIssueNumbers,
  messageContainsFixesIssueReference,
  messageContainsIssueReference,
  parseArgs,
  readPullRequestEvent,
  validateIssueReferences,
};
