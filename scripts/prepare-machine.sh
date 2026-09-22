#!/usr/bin/env bash
# Dual-Machine: node_modules / .homeybuild bleiben lokal (Syncthing-Root .stignore).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use 2>/dev/null || true
fi

if [[ -f package.json && ! -d node_modules ]]; then
  echo "prepare-machine: node_modules fehlt → npm install"
  npm install
fi

echo "${HOME:-}" > "$ROOT/.machine-host"
echo "prepare-machine: OK ($ROOT)"
