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
- changed case YAML validation for `evals/cases/**/*.yaml`
- full-tree case validation when validator/schema/fixture plumbing changes

Does not run:

- Hugo site build
- Node prompt test suite
- hosted Promptfoo evals

### Pull Request

`Lint And Validate`:

- validates PR issue references when the branch name carries an issue token such
  as `issue-26`
- re-runs diff-scoped `pre-commit` on the PR diff
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

### Push To `main`

`Lint And Validate`:

- full-repo `pre-commit`
- full Hugo site build

Prompt-related pushes also run:

- `Prompt Eval Gate`
- `Eval Smoke Contract`
- `Eval Smoke Canary`
- `Eval Targeted`

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
title, PR body, or commit messages reference that issue. Use `Fixes #42` only
when the PR truly resolves the issue on merge, and prefer putting that closing
intent in the PR body so the PR creator makes that call explicitly.

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

## Issue Reference Guardrail

When a PR branch name explicitly carries an issue number, for example
`codex/implement-github-issue-26`, CI expects:

- the PR title, PR body, or commit messages in that PR to reference `#26`

The guardrail accepts either a plain issue reference such as `#26` or a full
issue URL. Prefer a plain reference unless the PR or commit should actually
close the issue on merge.

If the PR really should close the issue, the PR creator should add a closing
keyword such as `Fixes #26` in the PR body. That choice is intentionally manual
so branch naming and commit tooling do not accidentally close issues.
