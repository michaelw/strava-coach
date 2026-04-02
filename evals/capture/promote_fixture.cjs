#!/usr/bin/env node

const path = require('path');
const {
  TRACKED_FIXTURE_ROOT,
  buildTrackedFixturePayload,
  readJson,
  sanitizeTranscript,
  sanitizeValue,
  writeJson,
} = require('./common.cjs');

function usage() {
  return [
    'Usage: node evals/capture/promote_fixture.cjs --kind <strava|conversation> --source <raw.json> --id <fixture-id>',
    '',
    'Required:',
    '  --kind <kind>                  Either "strava" or "conversation".',
    '  --source <path>                Path to a raw capture JSON file.',
    '  --id <fixture-id>              Stable checked-in fixture id.',
    '',
    'Examples:',
    '  node evals/capture/promote_fixture.cjs --kind strava --source .promptfoo/captures/raw/strava/private-notes-123.json --id private-notes-run',
    '  node evals/capture/promote_fixture.cjs --kind conversation --source .promptfoo/captures/raw/gpt/private-notes-123.json --id private-notes-review',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    kind: null,
    source: null,
    id: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--kind') {
      args.kind = argv[index + 1];
      index += 1;
    } else if (arg === '--source') {
      args.source = path.resolve(argv[index + 1]);
      index += 1;
    } else if (arg === '--id') {
      args.id = argv[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!args.help && (!args.kind || !args.source || !args.id)) {
    throw new Error('--kind, --source, and --id are required');
  }
  return args;
}

function promoteStrava(rawPayload, fixtureId) {
  return buildTrackedFixturePayload(
    {
      fixture_id: fixtureId,
      captured_at: rawPayload.captured_at,
      source: {
        ...rawPayload.source,
        promoted_from: path.basename(rawPayload.source_path || ''),
      },
      requests: rawPayload.requests.map((request) => ({
        endpoint: request.endpoint,
        response: sanitizeValue(request.response),
      })),
    },
    {},
  );
}

function promoteConversation(rawPayload, fixtureId) {
  return buildTrackedFixturePayload(
    {
      fixture_id: fixtureId,
      captured_at: rawPayload.captured_at,
      source: rawPayload.source,
      prompt: rawPayload.prompt,
      conversation: sanitizeTranscript(rawPayload.conversation || []),
    },
    {},
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const rawPayload = readJson(args.source);
  rawPayload.source_path = args.source;

  let outputPath;
  let promoted;
  if (args.kind === 'strava') {
    promoted = promoteStrava(rawPayload, args.id);
    outputPath = path.join(TRACKED_FIXTURE_ROOT, 'strava', `${args.id}.json`);
  } else if (args.kind === 'conversation') {
    promoted = promoteConversation(rawPayload, args.id);
    outputPath = path.join(TRACKED_FIXTURE_ROOT, 'conversations', `${args.id}.json`);
  } else {
    throw new Error(`Unsupported fixture kind: ${args.kind}`);
  }

  writeJson(outputPath, promoted);
  console.log(`fixture=${outputPath}`);
}

try {
  main();
} catch (error) {
  console.error(`Error: ${error.message || String(error)}\n\n${usage()}`);
  process.exit(1);
}
