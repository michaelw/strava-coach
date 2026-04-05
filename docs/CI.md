# CI Cheatsheet

This repo uses a layered validation model:

1. local `pre-commit` for fast changed-file feedback
2. PR CI for authoritative diff-scoped validation
3. trusted hosted evals for prompt behavior
4. nightly runs for full drift detection

Local hooks are convenience only. PR CI re-runs the cheap checks because local
hooks can be skipped with `--no-verify`.

Use `task` as the canonical interface for repo operations. `pre-commit` hooks
and raw `node` scripts are implementation details.
Local Task runs are quiet by default; GitHub Actions overrides that with
`TASK_SILENT=0` so CI logs keep Task command traces.

## What Runs Automatically

### Local git `pre-commit`

Runs only on staged files.

Typical checks:

- Markdown, YAML, JSON, and workflow syntax/hygiene
- Renovate config validation when [`renovate.json5`](../renovate.json5) changes
- changed case YAML validation for `evals/cases/**/*.yaml`
- full-tree case validation when validator/schema/fixture plumbing changes

Does not run:

- Hugo site build
- Node prompt test suite
- hosted Promptfoo evals

### Pull Request

`Lint And Validate`:

- also reruns when a PR title or body is edited so PR issue-reference checks
  see current metadata
- validates PR issue references when the branch name carries an issue token such
  as `issue-26`
- re-runs diff-scoped `pre-commit` on the PR diff
- validates [`renovate.json5`](../renovate.json5) with the pre-commit Renovate schema hook
- runs the full Hugo site build

`Prompt Eval Gate`:

- runs only when prompt-related files changed
- validates the full case tree
- runs the fast Node prompt test suite

Same-repo PRs:

- `Eval Smoke Contract` runs as the required hosted prompt gate
- `Eval Smoke Canary` runs the same risky smoke cases with repeated stochastic
  sampling and is advisory on PRs
- `Eval Targeted` runs only when changed `evals/cases/**` files include
  non-smoke suites; it never re-runs `smoke` on a PR because `Eval Smoke Contract`
  already owns that gate
- PRs with no changed non-smoke eval case files skip `Eval Targeted` entirely
- prompt-eval jobs surface the final outcome and failing case ids directly in
  the eval step output and GitHub step summary
- Renovate app PRs, including baseline pin bumps, follow this same path

Fork or docs-only PRs:

- hosted prompt jobs skip or exit quickly without doing secret-backed work
- PR title/body-only edits do not trigger hosted prompt-eval workflows

### Push To `main`

`Lint And Validate`:

- full-repo `pre-commit`
- Renovate config validation via the pre-commit schema hook
- full Hugo site build

Prompt-related pushes also run:

- `Prompt Eval Gate`
- `Eval Smoke Contract`
- `Eval Smoke Canary`
- `Eval Targeted`

## Case Coverage By Gate

The table below summarizes which eval cases each automatic gate actually runs.
This is intentionally case-centric so contributors do not need to mentally
expand Task aliases and workflow routing from memory.

| Gate | What cases run |
| --- | --- |
| `pre-commit` changed cases | Only the staged `evals/cases/**/*.yaml` files passed to `task eval:validate --`. This validates schema, metadata, and fixture references for those files, but does not run hosted Promptfoo evals. |
| `pre-commit` full tree | All case YAML files under `evals/cases/` when validator, schema, or fixture plumbing changes trigger the backstop hook. This is validation only, not hosted eval execution. |
| `Lint And Validate` | No hosted eval cases. Runs `pre-commit` plus the Hugo site build. |
| `Prompt Eval Gate` | No hosted Promptfoo eval cases. Runs `task check`, which validates the full case tree and runs the fast local Node test suite. |
| `Smoke Contract` | The full self-grading `smoke` suite: `smoke-001` through `smoke-005`, once each. |
| `Smoke Canary` | The same `smoke` suite, repeated with stochastic sampling. With the current default `canary.repeat=5`, each smoke case is sampled 5 times. |
| `Targeted (same-repo PR)` | The full non-`smoke` suite or suites inferred from changed `evals/cases/**` paths. For example, if only `evals/cases/self/grounding/grounding-001.yaml` changes, this job still runs `grounding-001` through `grounding-005`. If the detected suite also has `evals/cases/compare/<suite>/`, the matching compare cases run too. Current compare coverage exists only for `personalization`, where `personalization-001` runs 5 times and `personalization-003` runs 3 times because compare cases expand by their top-level `repeat`. |
| `Targeted` on `main` | The same suite-detection logic as PRs, but `smoke` is always included. If prompt-related files changed but no case files changed, this job falls back to running only the `smoke` suite. |
| `Nightly Full` | All self suites plus all compare suites. Today that means `format`, `grounding`, `personalization`, `safety`, and `smoke`, plus compare `personalization`. |

Notes:

- `Eval Targeted` deduplicates suite names before running them, so changing two
  files in `evals/cases/self/grounding/` still produces one `grounding` suite
  run rather than two separate runs.
- Compare cases may execute more than once in a single run because the compare
  config expands each case by its top-level `repeat`.
- Standard hosted lanes may also rerun failing cases when retry policy is
  triggered by infrastructure errors or flaky-tagged assertion failures.

### Baseline Release Promotion

Publishing `prompt-baseline-v<semver>` does not change the compare baseline pin
directly. Instead:

- `baseline-prompt-release.yml` publishes the immutable release artifact
- Renovate detects that release and opens a PR updating
  [`evals/config.yaml`](../evals/config.yaml)
- the generated PR reuses the normal PR validation flow before the new baseline
  becomes the default compare target

This repository is intended to use the hosted Renovate GitHub App with
[`renovate.json5`](../renovate.json5), not a self-hosted Renovate Actions
workflow.

Renovate tracks the following pins and opens update PRs when new releases are
published:

- **Hugo** (`HUGO_VERSION`) — in `scripts/devcontainer-post-create.sh` and
  `.github/workflows/ci.yml` via the `pinned tool versions` custom regex manager.
- **Task** (`TASK_VERSION`) — in `scripts/devcontainer-post-create.sh` via the
  `pinned tool versions` custom regex manager; the `go-task/setup-task` action
  pin in `.github/workflows/ci.yml` is also tracked via the standard
  `github-actions` manager.
- **Prompt baseline** — `evals/config.yaml` via the `prompt baseline release`
  custom regex manager.

Each Renovate PR follows the normal PR validation flow before the pin change
is merged.

### Nightly And Manual Hosted Runs

Nightly is the anti-drift backstop.

It is intended to run the broadest available validation stack, including:

- full prompt fast checks
- full hosted Promptfoo eval coverage
- repeated stochastic smoke canaries with a stronger post-merge signal than PRs
- longer-running and more expensive checks that are not appropriate for every PR
- the same high-signal prompt-eval outcome summary used in PR jobs

The current workflow skips a scheduled nightly when `main` has no new commit
since the last completed nightly. Trusted operators can still force the full
nightly path with:

```bash
gh workflow run prompt-eval.yml --ref main -f run_nightly_full=true
```

## What To Run Before Pushing

### Docs or content only

Usually nothing beyond local `pre-commit`.

If the branch name includes an issue token such as `issue-42`, make sure the PR
title, PR body, or commit messages reference that issue.

If you touched layouts, Hugo config, or rendering behavior, also run:

```bash
task site:build
```

### Prompt-eval case YAML changes

Run:

```bash
task check
```

This complements the changed-file `pre-commit` hook with the whole-tree prompt
backstop that PR CI will also run.

### `system_prompt.md` or prompt harness changes

Run:

```bash
task check
```

### Workflow, schema, fixture, or validation plumbing changes

Run:

```bash
task verify
```

This gives you:

- full-repo `pre-commit`
- prompt fast checks
- full Hugo build

### QA or manual hosted verification

Smoke contract hosted eval on `main`:

```bash
gh workflow run prompt-eval.yml --ref main
```

Smoke canary hosted eval locally with your current workspace prompt:

```bash
task eval:smoke:canary
```

Full nightly hosted path on `main`:

```bash
gh workflow run prompt-eval.yml --ref main -f run_nightly_full=true
```

## Why Some Checks Run Twice

The same cheap checks may run both locally and again in PR CI.

That is intentional:

- local hooks give fast feedback before you push
- PR CI is the authoritative enforcement layer because local hooks can be bypassed

The nightly run exists for a different reason: it guards against drift from
unchanged files, external model behavior, and expensive coverage that does not
belong on every PR.

The smoke canary exists for a different reason than the smoke contract gate:
it samples realistic stochastic behavior repeatedly and reports failure rate,
while the contract gate stays deterministic and blocks on hard requirements.

If you run `pre-commit run -a`, two prompt-validation hooks may both appear:

- `Validate changed case YAML files` routes changed filenames through `task eval:validate --`
- `Validate full case tree after validator/schema/fixture changes` is the
  global backstop that exists for validation-plumbing edits

If [`renovate.json5`](../renovate.json5) is staged, `Validate Renovate config`
runs `task renovate:validate` so schema and parser errors fail before push.

## Issue Reference Guardrail

When a PR branch name explicitly carries an issue number, for example
`codex/implement-github-issue-26`, CI expects:

- the PR title, PR body, or commit messages in that PR to reference `#26`

The guardrail accepts either a plain issue reference such as `#26` or a full
issue URL. Prefer a plain reference by default. If the merged change fully
resolves the issue, make that call explicitly and use a closing keyword such as
`Fixes #26` in the PR body and/or a relevant commit message.
