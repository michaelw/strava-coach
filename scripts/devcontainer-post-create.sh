#!/usr/bin/env bash

set -euo pipefail
set -x

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

sudo apt-get update
sudo apt-get install -y ca-certificates curl pipx python3-venv

if ! command -v task >/dev/null 2>&1; then
  sudo sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
fi

if ! command -v hugo >/dev/null 2>&1; then
  HUGO_VERSION="0.157.0"
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in
    amd64) HUGO_ARCH="amd64" ;;
    arm64) HUGO_ARCH="arm64" ;;
    *)
      echo "Unsupported architecture for Hugo install: $ARCH" >&2
      exit 1
      ;;
  esac

  curl -fsSL -o /tmp/hugo.tar.gz "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_linux-${HUGO_ARCH}.tar.gz"
  sudo tar -C /usr/local/bin -xzf /tmp/hugo.tar.gz hugo
fi

if ! command -v pre-commit >/dev/null 2>&1; then
  pipx install pre-commit
fi

task --version
hugo version
task setup
