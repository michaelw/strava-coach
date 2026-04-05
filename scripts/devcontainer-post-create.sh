#!/usr/bin/env bash

set -euo pipefail
set -x

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$REPO_ROOT"

OS="$(uname -s)"

case "$OS" in
  Linux)
    sudo apt-get update
    sudo apt-get install -y ca-certificates curl pipx python3-venv ripgrep
    ;;
  Darwin)
    if ! command -v brew >/dev/null 2>&1; then
      echo "Homebrew is required on macOS. Install it from https://brew.sh" >&2
      exit 1
    fi
    brew install pipx ripgrep
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

if ! command -v task >/dev/null 2>&1; then
  sudo sh -c "$(curl --location https://taskfile.dev/install.sh)" -- -d -b /usr/local/bin
fi

if ! command -v hugo >/dev/null 2>&1; then
  # renovate: datasource=github-releases depName=gohugoio/hugo extractVersion=^v(?<version>.+)$
  HUGO_VERSION="0.157.0"
  ARCH_RAW="$(uname -m)"
  case "$ARCH_RAW" in
    x86_64)        HUGO_ARCH="amd64" ;;
    aarch64|arm64) HUGO_ARCH="arm64" ;;
    *)
      echo "Unsupported architecture for Hugo install: $ARCH_RAW" >&2
      exit 1
      ;;
  esac
  case "$OS" in
    Linux)  HUGO_OS="linux" ;;
    Darwin) HUGO_OS="darwin" ;;
    *)
      echo "Unsupported OS for Hugo install: $OS" >&2
      exit 1
      ;;
  esac

  curl -fsSL -o /tmp/hugo.tar.gz "https://github.com/gohugoio/hugo/releases/download/v${HUGO_VERSION}/hugo_extended_${HUGO_VERSION}_${HUGO_OS}-${HUGO_ARCH}.tar.gz"
  sudo tar -C /usr/local/bin -xzf /tmp/hugo.tar.gz hugo
fi

if ! command -v pre-commit >/dev/null 2>&1; then
  pipx install pre-commit
fi

task --version
hugo version
rg --version
task setup
