const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseArgs,
  extractBranchIssueNumbers,
  formatIssueList,
  messageContainsIssueReference,
  validateLocalIssueReferences,
  validateIssueReferences,
} = require('./validate_issue_references.cjs');

test('parseArgs accepts both valued and boolean flags', () => {
  assert.deepEqual(parseArgs(['--base-ref', 'origin/main', '--local']), {
    'base-ref': 'origin/main',
    local: true,
  });
});

test('extractBranchIssueNumbers finds issue ids from common branch patterns', () => {
  assert.deepEqual(
    extractBranchIssueNumbers('codex/implement-github-issue-26'),
    [26],
  );
  assert.deepEqual(
    extractBranchIssueNumbers('feature/issues/26-improve-ci'),
    [26],
  );
  assert.deepEqual(
    extractBranchIssueNumbers('codex/gh-12-and-issue-26'),
    [12, 26],
  );
});

test('extractBranchIssueNumbers ignores unrelated numeric branch segments', () => {
  assert.deepEqual(
    extractBranchIssueNumbers('release/2026-04'),
    [],
  );
});

test('messageContainsIssueReference accepts issue shorthand and issue urls', () => {
  assert.equal(messageContainsIssueReference('Implements #26', 26), true);
  assert.equal(
    messageContainsIssueReference(
      'Related: https://github.com/michaelw/strava-coach/issues/26',
      26,
    ),
    true,
  );
  assert.equal(messageContainsIssueReference('Mentions #260 instead', 26), false);
});

test('validateIssueReferences skips branches without explicit issue tokens', () => {
  const result = validateIssueReferences({
    branchName: 'docs/update-homepage',
    prTitle: 'Refresh docs',
    prBody: '',
    commits: [],
  });

  assert.equal(result.skipped, true);
  assert.deepEqual(result.branchIssues, []);
});

test('validateLocalIssueReferences skips non-issue branches before collecting commits', () => {
  let collected = false;

  const result = validateLocalIssueReferences({
    branchName: 'docs/update-homepage',
    baseRef: 'origin/main',
    collectCommits: () => {
      collected = true;
      throw new Error('should not collect commits for non-issue branches');
    },
  });

  assert.equal(result.skipped, true);
  assert.equal(collected, false);
  assert.equal(result.mergeBase, null);
  assert.deepEqual(result.branchIssues, []);
});

test('validateIssueReferences fails when issue is missing from entire PR', () => {
  const result = validateIssueReferences({
    branchName: 'codex/implement-github-issue-26',
    prTitle: 'Improve CI guardrails',
    prBody: 'Adds a PR template.',
    commits: [
      {
        sha: 'abc1234',
        subject: 'ci: add issue reference validator',
        body: '',
        message: 'ci: add issue reference validator',
      },
      {
        sha: 'def5678',
        subject: 'docs: explain issue reference enforcement',
        body: '',
        message: 'docs: explain issue reference enforcement',
      },
    ],
  });

  assert.deepEqual(result.branchIssues, [26]);
  assert.deepEqual(result.missingPrIssues, [26]);
});

test('validateIssueReferences passes when the PR references the issue in commit context', () => {
  const result = validateIssueReferences({
    branchName: 'codex/implement-github-issue-26',
    prTitle: 'Improve CI guardrails (#26)',
    prBody: 'Adds a PR template.',
    commits: [
      {
        sha: 'abc1234',
        subject: 'ci: add issue reference validator (#26)',
        body: '',
        message: 'ci: add issue reference validator (#26)',
      },
      {
        sha: 'def5678',
        subject: 'docs: explain issue reference enforcement (#26)',
        body: '',
        message: 'docs: explain issue reference enforcement (#26)',
      },
    ],
  });

  assert.deepEqual(result.missingPrIssues, []);
  assert.equal(result.skipped, false);
});

test('validateIssueReferences passes when one commit body references the branch issue', () => {
  const result = validateIssueReferences({
    branchName: 'codex/implement-github-issue-26',
    prTitle: 'Improve CI guardrails',
    prBody: 'Adds a PR template.',
    commits: [
      {
        sha: 'abc1234',
        subject: 'ci: add issue reference validator',
        body: 'References #26',
        message: 'ci: add issue reference validator\n\nReferences #26',
      },
      {
        sha: 'def5678',
        subject: 'docs: explain issue reference enforcement',
        body: '',
        message: 'docs: explain issue reference enforcement',
      },
    ],
  });

  assert.deepEqual(result.missingPrIssues, []);
  assert.equal(result.skipped, false);
});

test('validateIssueReferences passes when only the PR title/body references the branch issue', () => {
  const result = validateIssueReferences({
    branchName: 'codex/implement-github-issue-26',
    prTitle: 'ci: enforce issue references in PRs and commits (#26)',
    prBody: 'Documents the new guardrail.',
    commits: [
      {
        sha: 'abc1234',
        subject: 'ci: validate PR issue refs',
        body: '',
        message: 'ci: validate PR issue refs',
      },
    ],
  });

  assert.deepEqual(result.missingPrIssues, []);
  assert.equal(result.skipped, false);
});

test('validateIssueReferences passes when PR context and all commits reference the branch issue', () => {
  const result = validateIssueReferences({
    branchName: 'codex/implement-github-issue-26',
    prTitle: 'ci: enforce issue references in PRs and commits (#26)',
    prBody: 'Documents the new guardrail.',
    commits: [
      {
        sha: 'abc1234',
        subject: 'ci: validate PR issue refs (#26)',
        body: 'Related to #26',
        message: 'ci: validate PR issue refs (#26)\n\nRelated to #26',
      },
      {
        sha: 'def5678',
        subject: 'docs: document issue ref checks',
        body: 'Related to #26.',
        message: 'docs: document issue ref checks\n\nRelated to #26.',
      },
    ],
  });

  assert.deepEqual(result.missingPrIssues, []);
  assert.equal(result.skipped, false);
});

test('formatIssueList renders issue numbers for error messages', () => {
  assert.equal(formatIssueList([26, 67]), '#26, #67');
});
