const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const FIXTURES_ROOT = path.join(ROOT, 'evals', 'fixtures');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeFixtureRef(ref, fieldName) {
  if (typeof ref === 'string' && ref.trim()) {
    return ref.trim();
  }
  if (ref && typeof ref === 'object' && typeof ref.path === 'string' && ref.path.trim()) {
    return ref.path.trim();
  }
  throw new Error(`${fieldName} must be a non-empty string or an object with a path field`);
}

function resolveFixturePath(ref, fieldName) {
  const relativePath = normalizeFixtureRef(ref, fieldName);
  const resolved = path.resolve(FIXTURES_ROOT, relativePath);
  const relativeToRoot = path.relative(FIXTURES_ROOT, resolved);
  assert(!relativeToRoot.startsWith('..') && !path.isAbsolute(relativeToRoot), `${fieldName} must stay within ${FIXTURES_ROOT}`);
  assert(fs.existsSync(resolved), `${fieldName} file not found: ${resolved}`);
  return resolved;
}

function readJsonFixture(ref, fieldName) {
  const filePath = resolveFixturePath(ref, fieldName);
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return { filePath, payload };
}

function validateRequestBundle(fixture, fieldName) {
  assert(fixture && typeof fixture === 'object', `${fieldName} must parse to an object`);
  assert(typeof fixture.fixture_id === 'string' && fixture.fixture_id.trim(), `${fieldName} missing fixture_id`);
  assert(Array.isArray(fixture.requests) && fixture.requests.length > 0, `${fieldName} missing requests[]`);
  for (const request of fixture.requests) {
    assert(typeof request.endpoint === 'string' && request.endpoint.trim(), `${fieldName} request missing endpoint`);
    assert(Object.prototype.hasOwnProperty.call(request, 'response'), `${fieldName} request missing response`);
  }
}

function validateConversationFixture(fixture, fieldName) {
  assert(fixture && typeof fixture === 'object', `${fieldName} must parse to an object`);
  assert(typeof fixture.fixture_id === 'string' && fixture.fixture_id.trim(), `${fieldName} missing fixture_id`);
  assert(Array.isArray(fixture.conversation) && fixture.conversation.length > 0, `${fieldName} missing conversation[]`);
  for (const message of fixture.conversation) {
    assert(typeof message.role === 'string' && message.role.trim(), `${fieldName} message missing role`);
    assert(typeof message.content === 'string', `${fieldName} message content must be a string`);
  }
}

function loadStravaFixture(ref) {
  const { filePath, payload } = readJsonFixture(ref, 'vars.strava_fixture');
  validateRequestBundle(payload, filePath);
  return payload;
}

function loadConversationFixture(ref) {
  const { filePath, payload } = readJsonFixture(ref, 'vars.conversation_fixture');
  validateConversationFixture(payload, filePath);
  return payload;
}

function renderStravaFixture(fixture) {
  const lines = [
    `Production-shaped Strava fixture: ${fixture.fixture_id}`,
    'The following Strava API payloads are already fetched and available.',
    '',
  ];

  for (const request of fixture.requests) {
    lines.push(request.endpoint);
    lines.push(JSON.stringify(request.response, null, 2));
    lines.push('');
  }

  return lines.join('\n').trim();
}

function renderConversationFixture(fixture) {
  const lines = [
    `Captured conversation fixture: ${fixture.fixture_id}`,
    '',
  ];
  for (const message of fixture.conversation) {
    lines.push(`${message.role.toUpperCase()}:`);
    lines.push(message.content);
    lines.push('');
  }
  return lines.join('\n').trim();
}

function resolveStravaContext(vars) {
  if (vars.strava_fixture) {
    return renderStravaFixture(loadStravaFixture(vars.strava_fixture));
  }
  return vars.strava_data || '(none provided)';
}

function resolveConversationContext(vars) {
  if (!vars.conversation_fixture) {
    return '';
  }
  return renderConversationFixture(loadConversationFixture(vars.conversation_fixture));
}

module.exports = {
  FIXTURES_ROOT,
  loadConversationFixture,
  loadStravaFixture,
  normalizeFixtureRef,
  renderConversationFixture,
  renderStravaFixture,
  resolveConversationContext,
  resolveFixturePath,
  resolveStravaContext,
};
