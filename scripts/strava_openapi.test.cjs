const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const specPath = path.join(__dirname, '..', 'actions', 'strava.openapi.yaml');
const officialFixturePath = path.join(__dirname, 'fixtures', 'strava_openapi_official_subset.json');
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
const officialFixture = JSON.parse(fs.readFileSync(officialFixturePath, 'utf8'));
const localSpecFixture = officialFixture.spec;

const LOCAL_ACTIVITY_DESCRIPTION =
  'Returns the given activity that is owned by the authenticated athlete. Requires activity:read for Everyone and Followers activities and activity:read_all for Only Me activities.';
const UPSTREAM_SPEC_VERSION = '3.0.0';
const LOCAL_SPEC_VERSION = '3.0.0+strava-coach.1';

test('local Strava action spec matches the generated local fixture exactly', () => {
  assert.deepEqual(spec, localSpecFixture);
});

test('vendored official subset metadata documents the selected Strava sources', () => {
  assert.deepEqual(officialFixture.selected_paths, [
    '/athlete',
    '/athlete/zones',
    '/athletes/{id}/stats',
    '/athlete/activities',
    '/activities/{id}',
    '/activities/{id}/streams',
    '/activities/{id}/zones',
  ]);
  assert.ok(officialFixture.source_urls.includes('https://developers.strava.com/swagger/swagger.json'));
  assert.ok(officialFixture.source_urls.includes('https://developers.strava.com/swagger/activity.json'));
});

test('local Strava action spec documents importer-compatibility transforms explicitly', () => {
  assert.equal(officialFixture.official_spec.openapi, '3.0.3');
  assert.equal(spec.openapi, '3.1.0');
  assert.equal(officialFixture.official_spec.info.version, UPSTREAM_SPEC_VERSION);
  assert.equal(spec.info.version, LOCAL_SPEC_VERSION);

  assert.equal(
    officialFixture.official_spec.paths['/activities/{id}'].get.description.includes('![Attribution]'),
    true,
  );
  assert.equal(spec.paths['/activities/{id}'].get.description, LOCAL_ACTIVITY_DESCRIPTION);

  assert.equal(
    officialFixture.official_spec.components.schemas.ActivityZone.properties.distribution_buckets.$ref,
    '#/TimedZoneDistribution',
  );
  assert.equal(
    spec.components.schemas.ActivityZone.properties.distribution_buckets.$ref,
    '#/components/schemas/TimedZoneDistribution',
  );

  assert.equal(officialFixture.official_spec.components.schemas.TimedZoneDistribution, undefined);
  assert.deepEqual(spec.components.schemas.TimedZoneDistribution, {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        min: {
          type: 'integer',
          description: 'The lower bound of the zone range.',
        },
        max: {
          type: 'integer',
          description: 'The upper bound of the zone range.',
        },
        time: {
          type: 'integer',
          description: 'The number of seconds spent in the zone range.',
        },
      },
    },
  });
});

test('local streams endpoint exposes the optional resolution extension', () => {
  const resolutionParam = spec.paths['/activities/{id}/streams'].get.parameters.find(
    (parameter) => parameter.name === 'resolution',
  );

  assert.ok(resolutionParam);
  assert.equal(resolutionParam.in, 'query');
  assert.equal(resolutionParam.required, false);
  assert.deepEqual(resolutionParam.schema.enum, ['low', 'medium', 'high']);
});
