#!/usr/bin/env bash
#
# Operator steps that must happen before (or with) a release, read from
# docs/operations/before-release.md: the `- ` lines under `## <target>`.
# `make release` prints them just before it asks to deploy.
#
#   scripts/before-release.sh web
#   scripts/before-release.sh server
#
# A reminder, never a gate: it always exits 0, also when the file is missing.
# BEFORE_RELEASE_FILE overrides the file (tests).

set -uo pipefail

TARGET="${1:?usage: $0 web|server}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${BEFORE_RELEASE_FILE:-${ROOT}/docs/operations/before-release.md}"

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_YELLOW=$'\033[1;33m'; C_NC=$'\033[0m'

[[ -f "$FILE" ]] || exit 0

items=$(awk -v want="## ${TARGET}" '
  /^## / { inside = ($0 == want); next }
  inside && /^- / { print substr($0, 3) }
' "$FILE")

[[ -n "$items" ]] || exit 0

count=$(printf '%s\n' "$items" | wc -l | tr -d ' ')
printf '\n%s%sBefore you release: %s open operator step(s)%s\n' "$C_BOLD" "$C_YELLOW" "$count" "$C_NC"
while IFS= read -r item; do
  printf '  %s•%s %s\n' "$C_YELLOW" "$C_NC" "$item"
done <<<"$items"
printf '  %sFrom %s. Delete an item once it is done.%s\n' "$C_DIM" "${FILE#"${ROOT}/"}" "$C_NC"
exit 0
