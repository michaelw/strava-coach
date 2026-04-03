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

- re-runs diff-scoped `pre-commit` on the PR diff
- runs the full Hugo site build

`Prompt Eval Gate`:

- runs only when prompt-related files changed
- validates the full case tree
- runs the fast Node prompt test suite

Same-repo PRs:

- `Eval Smoke` runs as the required hosted prompt gate
- `Eval Targeted` may run as advisory hosted coverage

Fork or docs-only PRs:

- hosted prompt jobs skip or exit quickly without doing secret-backed work

### Push To `main`

`Lint And Validate`:

- full-repo `pre-commit`
- full Hugo site build

Prompt-related pushes also run:

- `Prompt Eval Gate`
- `Eval Smoke`
- `Eval Targeted`

### Nightly And Manual Hosted Runs

Nightly is the anti-drift backstop.

It is intended to run the broadest available validation stack, including:

- full prompt fast checks
- full hosted Promptfoo eval coverage
- longer-running and more expensive checks that are not appropriate for every PR

The current workflow skips a scheduled nightly when `main` has no new commit
since the last completed nightly. Trusted operators can still force the full
nightly path with:

```bash
gh workflow run prompt-eval.yml --ref main -f run_nightly_full=true
```

## What To Run Before Pushing

### Docs or content only

Usually nothing beyond local `pre-commit`.

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

Smoke hosted eval on `main`:

```bash
gh workflow run prompt-eval.yml --ref main
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

If you run `pre-commit run -a`, two prompt-validation hooks may both appear:

- `Validate changed case YAML files` routes changed filenames through `task eval:validate --`
- `Validate full case tree after validator/schema/fixture changes` is the
  global backstop that exists for validation-plumbing edits
