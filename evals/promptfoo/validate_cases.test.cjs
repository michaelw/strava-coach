const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  CASE_SCHEMA_PATH,
  collectExistingIds,
  compileCaseValidator,
  isCaseFilePath,
  listCaseFiles,
  loadCase,
  resolveRequestedCaseFiles,
  validateAllCases,
  validateCaseFile,
  validateRequestedCases,
} = require('./validate_cases.cjs');

function writeTempYaml(contents, name = 'case.yaml') {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-case-'));
  const filePath = path.join(tempDir, name);
  fs.writeFileSync(filePath, contents, 'utf8');
  return filePath;
}

function validCaseYaml(extra = '') {
  return [
    'description: Valid fixture-backed case',
    'vars:',
    '  athlete_profile: Runner profile',
    '  strava_fixture: production/strava/grounding-no-streams.json',
    '  user_query: Analyze this run',
    'assert:',
    '  - type: llm-rubric',
    '    metric: grounding',
    '    value: The response is grounded.',
    'metadata:',
    '  id: valid-case',
    '  suite: smoke',
    '  priority: high',
    '  tags:',
    '    - sample',
    extra,
  ].filter(Boolean).join('\n');
}

test('schema accepts a valid fixture-backed case', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(validCaseYaml());
  const payload = loadCase(filePath);
  assert.equal(validate(payload), true);
});

test('schema accepts native promptfoo case metadata without hosted runner fields', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(validCaseYaml());
  const payload = loadCase(filePath);
  assert.equal(validate(payload), true);
});

test('schema accepts top-level repeat and compare gating metadata', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(
    [
      'description: Compare case with repeat',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_data: Inline strava data',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: personalization',
      '    value: The answer is personalized.',
      '  - type: select-best',
      '    value: Prefer the candidate response.',
      'repeat: 3',
      'metadata:',
      '  id: valid-compare',
      '  suite: personalization',
      '  priority: high',
      '  compare_gate: reliable-blocker',
      '  tags:',
      '    - sample',
    ].join('\n'),
  );
  const payload = loadCase(filePath);
  assert.equal(validate(payload), true);
});

test('schema rejects retired hosted-runner comparison metadata', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(validCaseYaml([
    '  compare_strategy: select-best',
  ].join('\n')));
  const payload = loadCase(filePath);
  assert.equal(validate(payload), false);
});

test('schema rejects retired hosted-runner eval_mode metadata', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(validCaseYaml([
    '  eval_mode: self',
  ].join('\n')));
  const payload = loadCase(filePath);
  assert.equal(validate(payload), false);
});

test('schema rejects retired hosted-runner repeat metadata', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(validCaseYaml([
    '  repeat: 3',
  ].join('\n')));
  const payload = loadCase(filePath);
  assert.equal(validate(payload), false);
});

test('schema accepts promptfoo-native assertion shapes beyond the original allowlist', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(
    [
      'description: Valid fixture-backed case',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_fixture: production/strava/grounding-no-streams.json',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: javascript',
      '    metric: format',
      '    value: file://evals/promptfoo/assertions.js:checkFormat',
      '    threshold: 0.8',
      'metadata:',
      '  id: valid-case',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
  );
  const payload = loadCase(filePath);
  assert.equal(validate(payload), true);
});

test('schema rejects assertion objects missing type', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(
    [
      'description: Valid fixture-backed case',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_fixture: production/strava/grounding-no-streams.json',
      '  user_query: Analyze this run',
      'assert:',
      '  - metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: valid-case',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
  );
  const payload = loadCase(filePath);
  assert.equal(validate(payload), false);
});

test('schema rejects cases missing both strava_data and strava_fixture', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const filePath = writeTempYaml(
    [
      'description: Missing strava input',
      'vars:',
      '  athlete_profile: Runner profile',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: missing-strava-input',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
  );
  const payload = loadCase(filePath);
  assert.equal(validate(payload), false);
});

test('validateCaseFile rejects duplicate IDs after schema validation', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-dup-'));
  const smokeDir = path.join(tempDir, 'self', 'smoke');
  const safetyDir = path.join(tempDir, 'self', 'safety');
  fs.mkdirSync(smokeDir, { recursive: true });
  fs.mkdirSync(safetyDir, { recursive: true });
  const firstFile = path.join(smokeDir, 'duplicate-id.yaml');
  const secondFile = path.join(safetyDir, 'duplicate-id.yaml');
  const caseYaml = [
    'description: Duplicate id case',
    'vars:',
    '  athlete_profile: Runner profile',
    '  strava_data: Inline strava data',
    '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: duplicate-id',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
  ].join('\n');
  fs.writeFileSync(firstFile, caseYaml, 'utf8');
  fs.writeFileSync(secondFile, caseYaml.replace('suite: smoke', 'suite: safety'), 'utf8');

  const seenIds = new Set();
  validateCaseFile(firstFile, seenIds, validate);
  assert.throws(() => validateCaseFile(secondFile, seenIds, validate), /Duplicate case id/);
});

test('validateCaseFile rejects missing fixture files after schema validation', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-missing-fixture-'));
  const suiteDir = path.join(tempDir, 'self', 'smoke');
  fs.mkdirSync(suiteDir, { recursive: true });
  const filePath = path.join(suiteDir, 'missing-fixture.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Missing fixture case',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_fixture: production/strava/does-not-exist.json',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: missing-fixture',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(() => validateCaseFile(filePath, new Set(), validate), /file not found/);
});

test('validateCaseFile requires select-best inside compare cases', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-compare-'));
  const suiteDir = path.join(tempDir, 'compare', 'personalization');
  fs.mkdirSync(suiteDir, { recursive: true });
  const filePath = path.join(suiteDir, 'personalization-001.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Compare case missing select-best',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_data: Inline strava data',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: personalization',
      '    value: The answer is personalized.',
      'metadata:',
      '  id: personalization-001',
      '  suite: personalization',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(() => validateCaseFile(filePath, new Set(), validate), /must include a select-best assertion/);
});

test('validateCaseFile requires repeat and compare_gate inside compare cases', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-compare-repeat-'));
  const suiteDir = path.join(tempDir, 'compare', 'personalization');
  fs.mkdirSync(suiteDir, { recursive: true });
  const filePath = path.join(suiteDir, 'personalization-001.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Compare case missing repeat and compare_gate',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_data: Inline strava data',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: personalization',
      '    value: The answer is personalized.',
      '  - type: select-best',
      '    value: Prefer the candidate response.',
      'metadata:',
      '  id: personalization-001',
      '  suite: personalization',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(() => validateCaseFile(filePath, new Set(), validate), /must declare a top-level repeat value/);
});

test('validateCaseFile rejects compare repeat values below the reliable threshold', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-compare-low-repeat-'));
  const suiteDir = path.join(tempDir, 'compare', 'personalization');
  fs.mkdirSync(suiteDir, { recursive: true });
  const filePath = path.join(suiteDir, 'personalization-001.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Compare case with repeat below threshold',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_data: Inline strava data',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: personalization',
      '    value: The answer is personalized.',
      '  - type: select-best',
      '    value: Prefer the candidate response.',
      'repeat: 2',
      'metadata:',
      '  id: personalization-001',
      '  suite: personalization',
      '  priority: high',
      '  compare_gate: reliable-blocker',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(() => validateCaseFile(filePath, new Set(), validate), /must set repeat >= 3/);
});

test('validateCaseFile rejects compare_gate on self cases', () => {
  const validate = compileCaseValidator(CASE_SCHEMA_PATH);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-self-compare-gate-'));
  const suiteDir = path.join(tempDir, 'self', 'smoke');
  fs.mkdirSync(suiteDir, { recursive: true });
  const filePath = path.join(suiteDir, 'smoke-001.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Self case with compare gate',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_data: Inline strava data',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: smoke-001',
      '  suite: smoke',
      '  priority: high',
      '  compare_gate: advisory',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(() => validateCaseFile(filePath, new Set(), validate), /must not declare metadata.compare_gate/);
});

test('listCaseFiles discovers native self and compare trees', () => {
  const files = listCaseFiles(path.resolve('evals/cases'));

  assert.ok(files.includes(path.resolve('evals/cases/self/grounding/grounding-001.yaml')));
  assert.ok(files.includes(path.resolve('evals/cases/compare/personalization/personalization-001.yaml')));
  assert.ok(files.includes(path.resolve('evals/cases/compare/personalization/personalization-003.yaml')));
});

test('isCaseFilePath matches only tracked case yaml files under evals/cases', () => {
  assert.equal(isCaseFilePath(path.resolve('evals/cases/self/grounding/grounding-001.yaml')), true);
  assert.equal(isCaseFilePath(path.resolve('evals/promptfoo/case.schema.json')), false);
  assert.equal(isCaseFilePath(path.resolve('README.md')), false);
});

test('resolveRequestedCaseFiles normalizes case paths and ignores non-case files', () => {
  const cwd = path.resolve('.');
  const files = resolveRequestedCaseFiles(
    [
      'evals/cases/self/grounding/grounding-001.yaml',
      './evals/cases/self/grounding/grounding-001.yaml',
      'README.md',
    ],
    cwd,
  );

  assert.deepEqual(files, [path.resolve('evals/cases/self/grounding/grounding-001.yaml')]);
});

test('collectExistingIds indexes metadata ids from existing files', () => {
  const ids = collectExistingIds([
    path.resolve('evals/cases/self/grounding/grounding-001.yaml'),
    path.resolve('evals/cases/self/smoke/smoke-001.yaml'),
  ]);

  assert.equal(ids.has('grounding-001'), true);
  assert.equal(ids.has('smoke-001'), true);
});

test('validateRequestedCases validates only requested case files', () => {
  const cases = validateRequestedCases({
    requestedFiles: [
      'evals/cases/self/grounding/grounding-001.yaml',
      'README.md',
    ],
  });

  assert.equal(cases.length, 1);
  assert.equal(cases[0].metadata.id, 'grounding-001');
});

test('validateRequestedCases catches duplicate ids against unchanged files', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'strava-coach-requested-'));
  const casesRoot = path.join(tempDir, 'evals', 'cases');
  const existingSuiteDir = path.join(casesRoot, 'self', 'smoke');
  const changedSuiteDir = path.join(casesRoot, 'self', 'grounding');
  fs.mkdirSync(existingSuiteDir, { recursive: true });
  fs.mkdirSync(changedSuiteDir, { recursive: true });
  fs.writeFileSync(
    path.join(existingSuiteDir, 'smoke-001.yaml'),
    [
      'description: Existing unchanged case',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_fixture: production/strava/grounding-no-streams.json',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: grounding-001',
      '  suite: smoke',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );
  const filePath = path.join(changedSuiteDir, 'grounding-001.yaml');
  fs.writeFileSync(
    filePath,
    [
      'description: Duplicate changed case',
      'vars:',
      '  athlete_profile: Runner profile',
      '  strava_fixture: production/strava/grounding-no-streams.json',
      '  user_query: Analyze this run',
      'assert:',
      '  - type: llm-rubric',
      '    metric: grounding',
      '    value: The response is grounded.',
      'metadata:',
      '  id: grounding-001',
      '  suite: grounding',
      '  priority: high',
      '  tags:',
      '    - sample',
    ].join('\n'),
    'utf8',
  );

  assert.throws(
    () => validateRequestedCases({ requestedFiles: [filePath], cwd: tempDir, casesRoot }),
    /Duplicate case id: grounding-001/,
  );
});

test('validateAllCases accepts an explicit file list', () => {
  const files = [path.resolve('evals/cases/self/grounding/grounding-001.yaml')];
  const cases = validateAllCases({ files });

  assert.equal(cases.length, 1);
  assert.equal(cases[0].metadata.id, 'grounding-001');
});
