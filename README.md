# Strava Coach

`Strava Coach` is an open-source repository for developing a public Custom GPT for Strava.

The goal is to keep every important GPT asset versioned in GitHub so prompt changes, action definitions, privacy policy edits, and knowledge-base updates are easy to review, discuss, and ship transparently.

## What Lives Here

- `system_prompt.md` is the source-of-truth prompt for the GPT
- `privacy_policy.md` is the privacy policy source, published through GitHub Pages
- `actions/` stores OpenAPI definitions for GPT Actions
- `data/` holds public knowledge files such as Markdown, CSV, PDF, or TXT
- `assets/` stores logos, diagrams, screenshots, and other public media
- `index.md` and `_config.yml` publish project docs to GitHub Pages
- `.github/workflows/` runs CI and Pages deployment

## Repository Structure

```text
.
├── .github/
│   └── workflows/
├── actions/
├── assets/
├── data/
├── .gitignore
├── .markdownlint.yaml
├── .pre-commit-config.yaml
├── _config.yml
├── index.md
├── privacy_policy.md
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

### Privacy Policy

Keep the source text in `privacy_policy.md`, then publish it via GitHub Pages so you have a stable public URL for GPT Actions.

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
- keep scopes and endpoints minimal
- separate experimental and production specs if needed

## Published OpenAPI Specs

When GitHub Pages is enabled, import GPT Action specs in ChatGPT using the published file URLs, not repository blob URLs.

Published-link pattern:

- `https://<github-username>.github.io/<repo-name>/actions/<spec-file-name>`

Current specs in this repository:

- `strava.openapi.yaml` -> `https://<github-username>.github.io/<repo-name>/actions/strava.openapi.yaml`

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

## Local Setup

```bash
git init
python3 -m pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Local Pages Preview

You can preview the GitHub Pages site locally inside a devcontainer.

1. Open the repository in a devcontainer.
2. Let the container run `scripts/devcontainer-post-create.sh` on first start. This installs the Ruby gems and `pre-commit`, then sets up the Git hook.
3. Start the Jekyll server:

```bash
bundle exec jekyll serve --host 0.0.0.0 --livereload
```

Then open the forwarded site at `http://127.0.0.1:4000/`.

The devcontainer forwards:

- `4000` for the Jekyll site
- `35729` for LiveReload

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
