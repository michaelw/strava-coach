# Prompt Evals

This repo runs hosted prompt evals directly through Promptfoo. Promptfoo handles
prompting, assertions, grading, report generation, and the browser viewer. The
repo only adds case validation, a few convenience Taskfile aliases, and a short
Markdown summary for CI comments.

## Purpose

- keep `system_prompt.md` changes reviewable and regression-tested
- treat hard product requirements as self-grading contract tests
- use baseline comparison only where the goal is relative improvement
- publish Promptfoo-native artifacts that are easy to inspect locally and in CI

## Directory Layout

```text
evals/
  cases/
  promptfoo/
  prompts/system_prompt.baseline.md
  config.yaml
  reports/
docs/prompt-evals.md
package.json
```

## Case Format

Each file under [`evals/cases/`](https://github.com/michaelw/strava-coach/tree/main/evals/cases)
is a single Promptfoo-native case object.

Native case layout:

- `evals/cases/self/<suite>/*.yaml`
- `evals/cases/compare/<suite>/*.yaml`

Required fields:

- `description`
- `vars`
- `assert`
- `metadata.id`
- `metadata.suite`
- `metadata.priority`

Compare-case additions:

- top-level `repeat`
- `metadata.compare_gate`

### Current Mode Split

Self-grading:

- `format/*`
- `grounding/*`
- `personalization-002`
- `safety/*`
- `smoke-001`
- `smoke-002`
- `smoke-003`
- `smoke-004`
- `smoke-005`

Baseline comparison:

- `personalization-001`
- `personalization-003`

Comparison cases encode the pairwise comparison directly in the case YAML with
Promptfoo assertions such as `select-best`.

Use `self` when the case is a hard product requirement that should stand on its
own without reference to a baseline answer. Use `compare` when the main question
is relative coaching quality or whether the candidate prompt is meaningfully
better than the published baseline.

## Local Setup

```bash
task setup
task eval:validate
task test
```

For the full non-hosted repo validation flow, use:

```bash
task verify
```

Hosted evals require:

- `OPENAI_API_KEY`

Validation and fast local tests do not.

In GitHub Actions, the hosted key is stored only as the `OPENAI_API_KEY`
environment secret in `openai-ci`. Secret-backed evals run only on trusted
protected-branch events and never on `pull_request`, so PR code does not run
with the OpenAI credential.

Prompt-eval path rules for CI live in
[`.github/prompt-eval-paths.yml`](../.github/prompt-eval-paths.yml).

Hosted retry defaults live in [`evals/config.yaml`](../evals/config.yaml):

- `retries.error_passes`
- `retries.flaky_passes`
- `retries.flaky_tag`

Infrastructure errors such as API failures and timeouts are retried
automatically. Assertion failures are only retried for cases tagged with the
configured flaky tag.

## Compare Reliability

Compare runs stay Promptfoo-native, but the compare gate now blocks only on
reliable baseline wins.

Compare policy:

- compare cases must live under `evals/cases/compare/...`
- compare cases must include native Promptfoo `select-best`
- compare cases must set top-level `repeat >= 3`
- compare cases must set `metadata.compare_gate` to `reliable-blocker` or `advisory`

Reliable compare blocker:

- the case is a compare case
- `metadata.compare_gate` is `reliable-blocker`
- the aggregated result is `baseline` after repeats and retries

Reliable decision rule:

- count only decisive repeat outcomes: `candidate` or `baseline`
- require at least 3 decisive outcomes
- require a margin of at least 2 votes to call a winner
- otherwise classify the result as `tie` or `noisy`

CI behavior:

- `baseline` fails the run only for `reliable-blocker` compare cases
- `tie` and `noisy` remain non-failing in v1
- compare cases tagged with the configured flaky tag are still retried through the existing flaky-retry flow

`summary.md` shows compare decisions with explicit counts, for example:

- `decision=candidate|baseline|tie|noisy`
- `candidate=<n> baseline=<n> tie=<n> unknown=<n>`
- `gate=pass|fail`

## Native Promptfoo Commands

Self-grading config:

```bash
PROMPTFOO_CONFIG_DIR=.promptfoo ./node_modules/.bin/promptfoo eval \
  -c evals/promptfoo/promptfooconfig.self.yaml
```

Comparison config:

```bash
PROMPTFOO_CONFIG_DIR=.promptfoo ./node_modules/.bin/promptfoo eval \
  -c evals/promptfoo/promptfooconfig.compare.yaml
```

Browser viewer:

```bash
PROMPTFOO_CONFIG_DIR=.promptfoo ./node_modules/.bin/promptfoo view . -n
```

You can pass any native Promptfoo flags, for example:

```bash
PROMPTFOO_CONFIG_DIR=.promptfoo ./node_modules/.bin/promptfoo eval \
  -c evals/promptfoo/promptfooconfig.self.yaml \
  --watch \
  --filter-metadata suite=grounding
```

## Taskfile Commands

Smoke suite:

```bash
task eval:smoke
```

Targeted self-grading runs:

```bash
task eval:self -- --filter-metadata suite=grounding
task eval:self -- --filter-metadata id=grounding-001
```

Comparison runs:

```bash
task eval:compare
task eval:compare -- --filter-metadata suite=personalization
```

Full suite:

```bash
task eval:full
```

Viewer:

```bash
task eval:view -- -n
```

## Runtime And Artifacts

Local tasks default to:

- `PROMPTFOO_CONFIG_DIR=.promptfoo`
- `PROMPT_EVAL_OUTPUT_DIR=evals/reports/<timestamp>-<mode>`

Promptfoo-native artifact files are written into the chosen output directory.
Typical files are:

- `self.json`
- `compare.json`
- `summary.md`

CI may produce additional per-suite files such as `self.smoke.json` or
`compare.personalization.json` when it loops changed suites on trusted `main`
pushes.

`summary.md` is generated by scanning all Promptfoo JSON files in the artifact
directory. When retries occur, additional files such as `self.retry-errors.1.json` or
`compare.retry-flaky.1.json` are written alongside the primary phase report.

If you want a stable local output directory instead of the default timestamped
one, set `PROMPT_EVAL_OUTPUT_DIR` explicitly before running the task.

To inspect a different state directory in the browser viewer:

```bash
PROMPTFOO_CONFIG_DIR="<state_dir>" ./node_modules/.bin/promptfoo view . -n
```

## CI Behavior

CI keeps the same high-level entrypoints:

- run one required prompt gate that validates cases and runs fast local tests when relevant files changed
- run smoke hosted evals on trusted `main` pushes and manual dispatches from `main`
- run targeted hosted evals on trusted `main` pushes
- run the full suite on the nightly schedule when `main` has a new commit since the last completed nightly
- allow trusted operators to trigger the nightly full run manually on `main` for QA or emergency use

The repo routes validation through Taskfile targets, uploads the native
Promptfoo artifact directory, and uses the `openai-ci` GitHub Actions
environment for the hosted key. The required prompt-related check is `Prompt Eval Gate`.
It stays present on every PR, but exits quickly when no prompt-eval inputs
changed so doc-only or other immaterial edits do not pay the full setup/test
cost. GitHub still creates the scheduled workflow run every day; the workflow
just skips the expensive nightly eval jobs after a lightweight preflight when
the latest `main` commit matches the last completed nightly run. Trusted repo
operators can bypass that scheduled skip by manually dispatching the workflow on
`main` with `run_nightly_full=true`, which is intended for QA and emergency
validation. If you want a browser UI, use `task eval:view` or `promptfoo view`
against the desired Promptfoo state directory rather than expecting per-run
HTML files.

## Capture Pipeline For Production-Shaped Fixtures

The repo supports a repeatable capture flow for realistic fixtures without
running live account-backed evals in normal test runs.

Raw captures stay local under `.promptfoo/captures/` and are never checked in.
Promoted, sanitized fixtures live under:

- [`evals/fixtures/production/strava/`](https://github.com/michaelw/strava-coach/tree/main/evals/fixtures/production/strava)
- [`evals/fixtures/production/conversations/`](https://github.com/michaelw/strava-coach/tree/main/evals/fixtures/production/conversations)

### Strava capture

Required environment for live capture only:

- `STRAVA_CLIENT_ID`
- `STRAVA_CLIENT_SECRET`
- optional `STRAVA_REDIRECT_URI`
- optional `STRAVA_ACCESS_TOKEN`

Typical flow:

```bash
task capture:strava:auth-url
task capture:strava:exchange-code -- --code "<code-from-redirect>"
task capture:strava:capture
task capture:strava:capture -- --label "private-notes" --activity-id "123456789"
task capture:promote -- --kind "strava" --source ".promptfoo/captures/raw/strava/private-notes-<timestamp>.json" --id "private-notes-run"
```

### GPT capture

GPT capture uses Playwright against the live Strava Coach GPT:

- [chatgpt.com/g/g-69bd636fa99c8191ac5ffce9859deef2-strava-coach](https://chatgpt.com/g/g-69bd636fa99c8191ac5ffce9859deef2-strava-coach)

You need an authenticated browser session. The script opens a persistent browser
profile, waits for login if needed, submits a scenario prompt, then waits for
you to confirm that the answer is complete before saving the visible transcript.

Example:

```bash
task capture:gpt -- --scenario "evals/capture/scenarios/private-notes.yaml" --label "private-notes"
task capture:promote -- --kind "conversation" --source ".promptfoo/captures/raw/gpt/private-notes-<timestamp>.json" --id "private-notes-review"
```

### Sanitization and check-in rules

- Do not check in raw captures from `.promptfoo/captures/`
- Only check in promoted fixtures under `evals/fixtures/production/`
- Promotion deterministically redacts tokens, IDs, URLs, emails, and coordinate-like fields
- Review promoted fixtures before committing them; the sanitizer is conservative, not magical
