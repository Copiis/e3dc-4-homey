#!/bin/bash
# Senza-AI (Homey CLI): Build + lokales Install
# Primär (LAN): Homey Pro (Early 2023) → 192.168.188.62
# WLAN Backup-IP: 192.168.188.86
# Siehe PROJEKT-REGELN.md → "Netzwerk / IPs (LAN, von Senza-AI)"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
  nvm use
fi

if [[ -x ./scripts/prepare-machine.sh ]]; then
  ./scripts/prepare-machine.sh
fi

echo "=== Build ==="
npm run build

echo "=== Lokal installieren (Homey 2023, nicht Sputnik) ==="
homey select --id 65842b5c96f4880701e8c663
homey app install

echo "✅ Lokales Homey-Update fertig."