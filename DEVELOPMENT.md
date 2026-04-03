# Development Guide

This file is the concrete setup and validation companion to
[`AGENTS.md`](./AGENTS.md).

## Recommended Environment

The smoothest path is the included devcontainer. It installs the repo's tool
chain and wires up the docs preview environment automatically.

Hosted Promptfoo evals also require:

- `OPENAI_API_KEY`

## First-Time Setup

### Devcontainer

Open the repo in the devcontainer and let the post-create step finish. It runs
[`scripts/devcontainer-post-create.sh`](./scripts/devcontainer-post-create.sh),
which installs Task, Hugo, `pre-commit`, `ripgrep`, and repo dependencies.

### Local Host

Install the prerequisites, then run:

```bash
task setup
```

`task setup`:

- verifies `rg`
- warns if Hugo is missing
- installs Node dependencies
- installs the local `pre-commit` hook when possible

## Daily Commands

List available tasks:

```bash
task
```

Fast non-hosted prompt-domain checks:

```bash
task check
```

Run pre-commit on all tracked files:

```bash
task lint:all
```

Build the production-like Hugo site:

```bash
task site:build
```

Run the full non-hosted validation suite:

```bash
task verify
```

Start the local docs preview:

```bash
task serve
```

To change the preview port:

```bash
HUGO_PORT=4000 task serve
```

## What To Run For Common Changes

### Docs Or Content Only

Usually the local hook checks are enough.

If you changed layouts, Hugo config, shortcodes, or publishing behavior, also
run:

```bash
task site:build
```

### `system_prompt.md`, eval harness, or prompt behavior changes

Run:

```bash
task check
```

### Eval case YAML changes

Run:

```bash
task check
```

The `pre-commit` hook validates changed case files, but `task check` gives you
the same prompt-domain backstop CI uses.

### Workflow, Taskfile, schema, fixture, or validation-plumbing changes

Run:

```bash
task verify
```

## Promptfoo Workflows

Validate case files:

```bash
task eval:validate
```

Run the hosted smoke suite:

```bash
task eval:smoke
```

Run targeted self-grading evals:

```bash
task eval:self -- --filter-metadata suite=grounding
```

Run compare evals:

```bash
task eval:compare
```

Run the full hosted suite:

```bash
task eval:full
```

Open the local Promptfoo viewer:

```bash
task eval:view -- -n
```

Important notes:

- Hosted eval tasks require `OPENAI_API_KEY`.
- Local artifact output defaults under [`evals/reports/`](./evals/reports/).
- Promptfoo state under [`.promptfoo/`](./.promptfoo/) is local working state
  and should not be committed.

## Capture Workflows

Use the existing Taskfile wrappers instead of invoking capture scripts by hand:

```bash
task capture:strava:auth-url
task capture:strava:exchange-code -- --code <code>
task capture:strava:capture -- --label <label> --activity-id <id>
task capture:gpt -- --scenario <scenario>
task capture:promote -- --kind <kind> --source <raw.json> --id <fixture-id>
```

Rules for capture work:

- keep raw captures local
- check in only sanitized promoted fixtures
- never commit secrets, OAuth tokens, or personal activity data

## CI Mental Model

The repo uses layered validation:

1. local `pre-commit` for fast changed-file feedback
2. PR CI for authoritative non-hosted validation
3. trusted hosted Promptfoo runs for prompt behavior
4. scheduled/manual hosted runs for broader coverage

Useful references:

- [`docs/CI.md`](./docs/CI.md)
- [`docs/prompt-evals.md`](./docs/prompt-evals.md)
- [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)
- [`.github/workflows/prompt-eval.yml`](./.github/workflows/prompt-eval.yml)

## Repo-Specific Gotchas

- If a PR addresses a GitHub issue, include the issue reference in the relevant
  commit message too, for example `#42` or `Fixes #42`.
- If the PR branch name explicitly carries an issue token such as
  `implement-github-issue-42`, CI will require the PR title or body and every
  non-merge commit in that PR to reference `#42`.
- Reserve closing keywords like `Fixes #42` for commits and PRs that will fully
  resolve the issue when merged. Use a non-closing reference when the work is
  partial.
- Edit [`system_prompt.md`](./system_prompt.md), not the published wrapper page
  in [`content/system-prompt.md`](./content/system-prompt.md).
- Use `task` commands in docs, reviews, and agent responses unless you are
  deliberately changing the plumbing.
- Avoid incidental `package-lock.json` churn; lockfile changes affect prompt-eval
  CI routing.
- Treat [`public/`](./public/) and [`resources/`](./resources/) as generated.
- Keep docs updated when workflow behavior changes so future contributors do not
  have to rediscover the same rules.
