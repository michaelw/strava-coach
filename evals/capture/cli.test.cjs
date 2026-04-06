const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');

function runNodeScript(scriptPath, args = []) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('strava capture script prints help', () => {
  const result = runNodeScript(path.join(repoRoot, 'evals/capture/strava_capture.cjs'), ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node evals\/capture\/strava_capture\.cjs/);
  assert.match(result.stdout, /auth\s+Start a local OAuth callback server/);
  assert.match(result.stdout, /exchange-code --code <code>/);
  assert.match(result.stdout, /does not require changing the Strava App callback setting first/);
});

test('gpt capture script prints help', () => {
  const result = runNodeScript(path.join(repoRoot, 'evals/capture/gpt_capture.cjs'), ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node evals\/capture\/gpt_capture\.cjs/);
  assert.match(result.stdout, /--prompt <text>|--scenario <path>/);
});

test('promote fixture script prints help', () => {
  const result = runNodeScript(path.join(repoRoot, 'evals/capture/promote_fixture.cjs'), ['--help']);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: node evals\/capture\/promote_fixture\.cjs/);
  assert.match(result.stdout, /--kind <strava\|conversation>/);
});
