#!/usr/bin/env bash
# Mutaba3a API — rows in a currency the API no longer supports (MUT-388).
#
# MUT-280 let the hosted API store AED, SAR, QAR, BHD and OMR; MUT-388 (ADR-166)
# took them out again. Nothing in the database refuses those codes (every
# currency column is VarChar(3)), and a row still holding one reads back with a
# blank amount. This is the release gate: run it before and after the server
# release that drops a currency.
#
#   count                 list every row whose currency is not one of
#                         SUPPORTED_CURRENCIES; exits 3 when there are any
#   delete-test-profiles  delete those rows, and only those, on the profiles named
#                         (the operator's own test profiles), in one transaction
#
#   DATABASE_URL=… scripts/currency-rows.sh count
#   DATABASE_URL=… scripts/currency-rows.sh delete-test-profiles --organization-id <uuid>[,<uuid>…] [--dry-run] [--yes]
#
# Against production, run it through scripts/db.sh so the proxy and the URL come
# from Terraform and never reach your shell history:
#
#   TF_STATE_BUCKET=<bucket> npm run db:run -- scripts/currency-rows.sh count
#
# Rules:
#   * The columns are read from the catalog, never listed here: any character
#     column named currency or ending in Currency, outside the billing_* tables
#     (Stripe's currency, not a ledger's).
#   * The supported list is read from server/src/money.ts, so it can't drift.
#   * delete-test-profiles never touches a profile's own defaultCurrency: it prints
#     those, to change in the portal (Settings › Profiles). It deletes children
#     before parents; a row something else still points at stops the whole
#     transaction and nothing changes. --dry-run runs it all and rolls it back.
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
       scripts/currency-rows.sh delete-test-profiles --organization-id <uuid>[,<uuid>…] [--dry-run] [--yes]

  DATABASE_URL       the database to read (count) or change (delete-test-profiles)
  --organization-id  a test profile's id; repeat it or separate ids with commas
  --dry-run          run the delete in one transaction and roll it back
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
DRY_RUN=0
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --organization-id) ORG_IDS="${ORG_IDS:+${ORG_IDS},}${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

command -v psql >/dev/null 2>&1 || die "missing tool: psql (brew install libpq && brew link --force libpq)"
command -v tsort >/dev/null 2>&1 || die "missing tool: tsort (coreutils)"
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

has_org_column() { [[ "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$1' AND column_name = 'organizationId'")" == 1 ]]; }

# Every public table, parents before children (foreign keys through tsort), as in profile-rows.sh.
tables_in_fk_order() {
  q -F ' ' -c "
    SELECT p.relname, c.relname
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
     WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace AND k.conrelid <> k.confrelid
    UNION ALL
    SELECT tablename, tablename FROM pg_tables WHERE schemaname = 'public'" | tsort
}

COLUMNS="$(currency_columns)"
[[ -n "${COLUMNS}" ]] || die "no currency columns found; is DATABASE_URL the Mutaba3a database?"

# One SELECT per column: table, column, the stored code, the profile, how many rows.
count_sql() {
  local table column org parts=""
  while read -r table column; do
    if [[ "${table}" == organizations ]]; then org='"id"::text'
    elif has_org_column "${table}"; then org='"organizationId"::text'
    else org="'-'"; fi
    parts+="${parts:+ UNION ALL }SELECT '${table}', '${column}', \"${column}\", ${org}, count(*) FROM \"${table}\" WHERE \"${column}\" NOT IN (${SUPPORTED_SQL}) GROUP BY 3, 4"
  done <<<"${COLUMNS}"
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
  printf 'table\tcolumn\tcurrency\tprofile\trows\n%s\n' "${rows}"
  return 3
}

delete_test_profiles() {
  [[ -n "${ORG_IDS}" ]] || die "name at least one --organization-id"
  local id ids_sql="" table column cols
  for id in ${ORG_IDS//,/ }; do
    [[ "${id}" =~ ${UUID_RE} ]] || die "not a profile id: ${id}"
    ids_sql+="${ids_sql:+,}'${id}'"
  done

  # The profiles' own default currency is the profile, not a row to delete.
  local defaults
  defaults="$(q -F $'\t' -c "SELECT id, \"defaultCurrency\" FROM organizations WHERE id::text IN (${ids_sql}) AND \"defaultCurrency\" NOT IN (${SUPPORTED_SQL})")"
  [[ -z "${defaults}" ]] || warn "change these profiles' currency in the portal (Settings › Profiles); this script leaves them:"$'\n'"${defaults}"

  local sql="BEGIN;"$'\n' found=0
  while read -r table; do
    [[ "${table}" == organizations ]] && continue
    cols="$(awk -v t="${table}" '$1 == t { print $2 }' <<<"${COLUMNS}")"
    [[ -n "${cols}" ]] || continue
    if ! has_org_column "${table}"; then warn "skipping ${table}: it has no organizationId"; continue; fi
    local where=""
    for column in ${cols}; do where+="${where:+ OR }\"${column}\" NOT IN (${SUPPORTED_SQL})"; done
    sql+="WITH d AS (DELETE FROM \"${table}\" WHERE (${where}) AND \"organizationId\"::text IN (${ids_sql}) RETURNING 1) SELECT '${table}: ' || count(*) || ' deleted' FROM d;"$'\n'
    found=1
  done < <(tables_in_fk_order | awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }')
  [[ "${found}" == 1 ]] || { info "no currency tables to clean"; return 0; }

  if [[ "${DRY_RUN}" == 1 ]]; then
    sql+="ROLLBACK;"$'\n'"\\echo 'dry run: rolled back, nothing changed'"
  else
    if [[ "${YES}" != 1 ]]; then
      [[ -r /dev/tty ]] || die "needs a terminal to confirm (or --yes)"
      printf 'Delete every row outside %s on %s?\nType delete to continue: ' "${SUPPORTED}" "${ORG_IDS}" >/dev/tty
      local answer; read -r answer </dev/tty
      [[ "${answer}" == delete ]] || die "not confirmed; nothing changed"
    fi
    sql+="COMMIT;"$'\n'"\\echo 'committed'"
  fi
  printf '%s\n' "${sql}" | q || die "the delete stopped (a row something else points at?); nothing changed"
}

case "${COMMAND}" in
  count) count ;;
  delete-test-profiles) delete_test_profiles ;;
esac
