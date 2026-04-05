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
      options[optionName] = true;
      continue;
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

function runGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
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

function resolveCurrentBranchName() {
  return runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
}

function resolveDefaultBaseRef() {
  try {
    return runGit(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  } catch {
    return 'origin/main';
  }
}

function collectLocalBranchCommits(baseRef, headRef = 'HEAD') {
  const mergeBase = runGit(['merge-base', baseRef, headRef]);
  return {
    mergeBase,
    commits: collectPullRequestCommits(mergeBase, headRef),
  };
}

function messageContainsIssueReference(message, issueNumber) {
  return buildIssueReferencePattern(issueNumber).test(message);
}

function validateIssueReferences({ branchName, prTitle = '', prBody = '', commits = [] }) {
  const branchIssues = extractBranchIssueNumbers(branchName);
  if (branchIssues.length === 0) {
    return {
      branchIssues,
      missingPrIssues: [],
      skipped: true,
    };
  }

  const commitMessages = commits.map((commit) => commit.message).join('\n');
  const prContext = `${prTitle}\n${prBody}\n${commitMessages}`;
  const missingPrIssues = branchIssues.filter(
    (issueNumber) => !messageContainsIssueReference(prContext, issueNumber),
  );

  return {
    branchIssues,
    missingPrIssues,
    skipped: false,
  };
}

function formatIssueList(issueNumbers) {
  return issueNumbers.map((issueNumber) => `#${issueNumber}`).join(', ');
}

function validateLocalIssueReferences({
  branchName,
  baseRef,
  headRef = 'HEAD',
  prTitle = '',
  prBody = '',
  collectCommits = collectLocalBranchCommits,
}) {
  const branchIssues = extractBranchIssueNumbers(branchName);
  if (branchIssues.length === 0) {
    return {
      branchIssues,
      commits: [],
      mergeBase: null,
      missingPrIssues: [],
      skipped: true,
    };
  }

  const { mergeBase, commits } = collectCommits(baseRef, headRef);
  const result = validateIssueReferences({
    branchName,
    prTitle,
    prBody,
    commits,
  });

  return {
    ...result,
    commits,
    mergeBase,
  };
}

function buildFailureMessage({ branchName, expectedIssues, missingPrIssues }) {
  const failures = [];

  if (missingPrIssues.length > 0) {
    failures.push(
      `PR (title, body, or commits) must reference ${formatIssueList(missingPrIssues)} because branch "${branchName}" encodes ${expectedIssues}.`,
    );
  }

  if (failures.length === 0) {
    return '';
  }

  return [
    'Issue reference validation failed.',
    'Add a plain reference like "#<issue-ref>" in the PR title, PR body, or commit messages for each branch-encoded issue.',
    ...failures,
  ].join('\n\n');
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const eventPath = options['event-path'] || process.env.GITHUB_EVENT_PATH;
  const baseSha = options['base-sha'] || process.env.PR_BASE_SHA || process.env.GITHUB_BASE_SHA;
  const headSha = options['head-sha'] || process.env.PR_HEAD_SHA || process.env.GITHUB_HEAD_SHA;

  if (eventPath && baseSha && headSha) {
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
    const failureMessage = buildFailureMessage({
      branchName,
      expectedIssues,
      missingPrIssues: result.missingPrIssues,
    });

    if (failureMessage) {
      throw new Error(failureMessage);
    }

    console.log(`Issue reference validation passed for ${expectedIssues} on branch "${branchName}".`);
    return;
  }

  const branchName = options['branch-name'] || resolveCurrentBranchName();
  if (!branchName || branchName === 'HEAD') {
    console.log('Skipping local issue reference validation because the current checkout is detached.');
    return;
  }

  const baseRef = options['base-ref'] || resolveDefaultBaseRef();
  const headRef = options['head-ref'] || 'HEAD';
  const result = validateLocalIssueReferences({
    branchName,
    baseRef,
    headRef,
    prTitle: options['pr-title'] === true ? '' : (options['pr-title'] || ''),
    prBody: options['pr-body'] === true ? '' : (options['pr-body'] || ''),
  });

  if (result.skipped) {
    console.log(`Skipping local issue reference validation for branch "${branchName}" because it does not encode an issue number.`);
    return;
  }

  const expectedIssues = formatIssueList(result.branchIssues);
  const failureMessage = buildFailureMessage({
    branchName,
    expectedIssues,
    missingPrIssues: result.missingPrIssues,
  });

  if (failureMessage) {
    throw new Error([
      failureMessage,
      `Local mode compared non-merge commits in ${result.mergeBase}..${headRef} against ${baseRef}.`,
      'CI can also be satisfied by adding the issue reference in the eventual PR title or PR body.',
    ].join('\n\n'));
  }

  console.log(
    `Local issue reference validation passed for ${expectedIssues} on branch "${branchName}" against ${baseRef} (${result.mergeBase}..${headRef}).`,
  );
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
  collectLocalBranchCommits,
  extractBranchIssueNumbers,
  formatIssueList,
  messageContainsIssueReference,
  parseArgs,
  readPullRequestEvent,
  resolveCurrentBranchName,
  resolveDefaultBaseRef,
  runGit,
  validateLocalIssueReferences,
  validateIssueReferences,
};
