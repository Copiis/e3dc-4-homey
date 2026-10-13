#!/bin/bash
# Nach Code-Änderung: lokal installieren, Git push, Athom-Build hochladen.
# Test-Freigabe im Developer Portal bleibt manuell beim User.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use
fi

echo "=== Build ==="
homey app build

echo "=== Lokal installieren (Homey 2023, nicht Sputnik) ==="
homey select --id 65842b5c96f4880701e8c663
homey app install

if [[ -n "$(git status --porcelain)" ]]; then
  echo "=== Git: uncommittete Änderungen — bitte zuerst committen ==="
  git status -sb
  exit 1
fi

echo "=== Git push ==="
git push origin master

echo "=== Athom validate + publish ==="
homey app validate --level publish
printf 'n\n' | homey app publish

echo ""
echo "✅ Fertig. Test-Version im Developer Portal manuell freigeben."