const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const {
  BASELINE_PROMPT_PATH_ENV,
  BASELINE_URL_ENV,
  BASELINE_VERSION_ENV,
} = require('../prompts/baseline.cjs');
const { resolveBaselinePrompt } = require('../prompts/resolve_baseline_prompt.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const REPO_CONFIG_PATH = path.join(ROOT, 'evals', 'config.yaml');

function withEnv(t, entries) {
  const previousEntries = entries.map(([name]) => [name, process.env[name]]);

  t.after(() => {
    for (const [name, value] of previousEntries) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  for (const [name, value] of entries) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
}

test('resolveBaselinePrompt caches a fetched baseline artifact from an override URL', async (t) => {
  const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'strava-coach-baseline-cache-'));
  const server = http.createServer((request, response) => {
    if (request.url === '/baseline.md') {
      response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      response.end('Fetched baseline artifact prompt.\n');
      return;
    }

    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baselineUrl = `http://127.0.0.1:${address.port}/baseline.md`;

  withEnv(t, [
    [BASELINE_PROMPT_PATH_ENV, undefined],
    [BASELINE_URL_ENV, baselineUrl],
    [BASELINE_VERSION_ENV, '9.9.9'],
  ]);

  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
    });
    fs.rmSync(outputDir, { recursive: true, force: true });
  });

  const resolved = await resolveBaselinePrompt({
    outputDir,
    configPath: REPO_CONFIG_PATH,
  });

  assert.equal(resolved.cached, true);
  assert.match(resolved.promptPath, /^\/.*baseline-.*\.md$/);
  assert.equal(fs.readFileSync(resolved.promptPath, 'utf8'), 'Fetched baseline artifact prompt.\n');
});

test('resolveBaselinePrompt returns the explicit local override path without copying', async (t) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'strava-coach-baseline-local-'));
  const baselinePath = path.join(tempDir, 'baseline.md');
  fs.writeFileSync(baselinePath, 'Local override prompt.\n', 'utf8');

  withEnv(t, [
    [BASELINE_PROMPT_PATH_ENV, baselinePath],
    [BASELINE_URL_ENV, undefined],
    [BASELINE_VERSION_ENV, undefined],
  ]);

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const resolved = await resolveBaselinePrompt({
    outputDir: path.join(tempDir, 'cache'),
    configPath: REPO_CONFIG_PATH,
  });

  assert.equal(resolved.cached, false);
  assert.equal(resolved.promptPath, baselinePath);
});

test('resolveBaselinePrompt accepts file URLs for local and airgapped experimentation', async (t) => {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'strava-coach-baseline-file-url-'));
  const baselinePath = path.join(tempDir, 'baseline.md');
  fs.writeFileSync(baselinePath, 'File URL override prompt.\n', 'utf8');

  withEnv(t, [
    [BASELINE_PROMPT_PATH_ENV, undefined],
    [BASELINE_URL_ENV, `file://${baselinePath}`],
    [BASELINE_VERSION_ENV, '2.0.0-local'],
  ]);

  t.after(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const resolved = await resolveBaselinePrompt({
    outputDir: path.join(tempDir, 'cache'),
    configPath: REPO_CONFIG_PATH,
  });

  assert.equal(resolved.cached, false);
  assert.equal(resolved.promptPath, baselinePath);
});
