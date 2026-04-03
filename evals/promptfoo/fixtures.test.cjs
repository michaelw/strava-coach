const test = require('node:test');
const assert = require('node:assert/strict');
const {
  loadConversationFixture,
  loadStravaFixture,
  renderConversationFixture,
  renderStravaFixture,
} = require('./fixtures.cjs');

test('loadStravaFixture reads tracked production fixtures', () => {
  const fixture = loadStravaFixture('production/strava/grounding-no-streams.json');
  assert.equal(fixture.fixture_id, 'grounding-no-streams');
  assert.ok(Array.isArray(fixture.requests));
  assert.match(renderStravaFixture(fixture), /GET \/athlete/);
});

test('loadConversationFixture reads tracked conversation fixtures', () => {
  const fixture = loadConversationFixture('production/conversations/private-notes-review.json');
  assert.equal(fixture.fixture_id, 'private-notes-review');
  assert.ok(Array.isArray(fixture.conversation));
  assert.match(renderConversationFixture(fixture), /USER:/);
});
