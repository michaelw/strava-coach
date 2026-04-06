# Prompt Evals

This repo runs hosted prompt evals directly through Promptfoo. Promptfoo handles
prompting, assertions, grading, report generation, and the browser viewer. The
repo only adds case validation, a few convenience Taskfile aliases, and a short
Markdown summary for CI comments.

Use `task` as the canonical human-facing interface for prompt-eval operations.
Raw `node` scripts are internal building blocks used by Task and selected
pre-commit hooks.

## Purpose

- keep `system_prompt.md` changes reviewable and regression-tested
- treat hard product requirements as self-grading contract tests
- use baseline comparison only where the goal is relative improvement
- publish Promptfoo-native artifacts that are easy to inspect locally and in CI
- read the candidate prompt directly from the repo-root `system_prompt.md`

## Directory Layout

```text
evals/
  cases/
  promptfoo/
  prompts/
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

For a concise guide to what runs automatically in local hooks, PR CI, trusted
hosted evals, and nightlies, see
[`docs/CI.md`](./CI.md).

Hosted evals require:

- `OPENAI_API_KEY`

Validation and fast local tests do not.

In GitHub Actions, the hosted key is stored only as the `OPENAI_API_KEY`
environment secret in `openai-ci`.

Hosted eval access is split by trust level:

- `pull_request` hosted evals run only for same-repo PRs
- same-repo PRs get `Eval Smoke Contract` as the required hosted pre-merge signal
- same-repo PRs also get advisory `Eval Smoke Canary`, which repeats the smoke
  self-grading suite with stochastic sampling and reports per-case bad-sample
  rates instead of failing on a single unlucky sample
- same-repo PRs also run advisory `Eval Targeted` only for non-smoke suites
  detected from changed `evals/cases/**` files; `smoke` is never re-run via
  `Eval Targeted` on a PR because `Eval Smoke Contract` already owns that lane
- fork PRs still get only non-secret validation
- same-repo write access is treated as trusted in this repo's threat model
- `push` to `main`, scheduled runs, and manual dispatches on `main` continue to
  use the hosted key

Because `pull_request` runs use refs like `refs/pull/<n>/merge`, the
`openai-ci` environment uses selected branch and tag policies instead of
protected-branches-only. The selected policies allow `main` and
`refs/pull/*/merge`.

Prompt-eval path rules for CI live in
[`.github/prompt-eval-paths.yml`](../.github/prompt-eval-paths.yml).

Hosted retry defaults live in [`evals/config.yaml`](../evals/config.yaml):

- `retries.error_passes`
- `retries.flaky_passes`
- `retries.flaky_tag`
- `canary.repeat`
- `canary.allowed_failures`
- `canary.temperature`

Infrastructure errors such as API failures and timeouts are retried
automatically for the standard contract and compare lanes. Assertion failures
are only retried for cases tagged with the configured flaky tag.

## Contract And Canary Lanes

Hosted smoke coverage is intentionally split into two lanes:

- `Eval Smoke Contract` uses deterministic provider settings for hard
  self-grading requirements such as secrecy, refusal boundaries, and grounding.
  This is the required hosted PR gate.
- `Eval Smoke Canary` uses a higher-temperature smoke config plus repeated
  sampling. It reports per-case bad-sample rates so one unlucky sample does not
  automatically count as a hard regression. It intentionally runs without
  retries so the reported sample counts reflect raw stochastic behavior.

The current canary policy comes from [`evals/config.yaml`](../evals/config.yaml):

- `repeat=5`
- `allowed_failures=1`
- `temperature=1`

That means:

- `0` bad samples is `PASS`
- `1` failed sample is `WARN`
- `2+` failed samples is `FAIL`
- any infrastructure error is `ERROR`

PRs keep the canary advisory. Trusted `main` pushes and nightly/manual `main`
runs use the same canary summary but treat `FAIL` and `ERROR` as stronger
signals.

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

In GitHub Actions, the summary script also writes a compact reviewer-facing
outcome block into the eval step log and the GitHub step summary. That block
calls out the final `PASS`/`FAIL`/`ERROR` state plus the failing or errored case
ids and reasons so artifact download is no longer the primary way to understand
what happened.

## Native Promptfoo Commands

Self-grading config:

```bash
PROMPTFOO_CONFIG_DIR=.promptfoo ./node_modules/.bin/promptfoo eval \
  -c evals/promptfoo/promptfooconfig.self.yaml
```

Comparison config:

```bash
STRAVA_COACH_RESOLVED_BASELINE_PROMPT_PATH="$(task eval:baseline:resolve)" \
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

Use `task eval:compare` as the normal compare entrypoint. The raw compare
Promptfoo command above is mainly for debugging and requires a resolved baseline
artifact path in `STRAVA_COACH_RESOLVED_BASELINE_PROMPT_PATH`.

## Taskfile Commands

Smoke suite:

```bash
task eval:smoke
```

Smoke canary lane:

```bash
task eval:smoke:canary
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

Baseline artifact resolution:

```bash
task eval:baseline:resolve
task eval:baseline:resolve -- --json
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

Compare evals also resolve a pinned baseline prompt artifact into local
Promptfoo state before Promptfoo starts. By default that cached artifact lives
under:

- `.promptfoo/baselines/`

The default baseline source is defined in
[`evals/config.yaml`](../evals/config.yaml) and points at an immutable,
semver-versioned GitHub Releases download URL. `task eval:compare` and
`task eval:full` fetch that artifact automatically. If the artifact cannot be
fetched, compare evals fail early before any hosted model calls are made.

## Baseline Promotion And Overrides

The repo no longer keeps a second tracked copy of the system prompt for compare
evals. Instead:

1. The candidate prompt remains the repo-root [`system_prompt.md`](../system_prompt.md).
2. The default compare baseline is pinned in [`evals/config.yaml`](../evals/config.yaml)
   under `baseline.version` and `baseline.url`.
3. Compare runs resolve that pinned artifact from its release download URL and cache
   it locally under `.promptfoo/baselines/`.

Successful baseline releases are published through
[`baseline-prompt-release.yml`](../.github/workflows/baseline-prompt-release.yml).
Normal semver tags like `prompt-baseline-v1.1.0` publish `system_prompt.md` as
the asset `strava-coach-system-prompt.md`. The publisher creates a draft
release first, uploads the asset, and publishes only after the draft is
complete. The shared publisher runs inside the workflow via a pinned
`actions/github-script` step. Published releases are treated as immutable and
are not repaired in place.

After a new semver baseline release is published, Renovate uses
[`renovate.json5`](../renovate.json5) to detect that release and
open a PR which updates both `baseline.version` and `baseline.url` in
[`evals/config.yaml`](../evals/config.yaml) to the new immutable release
artifact. That PR then goes through the normal repo validation flow like any
other prompt-eval change.

This repository expects the hosted Renovate GitHub App rather than a
self-hosted Renovate workflow. Once the app is installed for the repo, the same
config also covers the repo's other versioned artifacts such as npm
dependencies, GitHub Actions references, and pre-commit hooks.

For targeted QA or local experiments, you can override the default source
without editing tracked files:

- `STRAVA_COACH_BASELINE_URL=https://example.com/prompt.md task eval:compare`
- `STRAVA_COACH_BASELINE_URL=file:///absolute/path/to/prompt.md task eval:compare`
- `STRAVA_COACH_BASELINE_PROMPT_PATH=/absolute/path/to/prompt.md task eval:compare`

Use `file://` URLs for local QA, offline work, or airgapped environments when
you still want to stay on the URL-based baseline interface. The explicit path
override remains available as a convenience escape hatch.

### Release Workflow

Current pinned baseline:

1. `prompt-baseline-v1.0.0` already exists as the initial release-backed
   baseline artifact.
2. [`evals/config.yaml`](../evals/config.yaml) stays pinned to that release URL
   until a newer baseline release is intentionally promoted by the Renovate PR.

Future releases:

1. Publish a new `prompt-baseline-v<semver>` release from `system_prompt.md`
   via the `Publish Baseline Prompt Release` workflow or by pushing the matching
   tag.
2. If you use workflow dispatch, you may optionally provide `target_ref`; when
   omitted, the workflow releases the current default branch tip.
3. The publisher creates a draft release first, uploads
   `strava-coach-system-prompt.md`, and publishes only after the asset is
   attached.
4. Baseline releases published from the GitHub Releases UI are unsupported and
   intentionally fail the guard workflow.
5. Let Renovate open the PR that updates
   [`evals/config.yaml`](../evals/config.yaml) to that release.
6. Review the generated PR and let the existing CI validate the updated pin.
7. If Renovate has not opened the PR yet, check that the Renovate GitHub App is
   installed for this repository and that it has processed the new release.

CI may produce additional per-suite files such as `self.smoke.json` or
`compare.personalization.json` when it loops changed suites on trusted `main`
pushes.

`summary.md` is generated by scanning all Promptfoo JSON files in the artifact
directory. When retries occur, additional files such as `self.retry-errors.1.json` or
`compare.retry-flaky.1.json` are written alongside the primary phase report.

The top of `summary.md` now mirrors the high-signal CI outcome block:

- final status and totals
- a short `Needs Attention` section for failing or errored cases
- the per-phase Promptfoo report files for deeper inspection

If you want a stable local output directory instead of the default timestamped
one, set `PROMPT_EVAL_OUTPUT_DIR` explicitly before running the task.

To inspect a different state directory in the browser viewer:

```bash
PROMPTFOO_CONFIG_DIR="<state_dir>" ./node_modules/.bin/promptfoo view . -n
```

## CI Behavior

CI keeps the same high-level entrypoints:

- run one required prompt gate that validates cases and runs fast local tests when relevant files changed
- run deterministic smoke contract evals on trusted `main` pushes and manual dispatches from `main`
- run stochastic smoke canaries on same-repo PRs, trusted `main` pushes, and nightly/manual `main` runs
- run targeted hosted evals on trusted `main` pushes; on same-repo PRs, run
  targeted evals only for non-smoke suites detected from changed
  `evals/cases/**` files (skipped entirely when only smoke-suite or no eval
  case files changed)
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
validation. Nightly runs act as the drift-detection backstop for the broadest
available coverage, including the full hosted eval suite. If you want a browser UI, use `task eval:view` or `promptfoo view`
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
