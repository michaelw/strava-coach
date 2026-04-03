#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ROOT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
OUTPUT_DIR=""
OUTPUT_PREFIX=""
RETRY_ERRORS_PASSES=""
RETRY_FLAKY_PASSES=""
FLAKY_TAG=""
SKIP_SUMMARY="${PROMPT_EVAL_SKIP_SUMMARY:-false}"
REPO_CONFIG_PATH="${PROMPT_EVAL_REPO_CONFIG_PATH:-$ROOT_DIR/evals/config.yaml}"

usage() {
  echo "Usage: sh evals/promptfoo/run_promptfoo_phase.sh [--output-dir <dir>] [--output-prefix <prefix>] [--retry-errors-passes <n>] [--retry-flaky-passes <n>] [--flaky-tag <tag>] [--skip-summary] <config-path> [promptfoo args...]" >&2
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --output-prefix)
      OUTPUT_PREFIX="$2"
      shift 2
      ;;
    --retry-errors-passes)
      RETRY_ERRORS_PASSES="$2"
      shift 2
      ;;
    --retry-flaky-passes)
      RETRY_FLAKY_PASSES="$2"
      shift 2
      ;;
    --flaky-tag)
      FLAKY_TAG="$2"
      shift 2
      ;;
    --skip-summary)
      SKIP_SUMMARY="true"
      shift 1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
    *)
      break
      ;;
  esac
done

if [ "$#" -lt 1 ]; then
  usage
  exit 1
fi

CONFIG_PATH="$1"
shift 1

case "$CONFIG_PATH" in
  /*)
    RESOLVED_CONFIG_PATH="$CONFIG_PATH"
    ;;
  *)
    RESOLVED_CONFIG_PATH="$ROOT_DIR/$CONFIG_PATH"
    ;;
esac

CONFIG_BASENAME=$(basename -- "$RESOLVED_CONFIG_PATH")
PHASE_NAME="${CONFIG_BASENAME%.yaml}"
PHASE_NAME="${PHASE_NAME#promptfooconfig.}"

OUTPUT_DIR="${OUTPUT_DIR:-${PROMPT_EVAL_OUTPUT_DIR:-$ROOT_DIR/evals/reports/$(date -u +%Y%m%dT%H%M%SZ)-$PHASE_NAME}}"
OUTPUT_PREFIX="${OUTPUT_PREFIX:-${PROMPT_EVAL_OUTPUT_PREFIX:-$PHASE_NAME}}"
PROMPTFOO_CONFIG_DIR="${PROMPTFOO_CONFIG_DIR:-$ROOT_DIR/.promptfoo}"
PROMPTFOO_DISABLE_WAL_MODE="${PROMPTFOO_DISABLE_WAL_MODE:-true}"
PROMPTFOO_BIN="${PROMPTFOO_BIN:-$ROOT_DIR/node_modules/.bin/promptfoo}"
BASELINE_CACHE_DIR="$PROMPTFOO_CONFIG_DIR/baselines"
IFS='	' read -r DEFAULT_RETRY_ERRORS_PASSES DEFAULT_RETRY_FLAKY_PASSES DEFAULT_FLAKY_TAG <<EOF
$(node -e "
  const { readRetryPolicy } = require('$ROOT_DIR/evals/promptfoo/config.cjs');
  const policy = readRetryPolicy('$REPO_CONFIG_PATH');
  process.stdout.write([policy.error_passes, policy.flaky_passes, policy.flaky_tag].join('\t'));
")
EOF
RETRY_ERRORS_PASSES="${RETRY_ERRORS_PASSES:-${PROMPT_EVAL_RETRY_ERRORS_PASSES:-$DEFAULT_RETRY_ERRORS_PASSES}}"
RETRY_FLAKY_PASSES="${RETRY_FLAKY_PASSES:-${PROMPT_EVAL_RETRY_FLAKY_PASSES:-$DEFAULT_RETRY_FLAKY_PASSES}}"
FLAKY_TAG="${FLAKY_TAG:-${PROMPT_EVAL_FLAKY_TAG:-$DEFAULT_FLAKY_TAG}}"

mkdir -p "$OUTPUT_DIR"

if [ "$PHASE_NAME" = "compare" ]; then
  STRAVA_COACH_RESOLVED_BASELINE_PROMPT_PATH="$(
    node "$ROOT_DIR/evals/prompts/resolve_baseline_prompt.cjs" \
      --output-dir "$BASELINE_CACHE_DIR" \
      --repo-config "$REPO_CONFIG_PATH"
  )"
  export STRAVA_COACH_RESOLVED_BASELINE_PROMPT_PATH
fi

run_promptfoo_eval() {
  OUTPUT_PATH="$1"
  shift 1
  PROMPTFOO_CONFIG_DIR="$PROMPTFOO_CONFIG_DIR" \
  PROMPTFOO_DISABLE_WAL_MODE="$PROMPTFOO_DISABLE_WAL_MODE" \
  "$PROMPTFOO_BIN" eval \
    -c "$RESOLVED_CONFIG_PATH" \
    --no-cache \
    -o "$OUTPUT_PATH" \
    "$@" || true
}

get_retry_counts() {
  node -e "
    const fs = require('fs');
    const reportPath = process.argv[1];
    const flakyTag = process.argv[2];
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    const rows = Array.isArray(report?.results?.results) ? report.results.results : [];
    function isExpectedGradingFailure(row) {
      const candidateError = row?.error || '';
      if (!candidateError || row?.gradingResult?.pass !== false) {
        return false;
      }
      if (
        candidateError === row.gradingResult.reason
        && candidateError.startsWith('Output not selected:')
      ) {
        return true;
      }
      return Array.isArray(row.gradingResult.componentResults)
        && row.gradingResult.componentResults.some((component) => component?.reason === candidateError);
    }
    const groups = new Map();
    for (const row of rows) {
      const groupKey = row.testIdx != null
        ? String(row.testIdx)
        : \`\${row.testCase?.metadata?.suite || 'unknown'}:\${row.testCase?.metadata?.id || row.id || groups.size}\`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(row);
    }

    let errorCount = 0;
    let flakyFailureCount = 0;
    for (const group of groups.values()) {
      const sortedRows = [...group].sort((left, right) => (left.promptIdx || 0) - (right.promptIdx || 0));
      const candidateRow = sortedRows.find((row) => row.promptIdx === 0) || sortedRows[0];
      const baselineRow = sortedRows.find((row) => row.promptIdx === 1) || null;
      const candidateError = candidateRow?.error || '';
      const fallbackError = baselineRow?.error || '';
      const infrastructureError = (!isExpectedGradingFailure(candidateRow) && candidateError)
        || (!isExpectedGradingFailure(baselineRow) && fallbackError);
      if (infrastructureError) {
        errorCount += 1;
        continue;
      }
      if (candidateRow?.success === false) {
        const tags = Array.isArray(candidateRow?.testCase?.metadata?.tags) ? candidateRow.testCase.metadata.tags : [];
        if (tags.includes(flakyTag)) {
          flakyFailureCount += 1;
        }
      }
    }

    process.stdout.write([errorCount, flakyFailureCount].join('\t'));
  " "$1" "$2"
}

INITIAL_OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_PREFIX.json"
run_promptfoo_eval "$INITIAL_OUTPUT_PATH" "$@"

LAST_REPORT_PATH="$INITIAL_OUTPUT_PATH"
ERROR_ATTEMPT=1
while [ "$ERROR_ATTEMPT" -le "$RETRY_ERRORS_PASSES" ]; do
  if [ ! -f "$LAST_REPORT_PATH" ]; then
    break
  fi
  IFS='	' read -r ERROR_COUNT FLAKY_FAILURE_COUNT <<EOF
$(get_retry_counts "$LAST_REPORT_PATH" "$FLAKY_TAG")
EOF
  if [ "${ERROR_COUNT:-0}" -le 0 ]; then
    break
  fi
  RETRY_OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_PREFIX.retry-errors.$ERROR_ATTEMPT.json"
  run_promptfoo_eval "$RETRY_OUTPUT_PATH" --retry-errors "$@"
  LAST_REPORT_PATH="$RETRY_OUTPUT_PATH"
  ERROR_ATTEMPT=$((ERROR_ATTEMPT + 1))
done

FLAKY_ATTEMPT=1
while [ "$FLAKY_ATTEMPT" -le "$RETRY_FLAKY_PASSES" ]; do
  if [ ! -f "$LAST_REPORT_PATH" ]; then
    break
  fi
  IFS='	' read -r ERROR_COUNT FLAKY_FAILURE_COUNT <<EOF
$(get_retry_counts "$LAST_REPORT_PATH" "$FLAKY_TAG")
EOF
  if [ "${FLAKY_FAILURE_COUNT:-0}" -le 0 ]; then
    break
  fi
  RETRY_OUTPUT_PATH="$OUTPUT_DIR/$OUTPUT_PREFIX.retry-flaky.$FLAKY_ATTEMPT.json"
  run_promptfoo_eval \
    "$RETRY_OUTPUT_PATH" \
    --filter-failing-only "$LAST_REPORT_PATH" \
    --filter-metadata "tags=$FLAKY_TAG" \
    "$@"
  LAST_REPORT_PATH="$RETRY_OUTPUT_PATH"
  FLAKY_ATTEMPT=$((FLAKY_ATTEMPT + 1))
done

if [ "$SKIP_SUMMARY" != "true" ]; then
  node "$ROOT_DIR/evals/promptfoo/promptfoo_summary.cjs" --artifact-dir "$OUTPUT_DIR" --check
fi
