# Strava Coach Repo Instructions

This file adds repo-specific guidance on top of the shared workspace rules.
Use [`DEVELOPMENT.md`](./DEVELOPMENT.md) for setup and command recipes.

## Purpose

This repository is the codebase for a public `Strava Coach` Custom GPT.
Most changes are prompt, eval, workflow, or publishing changes rather than app
runtime code.

## Canonical Interfaces

- Use `task` as the human-facing interface for repo operations.
- Prefer `task check`, `task site:build`, `task verify`, and the `task eval:*`
  commands over raw `node`, `promptfoo`, `pre-commit`, or ad hoc shell
  pipelines.
- Treat raw scripts under `evals/` and `scripts/` as implementation details
  unless you are intentionally modifying the plumbing.

## Source Of Truth

- Edit [`system_prompt.md`](./system_prompt.md) for GPT instruction changes.
- Keep public docs and policy pages under [`content/`](./content/).
- Keep action schemas in [`actions/`](./actions/).
- Keep prompt-eval cases and harness code under [`evals/`](./evals/).

## Files And Directories To Treat Carefully

- Do not commit secrets, OAuth credentials, personal data, or raw captured user
  data.
- Treat [`evals/reports/`](./evals/reports/), [`public/`](./public/),
  [`resources/`](./resources/), [`.promptfoo/`](./.promptfoo/),
  [`node_modules/`](./node_modules/), and [`.playwright/`](./.playwright/) as
  generated local state unless the task explicitly requires them.
- Avoid editing [`themes/hugo-geekdoc/`](./themes/hugo-geekdoc/) unless the work
  is intentionally about the vendored theme.
- Do not change [`package.json`](./package.json) or
  [`package-lock.json`](./package-lock.json) unless the dependency/tooling change
  is intentional. Those files are part of prompt-eval change detection in CI.

## Validation Expectations

- Docs/content-only edits usually need local `pre-commit` or `task check` only
  when prompt-eval files are involved.
- Prompt, eval-case, Taskfile, workflow, schema, or fixture-plumbing edits
  should use the matching `task` command from [`DEVELOPMENT.md`](./DEVELOPMENT.md)
  before handoff.
- Do not run hosted Promptfoo tasks without `OPENAI_API_KEY`.
- Keep non-hosted validation green before asking CI to exercise hosted evals.

## Prompt And Eval Conventions

- Keep prompt edits small, reviewable, and easy to diff.
- Preserve stable `metadata.id` values in eval cases unless a rename is
  deliberate and reflected everywhere it matters.
- Use self-grading cases for hard requirements and compare cases only for
  baseline-vs-candidate judgments.
- When changing validation or fixture plumbing, assume whole-tree validation is
  required, not just changed-file checks.

## Capture And Fixture Safety

- Raw capture commands are for local collection only.
- Only checked-in, sanitized fixtures belong under the tracked eval fixture
  paths.
- Prefer promoting captures through the existing `task capture:*` flow rather
  than inventing one-off scripts or hand-editing raw transcripts.

## Change Hygiene

- When asked to implement a GitHub issue, start by linking the issue and
  printing its title before beginning the implementation work.
- Unless the user explicitly asks otherwise, base GitHub issue implementation
  work on the latest upstream default branch before making changes.
- When implementation work on a GitHub issue begins, set the issue assignee to
  the person doing the work.
- If a PR addresses one or more GitHub issues, mention the affected issue numbers
  in the relevant commit messages as well as in the PR context.
- When a branch name encodes an issue number, make sure the PR context or commit
  messages reference that issue.
- Use a plain reference like `#42` by default when the work is part of the
  issue but does not fully resolve it.
- Make an explicit call about whether the merged change fully resolves the
  issue. When it does, the agent may add a closing keyword such as `Fixes #42`
  in the PR body and/or a relevant commit message.
- Only use closing keywords when the merged change fully resolves the issue. If
  the issue is only partially addressed, reference it without auto-closing it.
- Keep docs synchronized with workflow changes. If CI behavior or eval policy
  changes, update [`docs/CI.md`](./docs/CI.md) or
  [`docs/prompt-evals.md`](./docs/prompt-evals.md) in the same change when
  needed.
- Preserve the docs-first tone of the repository: readable Markdown, explicit
  instructions, and minimal hidden behavior.
