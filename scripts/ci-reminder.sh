#!/usr/bin/env bash
#
# CI runs only when started by hand (workflow_dispatch), so a release reminds
# the operator to run it: the last run of the target's workflow on the release
# branch, which commit it checked, and the command to start a fresh one
# (`make ci <target>`).
#
#   scripts/ci-reminder.sh web      # Web CI
#   scripts/ci-reminder.sh server   # Server CI
#
# A reminder, never a gate: it always exits 0, also when gh is missing, not
# signed in, or offline (SKIP_REMOTE=1).

set -uo pipefail

TARGET="${1:?usage: $0 web|server}"
BRANCH="${RELEASE_BRANCH:-main}"

case "$TARGET" in
  web)    WORKFLOW=web-ci.yml;    NAME='Web CI' ;;
  server) WORKFLOW=server-ci.yml; NAME='Server CI' ;;
  *) printf 'unknown target "%s" — expected web or server\n' "$TARGET" >&2; exit 0 ;;
esac

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

printf '\n%sCI is manual%s — %s does not run on push.\n' "$C_BOLD" "$C_NC" "$NAME"

if [[ "${SKIP_REMOTE:-0}" == "1" ]] || ! command -v gh >/dev/null 2>&1; then
  printf '  %slast run not checked (offline or no gh)%s\n' "$C_DIM" "$C_NC"
else
  last=$(gh run list --workflow "$WORKFLOW" --branch "$BRANCH" --limit 1 \
    --json conclusion,status,headSha,url \
    --jq '.[0] | "\(.status)\t\(.conclusion)\t\(.headSha)\t\(.url)"' 2>/dev/null || true)
  if [[ -z "$last" ]]; then
    printf '  %sno run on %s yet%s\n' "$C_YELLOW" "$BRANCH" "$C_NC"
  else
    IFS=$'\t' read -r status conclusion sha url <<<"$last"
    behind=$(git rev-list --count "$sha..HEAD" 2>/dev/null || echo '?')
    case "$status/$conclusion" in
      completed/success) color=$C_GREEN; result=passed ;;
      completed/*)       color=$C_RED;   result="${conclusion:-failed}" ;;
      *)                 color=$C_YELLOW; result="$status" ;;
    esac
    printf '  last run  %s%s%s on %s' "$color" "$result" "$C_NC" "${sha:0:8}"
    if [[ "$behind" == "0" ]]; then printf ' (this commit)\n'; else printf ' (%s commit(s) behind HEAD)\n' "$behind"; fi
    printf '  %s%s%s\n' "$C_DIM" "$url" "$C_NC"
  fi
fi

printf '  run it    make ci %s  %s(gh workflow run %s --ref %s)%s\n' "$TARGET" "$C_DIM" "$WORKFLOW" "$BRANCH" "$C_NC"
exit 0
