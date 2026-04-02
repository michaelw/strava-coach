const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeTranscript, sanitizeValue } = require('./common.cjs');

test('sanitizeValue redacts tokens, ids, and coordinates', () => {
  const payload = {
    id: 12345,
    athlete: {
      id: 999,
      firstname: 'Taylor',
      profile: 'https://example.com/me.png',
    },
    start_latlng: [41.1, -87.1],
    access_token: 'secret-token',
    description: 'See https://strava.example/test and email me at runner@example.com',
  };

  const sanitized = sanitizeValue(payload);
  assert.equal(sanitized.id, '[redacted]');
  assert.equal(sanitized.athlete.id, '[redacted]');
  assert.equal(sanitized.athlete.firstname, '[redacted]');
  assert.equal(sanitized.athlete.profile, '[redacted]');
  assert.deepEqual(sanitized.start_latlng, ['[redacted-coordinate]', '[redacted-coordinate]']);
  assert.equal(sanitized.access_token, '[redacted]');
  assert.match(sanitized.description, /\[redacted-url\]/);
  assert.match(sanitized.description, /\[redacted-email\]/);
});

test('sanitizeTranscript redacts token-like and url-like content', () => {
  const transcript = sanitizeTranscript([
    {
      role: 'assistant',
      content: 'Use Authorization: Bearer abc.def and visit https://example.com',
    },
  ]);

  assert.equal(transcript[0].role, 'assistant');
  assert.match(transcript[0].content, /Bearer \[redacted-token\]/);
  assert.match(transcript[0].content, /\[redacted-url\]/);
});
