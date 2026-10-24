#!/usr/bin/env bash
# Mutaba3a API — one profile's rows, by hand (MUT-327). The operator's tools for
# the pilot runbook (docs/operations/pilot-runbook.md §4, §7):
#
#   export      write one profile's records as CSV files, plus the lines that copy
#               its receipts out of the bucket ("we send you your records" until MUT-325)
#   restore     put one profile back as a restored copy has it (runbook §4.2)
#   purge-user  delete an account and every profile it owns, by hand (the hourly job does it for closed accounts
#               since MUT-333: npm run accounts:purge; this stays for the operator's own cases)
#
#   DATABASE_URL=… scripts/profile-rows.sh export --organization-id <uuid> --out <dir> [--bucket <name>]
#   SOURCE_DATABASE_URL=<restored copy> DATABASE_URL=<live> scripts/profile-rows.sh restore --organization-id <uuid> [--dry-run] [--yes]
#   DATABASE_URL=… scripts/profile-rows.sh purge-user --user-id <uuid> [--dry-run] [--yes] [--bucket <name>]
#
# Against production, run it through scripts/db.sh so the proxy and the URL come
# from Terraform and never reach your shell history:
#
#   TF_STATE_BUCKET=<bucket> npm run db:run -- scripts/profile-rows.sh restore --organization-id <uuid> --dry-run
#
# Rules:
#   * The schema is read from the catalog, never listed here: a profile table is
#     any table with an "organizationId" column, and foreign keys give the order.
#   * restore and purge-user run as ONE transaction on the target. --dry-run runs
#     the whole thing and ends in ROLLBACK, so it is a rehearsal, not a preview.
#   * restore never rolls back access: api_keys, memberships, integrations and
#     idempotency_keys keep what the live database has now. Neither does it roll back
#     billing (MUT-358): billing_subscriptions follow Stripe and entitlement_grants the
#     operator, never a backup; export leaves both out, since they aren't the person's records. audit_events only grow:
#     rows missing from the live database are added back, none are removed, and a
#     SYSTEM event organization.restored records the restore.
#   * purge-user refuses while the person is a member of a profile they don't own
#     (revoke:user first, which audits it), while a profile they created has
#     co-owners (MUT-373), or while RESTRICT rows in someone else's profile still
#     point at them. Since MUT-333 (D7) the creator columns are SET NULL, so their
#     records elsewhere stay, anonymized. MUT-333's own purge (accounts:purge) also
#     passes a shared profile to its co-owner and scrubs the audit; prefer it.
#   * Neither touches the attachments bucket: they print the gcloud lines to run.
# Bash 3.2 compatible (macOS /bin/bash).
set -euo pipefail

RESTORE_KEEP_LIVE="api_keys memberships integrations idempotency_keys billing_subscriptions entitlement_grants audit_events"
EXPORT_SKIP="api_keys idempotency_keys billing_subscriptions entitlement_grants"
UUID_RE='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

info() { printf '\033[0;36m[profile-rows]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[profile-rows] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[0;31m[profile-rows] %s\033[0m\n' "$*" >&2; exit 1; }

usage() {
  cat >&2 <<'EOF'
usage: scripts/profile-rows.sh export     --organization-id <uuid> --out <dir> [--bucket <name>]
       scripts/profile-rows.sh restore    --organization-id <uuid> [--label <text>] [--dry-run] [--yes]
       scripts/profile-rows.sh purge-user --user-id <uuid> [--bucket <name>] [--dry-run] [--yes]

  DATABASE_URL          the database to read (export) or change (restore, purge-user)
  SOURCE_DATABASE_URL   restore only: the restored copy to read the profile from
  --bucket              attachments bucket for the printed gcloud lines
                        (default: $GCP_PROJECT_ID-mutaba3a-attachments)
  --dry-run             run everything in one transaction and roll it back
  --yes                 skip the typed confirmation
EOF
}

COMMAND="${1:-}"
case "${COMMAND}" in
  export|restore|purge-user) shift ;;
  -h|--help|help) usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

ORG_ID=""
USER_ID=""
OUT=""
BUCKET=""
LABEL="restored copy"
DRY_RUN=0
YES=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --organization-id) ORG_ID="${2:-}"; shift 2 ;;
    --user-id) USER_ID="${2:-}"; shift 2 ;;
    --out) OUT="${2:-}"; shift 2 ;;
    --bucket) BUCKET="${2:-}"; shift 2 ;;
    --label) LABEL="${2:-}"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --yes) YES=1; shift ;;
    *) usage; die "unknown option: $1" ;;
  esac
done
BUCKET="${BUCKET:-${GCP_PROJECT_ID:-<project>}-mutaba3a-attachments}"

command -v psql >/dev/null 2>&1 || die "missing tool: psql (brew install libpq && brew link --force libpq)"
command -v tsort >/dev/null 2>&1 || die "missing tool: tsort (coreutils)"
# Prisma-only query parameters (schema=, connection_limit=) are not libpq's; psql gets the bare URL.
TARGET_URL="${DATABASE_URL:?set DATABASE_URL (through scripts/db.sh run -- for production)}"
TARGET_URL="${TARGET_URL%%\?*}"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/profile-rows-XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
[[ "${WORK}" != *"'"* ]] || die "temporary directory path contains a quote: ${WORK}"

q() { local url="$1"; shift; psql -X -A -t -q -v ON_ERROR_STOP=1 --dbname="${url}" "$@"; }
in_list() { case " $2 " in *" $1 "*) return 0 ;; *) return 1 ;; esac; }
reverse_lines() { awk '{ line[NR] = $0 } END { for (i = NR; i > 0; i--) print line[i] }'; }
sql_list() { local out="" id; for id in "$@"; do out+="${out:+,}'${id}'"; done; printf 'ARRAY[%s]::uuid[]' "${out}"; }

# Where a URL points, without its password: host, port, database and server start time.
where() {
  q "$1" -c "SELECT coalesce(host(inet_server_addr()), 'local socket') || ':' || coalesce(inet_server_port()::text, '-') || '/' || current_database() || ' (up since ' || to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') || ' UTC)'"
}

# Every public table, parents before children (foreign keys through tsort).
tables_in_fk_order() {
  q "$1" -c "
    SELECT p.relname || ' ' || c.relname
      FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class p ON p.oid = k.confrelid
     WHERE k.contype = 'f' AND k.connamespace = 'public'::regnamespace AND k.conrelid <> k.confrelid
    UNION ALL
    SELECT tablename || ' ' || tablename FROM pg_tables WHERE schemaname = 'public'" | tsort
}

profile_tables() { q "$1" -c "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organizationId' ORDER BY 1"; }
columns_of() { q "$1" -c "SELECT string_agg(quote_ident(column_name), ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$2'"; }
signature_of() { q "$1" -c "SELECT string_agg(column_name || ' ' || udt_name || ' ' || is_nullable, ', ' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$2'"; }
has_column() { [[ "$(q "$1" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$2' AND column_name = '$3'")" == 1 ]]; }

confirm_typed() {
  local expected="$1" prompt="$2" answer
  [[ "${YES}" == 1 || "${DRY_RUN}" == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "needs a terminal to confirm (or --yes): ${prompt}"
  printf '%s\nType %s to continue: ' "${prompt}" "${expected}" >/dev/tty
  read -r answer </dev/tty
  [[ "${answer}" == "${expected}" ]] || die "not confirmed; nothing changed"
}

finish_transaction() {
  if [[ "${DRY_RUN}" == 1 ]]; then
    printf "\\\\echo 'dry run: rolled back, nothing changed'\nROLLBACK;\n"
  else
    printf "COMMIT;\n\\\\echo 'committed'\n"
  fi
}

receipt_lines() { # receipt_lines <url> <organization ids…>: gcloud cp lines for each stored file of the profile
  local url="$1"; shift
  local table
  for table in expense_receipts attachments; do
    has_column "${url}" "${table}" storageKey || continue
    q "${url}" -F $'\t' -c "SELECT id, \"storageKey\", filename FROM ${table} WHERE \"organizationId\" = ANY($(sql_list "$@")) AND \"deletedAt\" IS NULL ORDER BY \"createdAt\", id" |
      while IFS=$'\t' read -r id key filename; do
        [[ -n "${id}" ]] || continue
        printf "gcloud storage cp 'gs://%s/%s' 'receipts/%s-%s'\n" "${BUCKET}" "${key}" "${id}" "$(printf '%s' "${filename}" | tr "/'" '__')"
      done
  done
}

# ---------------------------------------------------------------------------
# export
# ---------------------------------------------------------------------------
if [[ "${COMMAND}" == "export" ]]; then
  [[ "${ORG_ID}" =~ ${UUID_RE} ]] || die "--organization-id must be a uuid"
  [[ -n "${OUT}" ]] || die "--out <dir> is required"
  [[ "${OUT}" != *"'"* ]] || die "--out must not contain a quote"
  [[ ! -e "${OUT}" || -z "$(ls -A "${OUT}")" ]] || die "--out ${OUT} is not empty"
  [[ "$(q "${TARGET_URL}" -c "SELECT count(*) FROM organizations WHERE id = '${ORG_ID}'")" == 1 ]] || die "no profile ${ORG_ID} in $(where "${TARGET_URL}")"
  mkdir -p "${OUT}"
  OUT="$(cd "${OUT}" && pwd)"
  script="${WORK}/export.sql"
  printf "\\\\copy (SELECT * FROM organizations WHERE id = '%s') TO '%s/organizations.csv' WITH (FORMAT csv, HEADER)\n" "${ORG_ID}" "${OUT}" >"${script}"
  count=1
  for table in $(profile_tables "${TARGET_URL}"); do
    in_list "${table}" "${EXPORT_SKIP}" && continue
    printf "\\\\copy (SELECT %s FROM %s WHERE \"organizationId\" = '%s') TO '%s/%s.csv' WITH (FORMAT csv, HEADER)\n" \
      "$(columns_of "${TARGET_URL}" "${table}")" "${table}" "${ORG_ID}" "${OUT}" "${table}" >>"${script}"
    count=$((count + 1))
  done
  q "${TARGET_URL}" -f "${script}" >/dev/null
  receipt_lines "${TARGET_URL}" "${ORG_ID}" >"${OUT}/receipts.txt"
  info "wrote ${count} CSV files to ${OUT}, from $(where "${TARGET_URL}")"
  info "receipts: $(grep -c . "${OUT}/receipts.txt" || true) files; copy them with: (cd '${OUT}' && mkdir -p receipts && sh receipts.txt)"
  exit 0
fi

# ---------------------------------------------------------------------------
# restore
# ---------------------------------------------------------------------------
if [[ "${COMMAND}" == "restore" ]]; then
  [[ "${ORG_ID}" =~ ${UUID_RE} ]] || die "--organization-id must be a uuid"
  SOURCE_URL="${SOURCE_DATABASE_URL:?set SOURCE_DATABASE_URL to the restored copy (runbook §4.2)}"
  SOURCE_URL="${SOURCE_URL%%\?*}"
  SOURCE_AT="$(where "${SOURCE_URL}")"
  TARGET_AT="$(where "${TARGET_URL}")"
  [[ "${SOURCE_AT}" != "${TARGET_AT}" ]] || die "SOURCE_DATABASE_URL and DATABASE_URL are the same database (${TARGET_AT}); the source must be the restored copy"
  for side in "${SOURCE_URL}" "${TARGET_URL}"; do
    [[ "$(q "${side}" -c "SELECT count(*) FROM organizations WHERE id = '${ORG_ID}'")" == 1 ]] || die "no profile ${ORG_ID} in $(where "${side}")"
  done

  source_tables="$(profile_tables "${SOURCE_URL}" | tr '\n' ' ')"
  target_tables="$(profile_tables "${TARGET_URL}" | tr '\n' ' ')"
  mismatch=""
  [[ "${source_tables}" == "${target_tables}" ]] || mismatch+="profile tables: copy has [${source_tables}], live has [${target_tables}]; "
  for table in ${target_tables}; do
    in_list "${table}" "${RESTORE_KEEP_LIVE}" && [[ "${table}" != "audit_events" ]] && continue
    [[ "$(signature_of "${SOURCE_URL}" "${table}")" == "$(signature_of "${TARGET_URL}" "${table}")" ]] || mismatch+="${table}; "
  done
  [[ -z "${mismatch}" ]] || die "the copy's schema differs from the live database's (${mismatch%; }). Migrate the copy to the same migrations first (runbook §4.2)"

  order="$(tables_in_fk_order "${TARGET_URL}")"
  restore_tables=""
  for table in ${order}; do
    in_list "${table}" "${target_tables}" || continue
    in_list "${table}" "${RESTORE_KEEP_LIVE}" && continue
    restore_tables+="${table} "
  done

  # Read the profile out of the copy, and how many rows each table should end with.
  dump="${WORK}/dump.sql"
  : >"${dump}"
  counts_query=""
  for table in ${restore_tables} audit_events; do
    printf "\\\\copy (SELECT %s FROM %s WHERE \"organizationId\" = '%s') TO '%s/%s.csv' WITH (FORMAT csv)\n" \
      "$(columns_of "${TARGET_URL}" "${table}")" "${table}" "${ORG_ID}" "${WORK}" "${table}" >>"${dump}"
    counts_query+="${counts_query:+ UNION ALL }SELECT '${table}', count(*) FROM ${table} WHERE \"organizationId\" = '${ORG_ID}'"
  done
  q "${SOURCE_URL}" -f "${dump}" >/dev/null
  q "${SOURCE_URL}" -F '|' -c "${counts_query}" >"${WORK}/copy.counts"
  q "${TARGET_URL}" -F '|' -c "${counts_query}" >"${WORK}/live.counts"

  info "profile ${ORG_ID}: live ${TARGET_AT} ← copy ${SOURCE_AT}"
  printf '%-28s %10s %10s\n' "table" "live now" "copy"
  LC_ALL=C join -t '|' <(LC_ALL=C sort "${WORK}/live.counts") <(LC_ALL=C sort "${WORK}/copy.counts") | awk -F'|' '{ printf "%-28s %10s %10s\n", $1, $2, $3 }'
  info "kept as live has them: ${RESTORE_KEEP_LIVE% audit_events} (access is never rolled back); audit_events: missing rows added, none removed"
  confirm_typed "${ORG_ID}" "Replace profile ${ORG_ID}'s records in ${TARGET_AT} with the ${LABEL}?"

  apply="${WORK}/apply.sql"
  {
    echo "BEGIN;"
    echo "SELECT id FROM organizations WHERE id = '${ORG_ID}' FOR UPDATE \\g /dev/null"
    has_column "${TARGET_URL}" expense_receipts storageKey &&
      echo "CREATE TEMP TABLE mut327_keys_before ON COMMIT DROP AS SELECT \"storageKey\" FROM expense_receipts WHERE \"organizationId\" = '${ORG_ID}';"
    for table in $(tr ' ' '\n' <<<"${restore_tables}" | reverse_lines); do
      echo "DELETE FROM ${table} WHERE \"organizationId\" = '${ORG_ID}';"
    done
    for table in ${restore_tables}; do
      echo "\\copy ${table} ($(columns_of "${TARGET_URL}" "${table}")) FROM '${WORK}/${table}.csv' WITH (FORMAT csv)"
    done
    echo "CREATE TEMP TABLE mut327_audit (LIKE audit_events) ON COMMIT DROP;"
    echo "\\copy mut327_audit ($(columns_of "${TARGET_URL}" audit_events)) FROM '${WORK}/audit_events.csv' WITH (FORMAT csv)"
    echo "INSERT INTO audit_events SELECT * FROM mut327_audit ON CONFLICT (id) DO NOTHING;"
    # Every restored table must now hold exactly what the copy has, or nothing is kept.
    echo "DO \$\$ DECLARE n bigint; BEGIN"
    while IFS='|' read -r table expected; do
      [[ "${table}" == "audit_events" ]] && continue
      echo "  SELECT count(*) INTO n FROM ${table} WHERE \"organizationId\" = '${ORG_ID}';"
      echo "  IF n <> ${expected} THEN RAISE EXCEPTION '${table}: expected ${expected} rows from the copy, found %', n; END IF;"
    done <"${WORK}/copy.counts"
    echo "END \$\$;"
    echo "INSERT INTO audit_events (id, \"organizationId\", \"actorType\", \"actorId\", action, \"entityType\", \"entityId\", metadata, \"createdAt\")"
    echo "  VALUES (gen_random_uuid(), '${ORG_ID}', 'SYSTEM', NULL, 'organization.restored', 'organization', '${ORG_ID}',"
    echo "          jsonb_build_object('by', 'scripts/profile-rows.sh restore', 'source', \$label\$${LABEL}\$label\$, 'tables', $(wc -w <<<"${restore_tables}" | tr -d ' ')), now());"
    if has_column "${TARGET_URL}" expense_receipts storageKey; then
      printf '%s\n' "\\echo 'receipts that came back (check their objects, runbook §4.4):'"
      echo "SELECT '  ' || \"storageKey\" FROM expense_receipts WHERE \"organizationId\" = '${ORG_ID}' AND \"deletedAt\" IS NULL AND \"storageKey\" NOT IN (SELECT \"storageKey\" FROM mut327_keys_before) ORDER BY 1;"
    fi
    finish_transaction
  } >"${apply}"
  q "${TARGET_URL}" -f "${apply}"
  [[ "${DRY_RUN}" == 1 ]] || info "profile ${ORG_ID} restored from the ${LABEL}; re-check its access by hand (runbook §4.2 step 6)"
  exit 0
fi

# ---------------------------------------------------------------------------
# purge-user
# ---------------------------------------------------------------------------
[[ "${USER_ID}" =~ ${UUID_RE} ]] || die "--user-id must be a uuid"
TARGET_AT="$(where "${TARGET_URL}")"
[[ "$(q "${TARGET_URL}" -c "SELECT count(*) FROM users WHERE id = '${USER_ID}'")" == 1 ]] || die "no user ${USER_ID} in ${TARGET_AT}"

# shellcheck disable=SC2207 # uuids: no spaces or globs
OWNED=($(q "${TARGET_URL}" -c "SELECT id FROM organizations WHERE \"ownerUserId\" = '${USER_ID}' OR \"personalOwnerUserId\" = '${USER_ID}' ORDER BY id"))
OWNED_SQL="$(sql_list ${OWNED[@]+"${OWNED[@]}"})"
all_profile_tables="$(profile_tables "${TARGET_URL}" | tr '\n' ' ')"

shared="$(q "${TARGET_URL}" -c "SELECT \"organizationId\" FROM memberships WHERE \"userId\" = '${USER_ID}' AND \"organizationId\" <> ALL(${OWNED_SQL}) ORDER BY 1" | tr '\n' ' ')"
[[ -z "${shared}" ]] || die "refusing: still a member of profile(s) they don't own (memberships): ${shared}. Remove each with: npm run revoke:user -- --url \"\$URL\" --email <email> --organization-id <id>"

# MUT-373: a profile they created that someone else co-owns is the partners' books too; it never goes with one account.
co_owned="$(q "${TARGET_URL}" -c "SELECT DISTINCT \"organizationId\" FROM memberships WHERE \"organizationId\" = ANY(${OWNED_SQL}) AND \"userId\" <> '${USER_ID}' ORDER BY 1" | tr '\n' ' ')"
[[ -z "${co_owned}" ]] || die "refusing: profile(s) they created still have co-owners: ${co_owned}. Remove each co-owner first (npm run revoke:user), or wait for MUT-333's transfer rules"


# Columns that point at users, and what deleting the user would do to rows outside the owned profiles.
user_fks="$(q "${TARGET_URL}" -F '|' -c "
  SELECT c.relname, a.attname, k.confdeltype
    FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
    JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
   WHERE k.contype = 'f' AND k.confrelid = 'public.users'::regclass AND array_length(k.conkey, 1) = 1
   ORDER BY 1, 2")"
blockers=""
user_only_deletes=""
while IFS='|' read -r table column rule; do
  [[ -n "${table}" ]] || continue
  if in_list "${table}" "${all_profile_tables}"; then
    scope="\"organizationId\" <> ALL(${OWNED_SQL})"
  elif [[ "${table}" == "organizations" ]]; then
    scope="id <> ALL(${OWNED_SQL})"
  else
    user_only_deletes+="${table}|${column} "
    continue
  fi
  [[ "${rule}" == "c" || "${rule}" == "n" || "${rule}" == "d" ]] && continue
  n="$(q "${TARGET_URL}" -c "SELECT count(*) FROM ${table} WHERE \"${column}\" = '${USER_ID}' AND ${scope}")"
  [[ "${n}" == 0 ]] || blockers+="${table}.${column}: ${n} row(s); "
done <<<"${user_fks}"
[[ -z "${blockers}" ]] || die "refusing: rows in profiles this person doesn't own still point at them (${blockers%; }). Closing such an account is MUT-333's decision; stop and ask"

info "user ${USER_ID} in ${TARGET_AT}: owns ${#OWNED[@]} profile(s): ${OWNED[*]:-none}"
others="$(q "${TARGET_URL}" -c "SELECT count(*) FROM audit_events WHERE \"organizationId\" <> ALL(${OWNED_SQL}) AND (\"actorId\" = '${USER_ID}' OR \"entityId\" = '${USER_ID}') AND action <> 'user.terms_accepted'")"
[[ "${others}" == 0 ]] || warn "${others} audit row(s) in other profiles name this user id and stay (the audit trail's tombstone; MUT-333 decides more)"
confirm_typed "${USER_ID}" "Delete user ${USER_ID}, the ${#OWNED[@]} profile(s) they own and every row in them, from ${TARGET_AT}? This cannot be undone (backups age out after 14 days)."

purge="${WORK}/purge.sql"
{
  echo "BEGIN;"
  echo "SELECT id FROM users WHERE id = '${USER_ID}' FOR UPDATE \\g /dev/null"
  echo "DELETE FROM audit_events WHERE action = 'user.terms_accepted' AND \"actorId\" = '${USER_ID}';"
  for table in $(tables_in_fk_order "${TARGET_URL}" | reverse_lines); do
    if in_list "${table}" "${all_profile_tables}"; then
      echo "DELETE FROM ${table} WHERE \"organizationId\" = ANY(${OWNED_SQL});"
    fi
    for pair in ${user_only_deletes}; do
      [[ "${pair%%|*}" == "${table}" ]] && echo "DELETE FROM ${table} WHERE \"${pair#*|}\" = '${USER_ID}';"
    done
    [[ "${table}" == "organizations" ]] && echo "DELETE FROM organizations WHERE id = ANY(${OWNED_SQL});"
    [[ "${table}" == "users" ]] && echo "DELETE FROM users WHERE id = '${USER_ID}';"
  done
  echo "DO \$\$ BEGIN IF EXISTS (SELECT 1 FROM users WHERE id = '${USER_ID}') THEN RAISE EXCEPTION 'user still present'; END IF; END \$\$;"
  finish_transaction
} >"${purge}"
q "${TARGET_URL}" -f "${purge}"

echo "Delete the profiles' files from the bucket (receipts and attachments):"
for id in ${OWNED[@]+"${OWNED[@]}"}; do printf "  gcloud storage rm --recursive 'gs://%s/org/%s/'\n" "${BUCKET}" "${id}"; done
[[ "${DRY_RUN}" == 1 ]] || echo "Offboarding log line: $(date -u +%Y-%m-%dT%H:%MZ) purged user ${USER_ID} and ${#OWNED[@]} profile(s) (${OWNED[*]:-none})"
