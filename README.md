# Strava Coach

`Strava Coach` is an open-source repository for developing a public Custom GPT for Strava.

The goal is to keep every important GPT asset versioned in GitHub so prompt changes, action definitions, privacy policy edits, and knowledge-base updates are easy to review, discuss, and ship transparently.

## What Lives Here

- `system_prompt.md` is the source-of-truth prompt for the GPT
- `content/privacy-policy.md` is the privacy policy page source
- `content/setup/chatgpt.md` is the ChatGPT and Strava OAuth setup guide
- `docs/prompt-evals.md` documents the Promptfoo workflow
- `actions/` stores OpenAPI definitions for GPT Actions
- `data/` holds public knowledge files such as Markdown, CSV, PDF, or TXT
- `assets/` stores logos, diagrams, screenshots, and other public media
- `hugo.yaml`, `content/`, `layouts/`, and `themes/hugo-geekdoc/` publish project docs to GitHub Pages
- `.github/workflows/` runs CI and Pages deployment

## Repository Structure

```text
.
├── .github/
│   └── workflows/
├── actions/
├── assets/
├── content/
├── data/
├── evals/
├── layouts/
├── themes/
├── .gitignore
├── .markdownlint.yaml
├── .pre-commit-config.yaml
├── hugo.yaml
├── README.md
└── system_prompt.md
```

## Open Development Workflow

This project is designed to be built in public.

- Use GitHub Issues to discuss prompt behavior, product scope, and API integrations
- Use Pull Requests for changes to instructions, knowledge files, and policy text
- Keep prompts and action definitions readable and diff-friendly
- Never commit API keys, OAuth client secrets, or personal data
- Review knowledge files before publishing them in the GPT

## Custom GPT Asset Strategy

### Prompt and Instructions

Keep the main behavior and policy in `system_prompt.md`. Treat prompt updates like code changes:

- explain the intent in pull requests
- keep edits specific and reviewable
- document major behavioral changes in commit history

The published copy-ready page lives at:

- `https://<github-username>.github.io/<repo-name>/system-prompt/`

### Privacy Policy

Keep the published source text in `content/privacy-policy.md`, then publish it via GitHub Pages so you have a stable public URL for GPT Actions.

Typical public URLs look like:

- `https://<github-username>.github.io/<repo-name>/privacy-policy/`

### Knowledge Files

Put GPT knowledge assets in `data/`.

Examples:

- `data/training-principles.md`
- `data/strava-glossary.csv`
- `data/coaching-faq.md`
- `data/reference-manual.pdf`

### Actions and APIs

Put OpenAPI definitions in `actions/` so contributors can inspect how the GPT talks to external services.

Best practices:

- prefer YAML for readability
- document authentication without committing secrets
- keep scopes narrow and endpoints minimal
- separate experimental and production specs if needed

## Published OpenAPI Specs

When GitHub Pages is enabled, import GPT Action specs in ChatGPT using the published file URLs, not repository blob URLs.

Published-link pattern:

- `https://<github-username>.github.io/<repo-name>/actions/<spec-file-name>`

Current specs in this repository:

- `strava.openapi.yaml` -> `https://<github-username>.github.io/<repo-name>/actions/strava.openapi.yaml`

## ChatGPT And Strava OAuth Setup

The detailed setup guide for the ChatGPT configuration lives in [`content/setup/chatgpt.md`](./content/setup/chatgpt.md) and is published on the docs site at:

- `https://<github-username>.github.io/<repo-name>/setup/chatgpt/`

That page documents:

- creating the Strava app and saving the client ID and secret
- using `chat.openai.com` as the authorization callback URL
- creating the GPT Strava action
- selecting `OAuth` authentication
- setting the Strava authorization and token URLs
- using the scope `read,read_all,activity:read,profile:read_all`
- keeping the token exchange method as `Default (POST request)`

## CI/CD and Quality Checks

This repo is set up with standard lightweight automation for documentation-heavy GPT assets:

- `pre-commit` for local checks before commits
- GitHub Actions CI on pushes and pull requests
- GitHub Pages deployment on `main`

The checks cover:

- Markdown formatting and linting
- YAML and JSON syntax validation
- merge-conflict markers and whitespace issues
- basic repository hygiene for docs-first projects
- Promptfoo-native prompt eval validation and gating for `system_prompt.md`

Use the Taskfile as the stable entrypoint for local validation:

- `task check` runs the fast non-hosted checks
- `task site:build` validates the production Hugo build
- `task verify` runs the full non-hosted validation suite

Prompt regression tooling for `system_prompt.md` is documented in
[`docs/prompt-evals.md`](./docs/prompt-evals.md). That guide covers the
Promptfoo-native case format, the native `promptfoo eval/view` workflow,
smoke and full eval commands, Promptfoo-first reporting, the
production-shaped fixture capture pipeline, and the security model for trusted
vs forked pull requests.

## Local Pages Preview

You can preview the GitHub Pages site locally inside a devcontainer.

1. Open the repository in a devcontainer.
2. Let the container run `scripts/devcontainer-post-create.sh` on first start. This installs Hugo, Task, the repo dependencies, and the `pre-commit` hook.
3. Start the Hugo server:

```bash
task serve
```

Optional: this repository includes a VS Code task named `Hugo Serve` in `.vscode/tasks.json` that can auto-start on folder open if automatic tasks are allowed.

Then open the forwarded site at `http://127.0.0.1:1313/`.

The preview server defaults to Hugo's standard port `1313`. To use a different local port, set `HUGO_PORT` in your shell or in `.env`, for example:

```bash
HUGO_PORT=4000 task serve
```

The devcontainer forwards:

- `1313` for the Hugo site by default

## Local Setup

Install Task, Hugo, and `pre-commit`, then use the repo Taskfile as the stable command interface.

Prompt evals, fixture capture, and repo checks can run without Hugo. Site preview and production builds require it.

For example, on macOS:

```bash
brew install go-task/tap/go-task
brew install hugo
pipx install pre-commit
task setup
task verify
```

If you want the fast non-hosted checks without the Hugo production build, run:

```bash
task check
```

If you only need prompt-eval workflows after setup:

```bash
task eval:smoke
task eval:self -- --filter-metadata suite=grounding
task eval:view -- -n
```

## Publishing with GitHub Pages

1. Push this repository to GitHub.
2. Ensure the default branch is `main`.
3. Enable GitHub Pages or keep the included Pages workflow enabled.
4. After deployment, use the public `/privacy-policy/` URL in your Custom GPT Action settings.

## Collaboration

- Open issues for prompt revisions, UX ideas, and API design changes
- Use pull requests to propose edits to prompts, policies, and knowledge files
- Keep rationale close to the change so future contributors understand why it exists

## Security Notes

- Do not store secrets in this repository
- Do not include user exports, private athlete data, or personal tokens in `data/`
- Keep Action definitions public, but provide credentials through secure runtime configuration outside GitHub

## License

This repository is licensed under the Apache License 2.0. See [LICENSE](./LICENSE).
