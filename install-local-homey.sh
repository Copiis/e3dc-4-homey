#!/bin/bash
# Arctic (Homey CLI): Build + lokales Install
# Primär: Homey Pro (Early 2023) → 192.168.188.86
# Hinweis: 192.168.188.62 könnte derselbe Homey 2023 über LAN-Verbindung sein
# Siehe PROJEKT-REGELN.md → "Netzwerk / IPs (Arctic)"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use
fi

echo "=== Build ==="
npm run build

echo "=== Lokal installieren (Homey 2023 @ 192.168.188.86, ggf. .62 via LAN) ==="
homey app install

echo "✅ Lokales Homey-Update fertig."