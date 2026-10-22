#!/usr/bin/env bash
# Mutaba3a API — rows in a currency the API no longer supports (MUT-388).
#
# MUT-280 let the hosted API store AED, SAR, QAR, BHD and OMR; MUT-388 (ADR-166)
# took them out again. Nothing in the database refuses those codes (every
# currency column is VarChar(3)): such a row still reads back (money.ts keeps
# their decimals for display), but it can't take a new amount and the app no
# longer offers its currency. This is the release gate: run it before and after
# the server release that drops a currency.
#
#   count                 list every live row whose currency is not one of
#                         SUPPORTED_CURRENCIES, with its profile (or user, for
#                         the Unsorted inbox); exits 3 when there are any
#   delete-test-profiles  remove those rows on the operator's own test profiles
#                         and users, in one transaction, after a preview
#
#   DATABASE_URL=… scripts/currency-rows.sh count
#   DATABASE_URL=… scripts/currency-rows.sh delete-test-profiles [--organization-id <uuid>[,…]] [--user-id <uuid>[,…]] [--dry-run] [--yes]
#
# Against production, run it through scripts/db.sh so the proxy and the URL come
# from Terraform and never reach your shell history:
#
#   TF_STATE_BUCKET=<bucket> npm run db:run -- scripts/currency-rows.sh count
#
# Rules:
#   * The columns are read from the catalog, never listed here: any character
#     column named currency or ending in Currency, outside the billing_* tables
#     (Stripe's currency, not a ledger's). Soft-deleted rows don't count.
#   * The supported list is read from server/src/money.ts, so it can't drift.
#   * A table with deletedAt is soft-deleted, the app's own delete: receipts,
#     group overrides and links stay valid and the rows can be recovered. A table
#     without one (matters, agreements, the inbox) is hard-deleted only when no
#     other row points at the doomed rows; otherwise the script lists those rows
#     and stops before changing anything.
#   * A profile's own defaultCurrency is never touched: it is printed, to change
#     in the portal (Settings › Profiles).
#   * Every run previews in a rolled-back transaction first; without --yes it asks
#     you to type delete before it commits.
# Bash 3.2 compatible (macOS /bin/bash).
set -euo pipefail

UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
MONEY_TS="$(cd "$(dirname "$0")/.." && pwd)/src/money.ts"

info() { printf '\033[0;36m[currency-rows]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[currency-rows] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[0;31m[currency-rows] %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/currency-rows.sh count
       scripts/currency-rows.sh delete-test-profiles [--organization-id <uuid>[,…]] [--user-id <uuid>[,…]] [--dry-run] [--yes]

  DATABASE_URL       the database to read (count) or change (delete-test-profiles)
  --organization-id  a test profile's id; repeat it or separate ids with commas
  --user-id          a test user's id, for their Unsorted inbox rows
  --dry-run          preview only: run it in one transaction and roll it back
  --yes              skip the typed confirmation
EOF
}

COMMAND="${1:-}"
case "${COMMAND}" in
  count|delete-test-profiles) shift ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

ORG_IDS=""
USER_IDS=""
DRY_RUN=0
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --organization-id) ORG_IDS="${ORG_IDS:+${ORG_IDS},}${2:-}"; shift 2 ;;
    --user-id) USER_IDS="${USER_IDS:+${USER_IDS},}${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

command -v psql >/dev/null 2>&1 || die "missing tool: psql (brew install libpq && brew link --force libpq)"
# Prisma-only query parameters (schema=, connection_limit=) are not libpq's; psql gets the bare URL.
TARGET_URL="${DATABASE_URL:?set DATABASE_URL (through scripts/db.sh run -- for production)}"
TARGET_URL="${TARGET_URL%%\?*}"

[[ -r "${MONEY_TS}" ]] || die "cannot read ${MONEY_TS}"
SUPPORTED="$(sed -n "s/^export const SUPPORTED_CURRENCIES = \[\(.*\)\] as const;\$/\1/p" "${MONEY_TS}" | tr -d " '")"
[[ "${SUPPORTED}" =~ ^[A-Z]{3}(,[A-Z]{3})*$ ]] || die "could not read SUPPORTED_CURRENCIES from ${MONEY_TS}"
# A loop, not ${SUPPORTED//,/','}: bash 3.2 keeps the backslashes that pattern needs.
SUPPORTED_SQL=""
for code in ${SUPPORTED//,/ }; do SUPPORTED_SQL+="${SUPPORTED_SQL:+,}'${code}'"; done

q() { psql -X -A -t -q -v ON_ERROR_STOP=1 --dbname="${TARGET_URL}" "$@"; }

# "table column" per line: every character column named currency or *Currency, outside billing_*.
currency_columns() {
  q -F ' ' -c "
    SELECT table_name, column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND data_type IN ('character varying', 'character', 'text')
       AND (column_name = 'currency' OR column_name LIKE '%Currency') AND table_name NOT LIKE 'billing\\_%'
     ORDER BY 1, 2"
}

has_column() { [[ "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1' AND column_name = '$2'")" == 1 ]]; }

# Whose row it is: the profile, or "user:<id>" for user-scoped tables (the Unsorted inbox).
owner_of() {
  if [[ "$1" == organizations ]]; then printf '%s' '"id"::text'
  elif has_column "$1" organizationId; then printf '%s' '"organizationId"::text'
  elif has_column "$1" userId; then printf '%s' "'user:' || \"userId\"::text"
  else printf '%s' "'-'"; fi
}

# The rows a table holds outside the supported list, live ones only.
outside_where() {
  local table="$1" column where=""
  for column in $(awk -v t="${table}" '$1 == t { print $2 }' <<<"${CURRENCY_COLUMNS}"); do
    where+="${where:+ OR }\"${column}\" NOT IN (${SUPPORTED_SQL})"
  done
  where="(${where})"
  if has_column "${table}" deletedAt; then where+=" AND \"deletedAt\" IS NULL"; fi
  printf '%s' "${where}"
}

CURRENCY_COLUMNS="$(currency_columns)"
[[ -n "${CURRENCY_COLUMNS}" ]] || die "no currency columns found; is DATABASE_URL the Mutaba3a database?"
CURRENCY_TABLES="$(awk '{ print $1 }' <<<"${CURRENCY_COLUMNS}" | uniq)"

# One SELECT per column: table, column, the stored code, the owner, how many live rows.
count_sql() {
  local table column parts="" live
  while read -r table column; do
    live=""
    if has_column "${table}" deletedAt; then live=" AND \"deletedAt\" IS NULL"; fi
    parts+="${parts:+ UNION ALL }SELECT '${table}', '${column}', \"${column}\", $(owner_of "${table}"), count(*) FROM \"${table}\" WHERE \"${column}\" NOT IN (${SUPPORTED_SQL})${live} GROUP BY 3, 4"
  done <<<"${CURRENCY_COLUMNS}"
  printf '%s ORDER BY 1, 2, 4, 3' "${parts}"
}

count() {
  local rows
  rows="$(q -F $'\t' -c "$(count_sql)")"
  if [[ -z "${rows}" ]]; then
    info "no rows outside ${SUPPORTED}"
    return 0
  fi
  warn "rows outside ${SUPPORTED}:"
  printf 'table\tcolumn\tcurrency\towner\trows\n%s\n' "${rows}"
  return 3
}

# 'a','b' from a comma list of uuids, refusing anything else.
uuid_list_sql() {
  local id out=""
  for id in ${1//,/ }; do
    [[ "${id}" =~ ${UUID_RE} ]] || die "not an id: ${id}"
    out+="${out:+,}'${id}'"
  done
  printf '%s' "${out}"
}

# "child_table child_column parent_column" per line: every foreign key pointing at the table.
referencing() {
  q -F ' ' -c "
    SELECT c.relname, ca.attname, pa.attname
      FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
      JOIN pg_attribute ca ON ca.attrelid = k.conrelid AND ca.attnum = k.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = k.confrelid AND pa.attnum = k.confkey[1]
     WHERE k.contype = 'f' AND k.confrelid = 'public.\"$1\"'::regclass"
}

delete_test_profiles() {
  [[ -n "${ORG_IDS}${USER_IDS}" ]] || die "name at least one --organization-id or --user-id"
  local orgs_sql="" users_sql=""
  [[ -z "${ORG_IDS}" ]] || orgs_sql="$(uuid_list_sql "${ORG_IDS}")"
  [[ -z "${USER_IDS}" ]] || users_sql="$(uuid_list_sql "${USER_IDS}")"

  # Name what is about to change, and refuse ids that aren't there.
  local named
  if [[ -n "${orgs_sql}" ]]; then
    named="$(q -F $'\t' -c "SELECT id, name, \"profileType\" FROM organizations WHERE id::text IN (${orgs_sql}) ORDER BY name")"
    [[ "$(grep -c . <<<"${named}")" == "$(tr ',' '\n' <<<"${orgs_sql}" | grep -c .)" ]] || die "not every --organization-id is a profile here"
    info "profiles:"$'\n'"${named}"
    local defaults
    defaults="$(q -F $'\t' -c "SELECT id, \"defaultCurrency\" FROM organizations WHERE id::text IN (${orgs_sql}) AND \"defaultCurrency\" NOT IN (${SUPPORTED_SQL})")"
    [[ -z "${defaults}" ]] || warn "change these profiles' currency in the portal (Settings › Profiles); this script leaves them:"$'\n'"${defaults}"
  fi
  if [[ -n "${users_sql}" ]]; then
    named="$(q -F $'\t' -c "SELECT id, email FROM users WHERE id::text IN (${users_sql}) ORDER BY email")"
    [[ "$(grep -c . <<<"${named}")" == "$(tr ',' '\n' <<<"${users_sql}" | grep -c .)" ]] || die "not every --user-id is a user here"
    info "users:"$'\n'"${named}"
  fi

  local sql="BEGIN;"$'\n' blockers="" table scope where child ccol pcol n
  while read -r table; do
    [[ "${table}" == organizations ]] && continue
    if has_column "${table}" organizationId; then
      [[ -n "${orgs_sql}" ]] || continue
      scope="\"organizationId\"::text IN (${orgs_sql})"
    elif has_column "${table}" userId; then
      [[ -n "${users_sql}" ]] || continue
      scope="\"userId\"::text IN (${users_sql})"
    else
      warn "skipping ${table}: it belongs to no profile or user"; continue
    fi
    where="$(outside_where "${table}") AND ${scope}"
    if has_column "${table}" deletedAt; then
      sql+="WITH d AS (UPDATE \"${table}\" SET \"deletedAt\" = now() WHERE ${where} RETURNING 1) SELECT '${table}: ' || count(*) || ' soft-deleted' FROM d;"$'\n'
      continue
    fi
    # A hard delete must not cascade, unlink or fail on anything else: list what points at the doomed rows.
    local refs
    refs="$(referencing "${table}")" || die "could not read the foreign keys of ${table}"
    while read -r child ccol pcol; do
      [[ -n "${child}" ]] || continue
      n="$(q -c "SELECT count(*) FROM \"${child}\" WHERE \"${ccol}\" IN (SELECT \"${pcol}\" FROM \"${table}\" WHERE ${where})")"
      [[ "${n}" == 0 ]] || blockers+="${table}: ${n} row(s) in ${child}.${ccol} point at them"$'\n'
    done <<<"${refs}"
    sql+="WITH d AS (DELETE FROM \"${table}\" WHERE ${where} RETURNING 1) SELECT '${table}: ' || count(*) || ' deleted' FROM d;"$'\n'
  done <<<"${CURRENCY_TABLES}"
  [[ -z "${blockers}" ]] || die "nothing changed; these rows can't be hard-deleted while other rows point at them:"$'\n'"${blockers%$'\n'}"

  info "preview:"
  printf '%s\n' "${sql}ROLLBACK;" | q || die "the preview failed; nothing changed"
  if [[ "${DRY_RUN}" == 1 ]]; then
    info "dry run: rolled back, nothing changed"
    return 0
  fi
  if [[ "${YES}" != 1 ]]; then
    [[ -r /dev/tty ]] || die "needs a terminal to confirm (or --yes)"
    printf 'Apply the changes above (outside %s)?\nType delete to continue: ' "${SUPPORTED}" >/dev/tty
    local answer; read -r answer </dev/tty
    [[ "${answer}" == delete ]] || die "not confirmed; nothing changed"
  fi
  printf '%s\n' "${sql}COMMIT;" | q || die "the change stopped; nothing changed"
  info "committed"
}

case "${COMMAND}" in
  count) count ;;
  delete-test-profiles) delete_test_profiles ;;
esac
