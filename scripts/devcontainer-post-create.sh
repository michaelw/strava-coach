#!/usr/bin/env bash

set -euo pipefail
set -x

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

sudo apt-get update
sudo apt-get install -y pipx

bundle config set path vendor/bundle
bundle install

pipx install pre-commit
pre-commit install
