#!/usr/bin/env bash
#
# Yes/no gate for the irreversible step of a release.
#
#   scripts/confirm.sh "Push and deploy?"   # exit 0 = yes, 1 = no
#   AUTO=1 scripts/confirm.sh "…"           # yes, without asking
#
# Defaults to no, and fails closed when there is no terminal to ask: a release
# should never proceed because a prompt could not be shown.

set -euo pipefail

QUESTION="${1:?usage: $0 "<question>"}"

C_BOLD=$'\033[1m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

if [[ "${AUTO:-0}" == "1" ]]; then
  printf '%s%s%s %syes (AUTO=1)%s\n' "$C_BOLD" "$QUESTION" "$C_NC" "$C_YELLOW" "$C_NC" >&2
  exit 0
fi

if ! { exec 3</dev/tty; } 2>/dev/null; then
  printf '%sCannot ask "%s" — no terminal. Re-run with AUTO=1 to confirm non-interactively.%s\n' \
    "$C_RED" "$QUESTION" "$C_NC" >&2
  exit 1
fi

printf '\n%s%s [y/N] %s' "$C_BOLD" "$QUESTION" "$C_NC" >&2
IFS= read -r answer <&3 || answer=""
case "${answer%$'\r'}" in
  y|Y|yes|YES|Yes) exit 0 ;;
  *) printf '%sCancelled.%s\n' "$C_YELLOW" "$C_NC" >&2; exit 1 ;;
esac
