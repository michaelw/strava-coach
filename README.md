# Strava Coach

`Strava Coach` is an open-source repository for developing a public Custom GPT for Strava.

The repo keeps the GPT's prompt, action schemas, public docs, and knowledge assets versioned in GitHub so changes stay reviewable and easy to ship.

## What To Edit

- [`system_prompt.md`](./system_prompt.md) is the source-of-truth prompt
- [`actions/`](./actions/) stores GPT Action OpenAPI schemas
- [`content/`](./content/) contains the published docs and policy pages
- [`data/`](./data/) holds public knowledge files used by the project

## Getting Started

The recommended setup path is the included devcontainer.

If you are working on your local host instead, install the documented prerequisites and run:

```bash
task setup
```

That setup flow installs dependencies from the committed lockfile so a clean
checkout does not pick up incidental `package-lock.json` churn.

Useful first commands:

```bash
task check
task site:serve
```

Use `task` as the canonical human-facing interface for repo operations.

## Documentation

- Setup and daily development commands: [`DEVELOPMENT.md`](./DEVELOPMENT.md)
- ChatGPT and Strava OAuth configuration: [`content/setup/chatgpt.md`](./content/setup/chatgpt.md)
- CI behavior and pre-push guidance: [`docs/CI.md`](./docs/CI.md)
- Prompt eval workflows: [`docs/prompt-evals.md`](./docs/prompt-evals.md)

If this repository is published with GitHub Pages, the Strava action spec is available from the published docs site at:

- `https://<github-username>.github.io/<repo-name>/actions/strava.openapi.yaml`

## Collaboration

- Use GitHub Issues to discuss prompt behavior, product scope, and integrations
- Use Pull Requests for prompt, policy, docs, and action-schema changes
- Keep edits readable, reviewable, and free of secrets or personal data

## License

This repository is licensed under the Apache License 2.0. See [`LICENSE`](./LICENSE).
