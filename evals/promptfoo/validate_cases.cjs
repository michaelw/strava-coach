#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');
const { loadConversationFixture, loadStravaFixture } = require('./fixtures.cjs');
const { readYaml } = require('./config.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const CASES_ROOT = path.join(ROOT, 'evals', 'cases');
const CASE_SCHEMA_PATH = path.join(ROOT, 'evals', 'promptfoo', 'case.schema.json');
const VALID_CASE_MODES = new Set(['self', 'compare']);
const VALID_COMPARE_GATES = new Set(['reliable-blocker', 'advisory']);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadCase(filePath) {
  return readYaml(filePath);
}

function listCaseFiles(root = CASES_ROOT) {
  const filePaths = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      filePaths.push(...listCaseFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith('.yaml')) {
      filePaths.push(entryPath);
    }
  }
  return filePaths.sort();
}

function compileCaseValidator(schemaPath = CASE_SCHEMA_PATH) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
  });
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  return ajv.compile(schema);
}

function formatAjvErrors(errors = []) {
  const normalizedErrors = Array.isArray(errors) ? errors : [];
  if (!normalizedErrors.length) {
    return 'unknown schema validation error';
  }
  return normalizedErrors
    .map((error) => {
      const location = error.instancePath || '(root)';
      return `${location} ${error.message}`;
    })
    .join('; ');
}

function validateCaseFile(filePath, seenIds, validate) {
  const testCase = loadCase(filePath);
  const valid = validate(testCase);
  if (!valid) {
    throw new Error(`${filePath} failed schema validation: ${formatAjvErrors(validate.errors)}`);
  }

  if (testCase.vars.strava_fixture) {
    loadStravaFixture(testCase.vars.strava_fixture);
  }
  if (testCase.vars.conversation_fixture) {
    loadConversationFixture(testCase.vars.conversation_fixture);
  }

  const suiteDir = path.basename(path.dirname(filePath));
  const modeDir = path.basename(path.dirname(path.dirname(filePath)));
  const expectedSuite = path.basename(path.dirname(filePath));
  const expectedId = path.basename(filePath, '.yaml');
  assert(VALID_CASE_MODES.has(modeDir), `${filePath} must live under evals/cases/self or evals/cases/compare`);
  assert(testCase.metadata.suite === expectedSuite, `${filePath} suite directory does not match metadata.suite`);
  assert(testCase.metadata.id === expectedId, `${filePath} file name does not match metadata.id`);
  assert(suiteDir === expectedSuite, `${filePath} suite directory could not be resolved`);
  const hasSelectBestAssertion = testCase.assert.some((entry) => entry?.type === 'select-best');
  if (modeDir === 'compare') {
    assert(hasSelectBestAssertion, `${filePath} compare cases must include a select-best assertion`);
    assert(Number.isInteger(testCase.repeat), `${filePath} compare cases must declare a top-level repeat value`);
    assert(testCase.repeat >= 3, `${filePath} compare cases must set repeat >= 3`);
    assert(
      VALID_COMPARE_GATES.has(testCase.metadata.compare_gate),
      `${filePath} compare cases must set metadata.compare_gate to one of: ${[...VALID_COMPARE_GATES].join(', ')}`,
    );
    if (testCase.metadata.compare_gate === 'reliable-blocker') {
      assert(testCase.repeat >= 3, `${filePath} reliable-blocker compare cases must set repeat >= 3`);
    }
  } else {
    assert(!hasSelectBestAssertion, `${filePath} self cases must not include select-best assertions`);
    assert(
      typeof testCase.metadata.compare_gate === 'undefined',
      `${filePath} self cases must not declare metadata.compare_gate`,
    );
  }
  assert(!seenIds.has(testCase.metadata.id), `Duplicate case id: ${testCase.metadata.id}`);
  seenIds.add(testCase.metadata.id);

  return testCase;
}

function validateAllCases({ files = listCaseFiles(CASES_ROOT), schemaPath = CASE_SCHEMA_PATH } = {}) {
  const seenIds = new Set();
  const validate = compileCaseValidator(schemaPath);
  assert(files.length > 0, `No case files found under ${CASES_ROOT}`);
  const cases = [];
  for (const filePath of files) {
    cases.push(validateCaseFile(filePath, seenIds, validate));
  }
  return cases;
}

function main() {
  const files = listCaseFiles(CASES_ROOT);
  validateAllCases({ files });
  console.log(`validated_cases=${files.length}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  CASE_SCHEMA_PATH,
  compileCaseValidator,
  formatAjvErrors,
  listCaseFiles,
  loadCase,
  validateAllCases,
  validateCaseFile,
};
