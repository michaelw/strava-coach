const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

const specPath = path.join(__dirname, '..', 'actions', 'strava.openapi.yaml');
const officialFixturePath = path.join(__dirname, 'fixtures', 'strava_openapi_official_subset.json');
const spec = yaml.load(fs.readFileSync(specPath, 'utf8'));
const officialFixture = JSON.parse(fs.readFileSync(officialFixturePath, 'utf8'));

test('local Strava action spec matches the vendored official subset exactly', () => {
  const localWithoutExtension = structuredClone(spec);
  localWithoutExtension.paths['/activities/{id}/streams'].get.parameters =
    localWithoutExtension.paths['/activities/{id}/streams'].get.parameters.filter(
      (parameter) => parameter.name !== 'resolution',
    );

  assert.deepEqual(localWithoutExtension, officialFixture.official_spec);
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

test('local streams endpoint exposes the optional resolution extension', () => {
  const resolutionParam = spec.paths['/activities/{id}/streams'].get.parameters.find(
    (parameter) => parameter.name === 'resolution',
  );

  assert.ok(resolutionParam);
  assert.equal(resolutionParam.in, 'query');
  assert.equal(resolutionParam.required, false);
  assert.deepEqual(resolutionParam.schema.enum, ['low', 'medium', 'high']);
});
