#!/bin/bash
# Lokales Backup vor Code-Änderung; behält nur die 7 neuesten .bak*-Dateien im Repo.
# Usage: ./backup-file.sh <datei> <thema>
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
KEEP=7

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <file> <topic>" >&2
  exit 1
fi

SRC="$1"
THEMA="$2"

if [[ "$SRC" != /* ]]; then
  SRC="$REPO_ROOT/$SRC"
fi

if [[ ! -f "$SRC" ]]; then
  echo "File not found: $SRC" >&2
  exit 1
fi

DEST="${SRC}.bak.${THEMA}-$(date +%Y-%m-%d)"
cp -p "$SRC" "$DEST"
echo "Backup: $DEST"

while IFS= read -r -d '' OLD; do
  rm -f "$OLD"
  echo "Removed old backup: $OLD"
done < <(
  find "$REPO_ROOT" -type f -name '*.bak*' \
    ! -path '*/node_modules/*' \
    ! -path '*/.homeybuild/*' \
    ! -path '*/.git/*' \
    -printf '%T@ %p\0' 2>/dev/null \
    | sort -zrn \
    | tail -z -n +$((KEEP + 1)) \
    | cut -z -d' ' -f2-
)