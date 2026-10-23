#!/usr/bin/env bash
#
# Operator steps that must happen before (or with) a release, read from
# docs/operations/before-release.md: the `- ` lines under `## <target>`.
# `make release` prints them just before it asks to deploy.
#
#   scripts/before-release.sh web
#   scripts/before-release.sh server
#
# The server target also checks the restore drill (MUT-327): the newest
# `| Drill date (UTC) |` row under the pilot runbook's "Drill results" heading.
# None yet, or older than DRILL_MAX_AGE_DAYS, adds an item.
#
# A reminder, never a gate: it always exits 0, also when a file is missing.
# BEFORE_RELEASE_FILE, RESTORE_DRILL_RUNBOOK and BEFORE_RELEASE_TODAY
# (YYYY-MM-DD) override the files and today's date (tests).

set -uo pipefail

TARGET="${1:?usage: $0 web|server}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FILE="${BEFORE_RELEASE_FILE:-${ROOT}/docs/operations/before-release.md}"
RUNBOOK="${RESTORE_DRILL_RUNBOOK:-${ROOT}/docs/operations/pilot-runbook.md}"
TODAY="${BEFORE_RELEASE_TODAY:-$(date -u +%F)}"
DRILL_MAX_AGE_DAYS=60

C_BOLD=$'\033[1m'; C_DIM=$'\033[2m'; C_YELLOW=$'\033[1;33m'; C_NC=$'\033[0m'

# epoch_day YYYY-MM-DD: days since 1970-01-01 (GNU date, then BSD date).
epoch_day() {
  local seconds
  seconds=$(date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%Y-%m-%d %H:%M:%S' "$1 00:00:00" +%s 2>/dev/null) || return 1
  echo $(( seconds / 86400 ))
}

# The newest drill date recorded in the runbook's "Drill results" section, or nothing.
last_drill_date() {
  awk '
    /^## / { inside = ($0 ~ /^## [0-9.]+ Drill results$/); next }
    inside && /^\| *Drill date \(UTC\) *\|/ && match($0, /[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]/) {
      date = substr($0, RSTART, RLENGTH)
      if (date > newest) newest = date
    }
    END { if (newest != "") print newest }
  ' "$RUNBOOK"
}

drill_item() {
  [[ "$TARGET" == server && -f "$RUNBOOK" ]] || return 0
  local last today_day last_day age how="Run it per docs/operations/pilot-runbook.md §8 and add its block to §10 (Drill results)."
  last=$(last_drill_date)
  if [[ -z "$last" ]]; then
    echo "The restore drill has never been run against production (MUT-327). ${how}"
    return 0
  fi
  today_day=$(epoch_day "$TODAY") && last_day=$(epoch_day "$last") || return 0
  age=$(( today_day - last_day ))
  if (( age > DRILL_MAX_AGE_DAYS )); then
    echo "The last restore drill was on ${last} (${age} days ago; it's due every ${DRILL_MAX_AGE_DAYS} days). ${how}"
  fi
}

items=""
if [[ -f "$FILE" ]]; then
  items=$(awk -v want="## ${TARGET}" '
    /^## / { inside = ($0 == want); next }
    inside && /^- / { print substr($0, 3) }
  ' "$FILE")
fi

drill=$(drill_item)
if [[ -n "$drill" ]]; then
  items=$(printf '%s\n%s' "$items" "$drill" | sed '/^$/d')
fi

[[ -n "$items" ]] || exit 0

count=$(printf '%s\n' "$items" | wc -l | tr -d ' ')
printf '\n%s%sBefore you release: %s open operator step(s)%s\n' "$C_BOLD" "$C_YELLOW" "$count" "$C_NC"
while IFS= read -r item; do
  printf '  %s•%s %s\n' "$C_YELLOW" "$C_NC" "$item"
done <<<"$items"
printf '  %sFrom %s. Delete an item once it is done.%s\n' "$C_DIM" "${FILE#"${ROOT}/"}" "$C_NC"
if [[ -n "$drill" ]]; then
  printf '  %sThe restore drill item clears itself once §10 records a drill from the last %s days.%s\n' "$C_DIM" "$DRILL_MAX_AGE_DAYS" "$C_NC"
fi
exit 0
