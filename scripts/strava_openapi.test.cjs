const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const specPath = path.join(__dirname, '..', 'actions', 'strava.openapi.yaml');
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));

test('core Strava responses use explicit $ref schemas', () => {
  assert.equal(
    spec.paths['/athlete'].get.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/Athlete',
  );
  assert.equal(
    spec.paths['/athlete/activities'].get.responses['200'].content['application/json'].schema.items.$ref,
    '#/components/schemas/ActivitySummary',
  );
  assert.equal(
    spec.paths['/activities/{id}'].get.responses['200'].content['application/json'].schema.$ref,
    '#/components/schemas/ActivityDetail',
  );
});

test('activity schemas cover fields used by tracked fixtures', () => {
  const summaryProperties = spec.components.schemas.ActivitySummary.properties;
  const detailProperties = spec.components.schemas.ActivityDetail.properties;

  assert.ok(summaryProperties.start_date_local);
  assert.ok(summaryProperties.average_speed);
  assert.ok(summaryProperties.average_heartrate);
  assert.ok(summaryProperties.average_watts);

  assert.ok(detailProperties.start_date_local);
  assert.ok(detailProperties.average_speed);
  assert.ok(detailProperties.average_heartrate);
  assert.ok(detailProperties.average_watts);
});

test('activity streams response distinguishes usable streams from explicit errors', () => {
  const streamResponseSchema =
    spec.paths['/activities/{id}/streams'].get.responses['200'].content['application/json'].schema;

  assert.equal(streamResponseSchema.oneOf.length, 2);
  assert.deepEqual(
    streamResponseSchema.oneOf.map((entry) => entry.$ref),
    [
      '#/components/schemas/ActivityStreams',
      '#/components/schemas/StreamErrorResponse',
    ],
  );

  const streamSchema = spec.components.schemas.ActivityStream;
  assert.deepEqual(streamSchema.required, ['data']);
  assert.equal(streamSchema.properties.data.type, 'array');
  assert.deepEqual(
    streamSchema.properties.data.items.oneOf.map((entry) => entry.type),
    ['number', 'array'],
  );
});
