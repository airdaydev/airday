#!/usr/bin/env bash
# Wipe the local dev sqlite database AND the local dev CLI profile dir.
#
# Safe by design:
#   - hardcoded targets under the gitignored `local/` dir
#   - refuses if any process has the db open (server still running)
#   - prompts unless --yes is passed
#
# Usage: bun run wipe [-y|--yes]

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db="$repo_root/local/airday.sqlite"
cli_dir="$repo_root/local/cli"
targets=("$db" "$db-wal" "$db-shm" "$cli_dir")

assume_yes=0
for arg in "$@"; do
  case "$arg" in
    -y|--yes) assume_yes=1 ;;
    -h|--help)
      echo "Usage: bun run wipe [-y|--yes]"
      echo "Deletes local/airday.sqlite{,-wal,-shm} and the local/cli/ CLI profile dir."
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      exit 2
      ;;
  esac
done

if [ -e "$db" ] && command -v lsof >/dev/null 2>&1; then
  if lsof -- "$db" >/dev/null 2>&1; then
    echo "Refusing to wipe: $db is open. Stop the server first." >&2
    exit 1
  fi
fi

existing=()
for t in "${targets[@]}"; do
  [ -e "$t" ] && existing+=("$t")
done

if [ ${#existing[@]} -eq 0 ]; then
  echo "Nothing to wipe — no db at $db."
  exit 0
fi

echo "Will delete:"
for t in "${existing[@]}"; do echo "  $t"; done

if [ "$assume_yes" -ne 1 ]; then
  printf "Proceed? [y/N] "
  read -r reply
  case "$reply" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

rm -rf -- "${existing[@]}"
echo "Wiped."
