#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = path.join(__dirname, '..');
const OUTPUT_SPEC_PATH = path.join(ROOT, 'actions', 'strava.openapi.yaml');
const OUTPUT_FIXTURE_PATH = path.join(__dirname, 'fixtures', 'strava_openapi_official_subset.json');

const OFFICIAL_SWAGGER_URL = 'https://developers.strava.com/swagger/swagger.json';
const SELECTED_PATHS = [
  '/athlete',
  '/athlete/zones',
  '/athletes/{id}/stats',
  '/athlete/activities',
  '/activities/{id}',
  '/activities/{id}/streams',
  '/activities/{id}/zones',
];

const SECURITY_BY_PATH = {
  '/athlete': [['profile:read_all']],
  '/athlete/zones': [['profile:read_all']],
  '/athlete/activities': [['activity:read'], ['activity:read_all']],
  '/activities/{id}': [['activity:read'], ['activity:read_all']],
  '/activities/{id}/streams': [['activity:read'], ['activity:read_all']],
  '/activities/{id}/zones': [['activity:read'], ['activity:read_all']],
};

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${text.slice(0, 200)}`);
  }
  return JSON.parse(text);
}

function clone(value) {
  if (Array.isArray(value)) {
    return value.map(clone);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)]));
}

function walk(value, visitor) {
  if (!value || typeof value !== 'object') {
    return;
  }
  visitor(value);
  if (Array.isArray(value)) {
    for (const child of value) {
      walk(child, visitor);
    }
    return;
  }
  for (const child of Object.values(value)) {
    walk(child, visitor);
  }
}

function refName(ref) {
  return ref.split('#/').pop().split('/').pop();
}

function toLocalRef(ref) {
  return `#/components/schemas/${refName(ref)}`;
}

function isExternalSchemaRef(ref) {
  return typeof ref === 'string' && ref.startsWith('https://developers.strava.com/swagger/');
}

function convertSchemaNode(node) {
  if (Array.isArray(node)) {
    return node.map(convertSchemaNode);
  }
  if (!node || typeof node !== 'object') {
    return node;
  }
  if (node.$ref) {
    return { $ref: isExternalSchemaRef(node.$ref) ? toLocalRef(node.$ref) : node.$ref };
  }
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, convertSchemaNode(value)]));
}

function convertParameter(swagger, parameter) {
  const resolved = parameter.$ref
    ? swagger.parameters[parameter.$ref.split('/').pop()]
    : parameter;

  const result = {
    name: resolved.name,
    in: resolved.in,
  };

  if (resolved.description) {
    result.description = resolved.description;
  }
  if (resolved.required) {
    result.required = true;
  }

  const schema = {};
  for (const key of [
    'type',
    'format',
    'default',
    'enum',
    'minimum',
    'maximum',
    'minItems',
    'maxItems',
    'minLength',
    'maxLength',
    'items',
  ]) {
    if (resolved[key] !== undefined) {
      schema[key] = convertSchemaNode(resolved[key]);
    }
  }

  if (Object.keys(schema).length > 0) {
    result.schema = schema;
  }
  if (resolved.type === 'array' && resolved.collectionFormat === 'csv') {
    result.style = 'form';
    result.explode = false;
  }

  return result;
}

function convertResponse(response) {
  const converted = {
    description: response.description || '',
  };

  if (response.schema) {
    converted.content = {
      'application/json': {
        schema: convertSchemaNode(response.schema),
      },
    };
  }

  return converted;
}

function convertOperation(swagger, pathKey, operation) {
  const converted = {
    operationId: operation.operationId,
    summary: operation.summary,
  };

  if (operation.description) {
    converted.description = operation.description;
  }
  if (operation.tags) {
    converted.tags = clone(operation.tags);
  }
  if (SECURITY_BY_PATH[pathKey]) {
    converted.security = SECURITY_BY_PATH[pathKey].map((scopes) => ({
      strava_oauth: scopes,
    }));
  }
  if (operation.parameters?.length) {
    converted.parameters = operation.parameters.map((parameter) => convertParameter(swagger, parameter));
  }

  converted.responses = Object.fromEntries(
    Object.entries(operation.responses).map(([status, response]) => [status, convertResponse(response)]),
  );

  return converted;
}

function collectRootSchemaRefs(operation, refs) {
  walk(operation.parameters, (node) => {
    if (isExternalSchemaRef(node.$ref)) {
      refs.add(node.$ref);
    }
  });
  walk(operation.responses, (node) => {
    if (isExternalSchemaRef(node.$ref)) {
      refs.add(node.$ref);
    }
  });
}

async function loadExternalSchema(cache, ref) {
  const [url, fragment] = ref.split('#/');
  if (!cache.has(url)) {
    cache.set(url, await fetchJson(url));
  }
  let node = cache.get(url);
  for (const part of fragment.split('/')) {
    node = node[part];
  }
  return node;
}

async function buildComponents(rootRefs) {
  const externalDocs = new Map();
  const queue = [...rootRefs];
  const seen = new Set();
  const schemas = {};

  while (queue.length) {
    const ref = queue.shift();
    if (seen.has(ref)) {
      continue;
    }
    seen.add(ref);

    const schema = await loadExternalSchema(externalDocs, ref);
    schemas[refName(ref)] = convertSchemaNode(schema);

    walk(schema, (node) => {
      if (isExternalSchemaRef(node.$ref)) {
        queue.push(node.$ref);
      }
    });
  }

  return schemas;
}

function convertSecurityScheme(swagger) {
  const official = swagger.securityDefinitions.strava_oauth;
  return {
    strava_oauth: {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: official.authorizationUrl,
          tokenUrl: official.tokenUrl,
          scopes: clone(official.scopes),
        },
      },
    },
  };
}

function applyLocalExtensions(spec) {
  const streamParams = spec.paths['/activities/{id}/streams'].get.parameters;
  streamParams.push({
    name: 'resolution',
    in: 'query',
    description: 'Sampling hint for returned stream density. Observed-supported values are low, medium, and high.',
    required: false,
    schema: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
  });
}

async function buildSpec() {
  const swagger = await fetchJson(OFFICIAL_SWAGGER_URL);
  const rootRefs = new Set();
  const paths = {};

  for (const pathKey of SELECTED_PATHS) {
    const source = swagger.paths[pathKey];
    if (!source?.get) {
      throw new Error(`Missing GET operation for ${pathKey} in official Strava Swagger`);
    }
    collectRootSchemaRefs(source.get, rootRefs);
    paths[pathKey] = {
      get: convertOperation(swagger, pathKey, source.get),
    };
  }

  const spec = {
    openapi: '3.0.3',
    info: {
      title: swagger.info.title,
      description: swagger.info.description,
      version: swagger.info.version,
    },
    servers: [
      {
        url: `${swagger.schemes[0]}://${swagger.host}${swagger.basePath}`,
      },
    ],
    security: [
      {
        strava_oauth: [],
      },
    ],
    paths,
    components: {
      securitySchemes: convertSecurityScheme(swagger),
      schemas: await buildComponents(rootRefs),
    },
  };

  const officialSpec = clone(spec);
  applyLocalExtensions(spec);

  return {
    selected_paths: SELECTED_PATHS,
    source_urls: [
      OFFICIAL_SWAGGER_URL,
      'https://developers.strava.com/swagger/athlete.json',
      'https://developers.strava.com/swagger/activity.json',
      'https://developers.strava.com/swagger/activity_stats.json',
      'https://developers.strava.com/swagger/stream.json',
      'https://developers.strava.com/swagger/zones.json',
      'https://developers.strava.com/swagger/fault.json',
    ],
    official_spec: officialSpec,
    spec,
  };
}

async function main() {
  const result = await buildSpec();
  const shouldWrite = process.argv.includes('--write');

  if (shouldWrite) {
    fs.mkdirSync(path.dirname(OUTPUT_FIXTURE_PATH), { recursive: true });
    fs.writeFileSync(OUTPUT_FIXTURE_PATH, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    fs.writeFileSync(OUTPUT_SPEC_PATH, yaml.dump(result.spec, { lineWidth: 1000, noRefs: true }), 'utf8');
    console.log(`wrote_spec=${OUTPUT_SPEC_PATH}`);
    console.log(`wrote_fixture=${OUTPUT_FIXTURE_PATH}`);
    return;
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
