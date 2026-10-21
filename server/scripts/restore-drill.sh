#!/usr/bin/env bash
# Mutaba3a API — restore drill (MUT-327). The operator runs this; nothing in CI does.
#
# Proves that production's backups restore, without touching production:
#   1. clones last night's automated backup into a scratch Cloud SQL instance;
#   2. separately restores to a point in time (default: 1 hour ago) into a second one;
#   3. checks both read-only: exact row count of every table, applied migrations,
#      the newest audit event, and that a known receipt still opens from the bucket;
#   4. prints how long each step took, as rows for the runbook's "Drill results";
#   5. deletes both scratch instances, on every exit path (unless --keep).
#
#   scripts/restore-drill.sh --project <id> [--dry-run]            (TF_STATE_BUCKET set: the source is the
#                                                                   instance the API serves from, MUT-381)
#   scripts/restore-drill.sh --project <id> --receipt-id <uuid> [--pitr-minutes 60] [--only backup|pitr] [--keep]
#   scripts/restore-drill.sh teardown --project <id> [--name <scratch instance>] [--dry-run]
#
# Safety:
#   * Every command that creates, changes or deletes an instance names a scratch
#     instance as its target, and `mutate` refuses any other name: the pattern is
#     mutaba3a-pg-drill-<yyyymmdd>t<hhmmss>-<b|p>, and never the source instance.
#     The source only appears in read-only commands, as --backup-instance, and as
#     the clone's source.
#   * The scratch copies get their own throwaway password for mutaba3a_api, so the
#     drill never reads production's database password.
#   * Each step that costs money asks first. --dry-run prints every command and
#     calls nothing, not even read-only gcloud.
#
# Runbook: docs/operations/pilot-runbook.md §8 (how to run it) and §10 (results).
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no mapfile.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH_RE='^mutaba3a-pg-drill-[0-9]{8}t[0-9]{6}-[bp]$'
PITR_LOG_MINUTES=$((7 * 24 * 60)) # transaction_log_retention_days = 7 (infrastructure/terraform/main.tf)
DB_NAME="mutaba3a"
DB_USER="mutaba3a_api"

SUBCOMMAND="drill"
PROJECT="${GCP_PROJECT_ID:-}"
SOURCE=""
RECEIPT_ID=""
PITR_MINUTES=60
ONLY=""
KEEP=0
DRY_RUN=0
YES=0 # the drill always asks before a paid step; lib/script-helpers.sh's confirm honours YES
TEARDOWN_NAME=""
BUCKET=""

info() { printf '\033[0;36m[drill]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[drill] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[0;31m[drill] %s\033[0m\n' "$*" >&2; exit 1; }

# shellcheck source-path=SCRIPTDIR source=lib/script-helpers.sh
. "${SERVER_DIR}/scripts/lib/script-helpers.sh"
# shellcheck source-path=SCRIPTDIR source=lib/db-checks.sh
. "${SERVER_DIR}/scripts/lib/db-checks.sh"

usage() {
  cat >&2 <<EOF
usage: scripts/restore-drill.sh --project <id> [options]
       scripts/restore-drill.sh teardown --project <id> [--name <scratch instance>] [--dry-run]

  --project <id>        GCP project holding the source instance (or GCP_PROJECT_ID)
  --instance <name>     source Cloud SQL instance, only ever read (default: the instance the API serves
                        from, read from terraform state in TF_STATE_BUCKET: mutaba3a-pg, or mutaba3a-pg2
                        once cmek_stage is active)
  --receipt-id <uuid>   the receipt to open (default: the newest READY receipt in the copy)
  --bucket <name>       attachments bucket (default: <project>-mutaba3a-attachments)
  --pitr-minutes <n>    restore point, minutes ago (default 60; at most 7 days of logs)
  --only backup|pitr    run one of the two restores
  --keep                leave the scratch instances up (delete later with: teardown)
  --dry-run             print every command, run nothing

teardown deletes scratch instances left by a run with --keep or an interrupted run:
every mutaba3a-pg-drill-* instance in the project, one confirmation each, or just --name.
EOF
}

if [[ "${1:-}" == "teardown" ]]; then SUBCOMMAND="teardown"; shift; fi
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --instance) SOURCE="${2:-}"; shift 2 ;;
    --receipt-id) RECEIPT_ID="${2:-}"; shift 2 ;;
    --bucket) BUCKET="${2:-}"; shift 2 ;;
    --pitr-minutes) PITR_MINUTES="${2:-}"; shift 2 ;;
    --only) ONLY="${2:-}"; shift 2 ;;
    --name) TEARDOWN_NAME="${2:-}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
done

[[ -n "${PROJECT}" ]] || { usage; exit 2; }
[[ -z "${ONLY}" || "${ONLY}" == "backup" || "${ONLY}" == "pitr" ]] || die "--only must be backup or pitr"
[[ "${PITR_MINUTES}" =~ ^[0-9]+$ ]] || die "--pitr-minutes must be a whole number"
(( PITR_MINUTES >= 1 && PITR_MINUTES < PITR_LOG_MINUTES - 10 )) || die "--pitr-minutes must be between 1 and $((PITR_LOG_MINUTES - 11)) (7 days of logs)"
[[ -n "${RECEIPT_ID}" && ! "${RECEIPT_ID}" =~ ^[0-9a-fA-F-]{36}$ ]] && die "--receipt-id must be a uuid"
[[ "${SOURCE}" =~ ^mutaba3a-pg-drill- ]] && die "refusing: --instance ${SOURCE} is a drill scratch instance; the source is the instance you back up (the one the API serves from)"
BUCKET="${BUCKET:-${PROJECT}-mutaba3a-attachments}"

# ---------------------------------------------------------------------------
# Command helpers
# ---------------------------------------------------------------------------
# run, run_capture, confirm, need, timed: lib/script-helpers.sh

assert_scratch() {
  local name="$1"
  [[ "${name}" != "${SOURCE}" ]] || die "refusing: ${name} is the source instance; this script never changes it"
  [[ "${name}" =~ ${SCRATCH_RE} ]] || die "refusing: ${name} is not a drill scratch instance (mutaba3a-pg-drill-<yyyymmdd>t<hhmmss>-<b|p>)"
}

# mutate <target instance> <command...>: the only way this script creates, changes or deletes anything.
mutate() {
  local target="$1"; shift
  assert_scratch "${target}"
  run "$@"
}

utc_minutes_ago() {
  local at=$(( $(date -u +%s) - $1 * 60 ))
  date -u -r "${at}" +%Y-%m-%dT%H:%M:%S.000Z 2>/dev/null || date -u -d "@${at}" +%Y-%m-%dT%H:%M:%S.000Z
}

# ---------------------------------------------------------------------------
# Teardown
# ---------------------------------------------------------------------------
delete_instance() {
  mutate "$1" gcloud sql instances delete "$1" --project="${PROJECT}" --quiet \
    || warn "could not delete $1: run  scripts/restore-drill.sh teardown --project ${PROJECT} --name $1"
}

if [[ "${SUBCOMMAND}" == "teardown" ]]; then
  need gcloud "https://cloud.google.com/sdk/docs/install"
  if [[ -n "${TEARDOWN_NAME}" ]]; then
    assert_scratch "${TEARDOWN_NAME}"
    names="${TEARDOWN_NAME}"
  else
    run_capture names "" gcloud sql instances list --project="${PROJECT}" --filter='name~^mutaba3a-pg-drill-' --format='value(name)'
    [[ -n "${names}" ]] || { info "no drill scratch instances in ${PROJECT}"; exit 0; }
  fi
  for name in ${names}; do
    assert_scratch "${name}"
    if [[ -n "${TEARDOWN_NAME}" ]] || confirm "Delete scratch instance ${name}?"; then delete_instance "${name}"; fi
  done
  exit 0
fi

# ---------------------------------------------------------------------------
# Drill
# ---------------------------------------------------------------------------
need gcloud "https://cloud.google.com/sdk/docs/install"
need cloud-sql-proxy "brew install cloud-sql-proxy"
need psql "brew install libpq && brew link --force libpq"
need openssl "preinstalled on macOS"

# MUT-381: without --instance, drill the instance the API serves from, so a drill after the CMEK cutover
# tests mutaba3a-pg2's backups, not the frozen mutaba3a-pg.
if [[ -z "${SOURCE}" ]]; then
  if [[ "${DRY_RUN}" == 1 ]]; then
    printf '+ terraform output -raw cloud_sql_instance_name\n'
    SOURCE="<active-instance>"
  else
    need terraform "brew install terraform"
    SOURCE="$(tf_active_instance "${SERVER_DIR}/infrastructure/terraform" "${ENVIRONMENT:-production}")"
  fi
fi

STAMP="$(date -u +%Y%m%dt%H%M%S)"
SCRATCH_B="mutaba3a-pg-drill-${STAMP}-b"
SCRATCH_P="mutaba3a-pg-drill-${STAMP}-p"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/restore-drill-${STAMP}-XXXX")"
CREATED=()
PROXY_PIDS=()

cleanup() {
  local status=$?
  local pid name
  for pid in ${PROXY_PIDS[@]+"${PROXY_PIDS[@]}"}; do kill "${pid}" 2>/dev/null || true; done
  if [[ "${KEEP}" == 1 ]]; then
    for name in ${CREATED[@]+"${CREATED[@]}"}; do warn "kept ${name}; delete it with: scripts/restore-drill.sh teardown --project ${PROJECT} --name ${name}"; done
  else
    info "teardown"
    local started=${SECONDS}
    for name in ${CREATED[@]+"${CREATED[@]}"}; do delete_instance "${name}"; done
    [[ ${#CREATED[@]} -gt 0 ]] && info "teardown took $((SECONDS - started)) s"
  fi
  rm -rf "${WORK}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

info "project ${PROJECT}, source ${SOURCE} (read-only), scratch ${SCRATCH_B} / ${SCRATCH_P}"
[[ "${DRY_RUN}" == 1 ]] && info "dry run: commands are printed, nothing is called"

run_capture ACCOUNT "<you@example.com>" gcloud config get-value account
info "gcloud account: ${ACCOUNT}"

# CSV, not value(): read with a tab IFS collapses empty fields (an empty edition shifts every later one).
run_capture DESCRIBED '<region>,<tier>,<edition>,<disk-gb>,POSTGRES_16,True,<source-kms-key>' \
  gcloud sql instances describe "${SOURCE}" --project="${PROJECT}" \
  --format='csv[no-heading](region,settings.tier,settings.edition,settings.dataDiskSizeGb,databaseVersion,settings.backupConfiguration.pointInTimeRecoveryEnabled,diskEncryptionConfiguration.kmsKeyName)'
IFS=, read -r REGION TIER EDITION DISK_GB DB_VERSION PITR_ON KMS_KEY <<<"${DESCRIBED}"
# MUT-381: a copy of a CMEK instance stays under the same key (the point-in-time clone inherits it).
SCRATCH_KEY=()
[[ -n "${KMS_KEY}" ]] && SCRATCH_KEY=(--disk-encryption-key="${KMS_KEY}")
# describe says ENTERPRISE / ENTERPRISE_PLUS; create takes enterprise / enterprise-plus.
EDITION="$(printf '%s' "${EDITION:-ENTERPRISE}" | tr '[:upper:]_' '[:lower:]-')"
[[ "${PITR_ON}" == "True" || "${ONLY}" == "backup" ]] || die "point-in-time recovery is off on ${SOURCE}; nothing to drill (or use --only backup)"
info "source: ${DB_VERSION}, ${TIER} (${EDITION}), ${DISK_GB} GB, ${REGION}${KMS_KEY:+, encrypted with ${KMS_KEY}}"

COST_NOTE="a ${TIER} instance costs roughly \$0.05–0.10 an hour (twice that for the clone, which is REGIONAL like the source); teardown deletes it when the drill ends"

# Restore last night's automated backup into a fresh ZONAL scratch instance.
restore_backup() {
  run_capture BACKUP $'<backup-id>\t<window-start>' \
    gcloud sql backups list --instance="${SOURCE}" --project="${PROJECT}" \
    --filter='status=SUCCESSFUL AND type=AUTOMATED' --sort-by=~windowStartTime --limit=1 --format='value(id,windowStartTime)'
  IFS=$'\t' read -r BACKUP_ID BACKUP_AT <<<"${BACKUP}"
  [[ -n "${BACKUP_ID}" ]] || die "no successful automated backup of ${SOURCE}"
  info "last night's backup: ${BACKUP_ID} (window ${BACKUP_AT})"
  confirm "Create scratch instance ${SCRATCH_B} and restore backup ${BACKUP_ID} into it? (${COST_NOTE})" || die "stopped before creating anything"
  CREATED+=("${SCRATCH_B}")
  timed "Create scratch instance (backup)" mutate "${SCRATCH_B}" gcloud sql instances create "${SCRATCH_B}" --project="${PROJECT}" \
    --region="${REGION}" --database-version="${DB_VERSION}" --tier="${TIER}" --edition="${EDITION}" \
    --availability-type=zonal --storage-size="${DISK_GB}GB" --ssl-mode=ENCRYPTED_ONLY \
    --no-backup --no-deletion-protection --labels=purpose=restore-drill,source="${SOURCE}" \
    ${SCRATCH_KEY[@]+"${SCRATCH_KEY[@]}"} --quiet
  timed "Restore last night's backup" mutate "${SCRATCH_B}" gcloud sql backups restore "${BACKUP_ID}" \
    --restore-instance="${SCRATCH_B}" --backup-instance="${SOURCE}" --project="${PROJECT}" --quiet
}

# Clone the source as it was PITR_MINUTES ago into a second scratch instance.
restore_pitr() {
  PITR_AT="$(utc_minutes_ago "${PITR_MINUTES}")"
  confirm "Clone ${SOURCE} as of ${PITR_AT} into scratch instance ${SCRATCH_P}? (${COST_NOTE})" || die "stopped before the point-in-time clone"
  CREATED+=("${SCRATCH_P}")
  timed "Point-in-time clone (${PITR_MINUTES} min ago)" mutate "${SCRATCH_P}" gcloud sql instances clone "${SOURCE}" "${SCRATCH_P}" \
    --point-in-time="${PITR_AT}" --project="${PROJECT}" --quiet
  # The clone copies the source's settings: drop what would keep it around or make it back itself up.
  mutate "${SCRATCH_P}" gcloud sql instances patch "${SCRATCH_P}" --project="${PROJECT}" \
    --no-deletion-protection --no-backup --no-enable-point-in-time-recovery \
    --update-labels=purpose=restore-drill,source="${SOURCE}" --quiet
}

# open_copy <scratch> <port> <label>: throwaway password on the copy, a proxy, then the read-only checks.
open_copy() {
  local scratch="$1" port="$2" label="$3" password connection
  if [[ "${DRY_RUN}" == 1 ]]; then password="<random>"; else password="$(openssl rand -hex 24)"; fi
  assert_scratch "${scratch}"
  printf '+ gcloud sql users set-password %s --instance=%s --project=%s --password=<random> --quiet\n' "${DB_USER}" "${scratch}" "${PROJECT}"
  [[ "${DRY_RUN}" == 1 ]] || gcloud sql users set-password "${DB_USER}" --instance="${scratch}" --project="${PROJECT}" --password="${password}" --quiet
  run_capture connection "${PROJECT}:<region>:${scratch}" gcloud sql instances describe "${scratch}" --project="${PROJECT}" --format='value(connectionName)'
  printf '+ cloud-sql-proxy %s --port %s --quiet &\n' "${connection}" "${port}"
  if [[ "${DRY_RUN}" != 1 ]]; then
    db_start_proxy "${connection}" "${port}"
    PROXY_PIDS+=("${DB_PROXY_PID}")
  fi
  PGHOST=127.0.0.1 PGPORT="${port}" PGUSER="${DB_USER}" PGDATABASE="${DB_NAME}" PGPASSWORD="${password}" \
    PGOPTIONS='-c default_transaction_read_only=on' timed "Checks on the ${label} copy" check_copy "${label}"
}

check_copy() {
  local label="$1" migrations repo_migrations newest
  printf '+ psql (read-only, %s copy): exact row count of every table, migrations, newest audit event\n' "${label}"
  if [[ "${DRY_RUN}" == 1 ]]; then
    check_receipt "${label}"
    return 0
  fi
  db_table_counts "${WORK}/${label}.counts"
  migrations="$(db_sql -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
  repo_migrations="$(find "${SERVER_DIR}/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
  newest="$(db_sql -c 'SELECT max("createdAt") FROM audit_events')"
  info "${label}: $(wc -l <"${WORK}/${label}.counts" | tr -d ' ') tables, ${migrations} migrations applied (this checkout has ${repo_migrations}), newest audit event ${newest:-none}"
  check_receipt "${label}"
}

# The receipt row in the copy must point at an object in the bucket that is the file it describes.
check_receipt() {
  local label="$1" row id key size mime object_size magic expected
  local filter='status = '\''READY'\'' AND "deletedAt" IS NULL'
  [[ -n "${RECEIPT_ID}" ]] && filter+=" AND id = '${RECEIPT_ID}'"
  printf '+ psql (read-only, %s copy): SELECT id, "storageKey", "sizeBytes", "mimeType" FROM expense_receipts WHERE %s ORDER BY "completedAt" DESC NULLS LAST LIMIT 1\n' "${label}" "${filter}"
  if [[ "${DRY_RUN}" == 1 ]]; then
    printf '+ gcloud storage objects describe gs://%s/<storage-key> --format=value(size)\n' "${BUCKET}"
    printf '+ gcloud storage cp gs://%s/<storage-key> <work-dir>/%s.receipt\n' "${BUCKET}" "${label}"
    RECEIPT_RESULT+=("${label}: —")
    return 0
  fi
  row="$(db_sql -F $'\t' -c "SELECT id, \"storageKey\", \"sizeBytes\", \"mimeType\" FROM expense_receipts WHERE ${filter} ORDER BY \"completedAt\" DESC NULLS LAST LIMIT 1")"
  if [[ -z "${row}" ]]; then
    warn "${label}: no READY receipt${RECEIPT_ID:+ with id ${RECEIPT_ID}} in this copy"
    RECEIPT_RESULT+=("${label}: FAIL (no receipt row)")
    return 0
  fi
  IFS=$'\t' read -r id key size mime <<<"${row}"
  if ! object_size="$(gcloud storage objects describe "gs://${BUCKET}/${key}" --format='value(size)' 2>/dev/null)"; then
    warn "${label}: receipt ${id}: object gs://${BUCKET}/${key} is missing (runbook §4.4: soft-deleted objects)"
    RECEIPT_RESULT+=("${label}: FAIL (receipt ${id}: object missing)")
    return 0
  fi
  gcloud storage cp "gs://${BUCKET}/${key}" "${WORK}/${label}.receipt" --quiet >/dev/null 2>&1 || true
  magic="$(head -c 4 "${WORK}/${label}.receipt" 2>/dev/null | od -An -tx1 | tr -d ' \n')"
  case "${mime}" in
    application/pdf) expected="25504446" ;;
    image/png) expected="89504e47" ;;
    image/jpeg) expected="ffd8ff" ;;
    *) expected="" ;;
  esac
  rm -f "${WORK}/${label}.receipt"
  if [[ "${object_size}" == "${size}" && -n "${expected}" && "${magic}" == "${expected}"* ]]; then
    info "${label}: receipt ${id} opens (${mime}, ${size} bytes)"
    RECEIPT_RESULT+=("${label}: PASS (receipt ${id}, ${mime}, ${size} bytes)")
  else
    warn "${label}: receipt ${id}: row says ${mime}, ${size} bytes; object is ${object_size} bytes, starts ${magic:-<unreadable>}"
    RECEIPT_RESULT+=("${label}: FAIL (receipt ${id}: object does not match the row)")
  fi
}

RECEIPT_RESULT=()
DRILL_STARTED=${SECONDS}
if [[ "${ONLY}" != "pitr" ]]; then
  restore_backup
  open_copy "${SCRATCH_B}" 5451 backup
fi
if [[ "${ONLY}" != "backup" ]]; then
  restore_pitr
  open_copy "${SCRATCH_P}" 5452 pitr
fi

info "bucket soft-delete window (how long a deleted receipt's object can still be restored):"
run gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" --format='yaml(soft_delete_policy)' || warn "could not read the bucket's soft-delete policy"

# ---------------------------------------------------------------------------
# Results
# ---------------------------------------------------------------------------
if [[ "${DRY_RUN}" != 1 && -f "${WORK}/backup.counts" && -f "${WORK}/pitr.counts" ]]; then
  echo
  echo "| Table | Backup copy | PITR copy |"
  echo "|---|---:|---:|"
  LC_ALL=C join -t '|' -a 1 -a 2 -e '—' -o 0,1.2,2.2 <(LC_ALL=C sort "${WORK}/backup.counts") <(LC_ALL=C sort "${WORK}/pitr.counts") | awk -F'|' '{ printf "| %s | %s | %s |\n", $1, $2, $3 }'
  backup_audit="$(awk -F'|' '$1 == "audit_events" { print $2 }' "${WORK}/backup.counts")"
  pitr_audit="$(awk -F'|' '$1 == "audit_events" { print $2 }' "${WORK}/pitr.counts")"
  if (( pitr_audit >= backup_audit )); then
    info "audit_events: point in time ${pitr_audit} ≥ backup ${backup_audit} (append-only: the later copy has at least as many)"
  else
    warn "audit_events: point in time ${pitr_audit} < backup ${backup_audit}; the later copy lost audit rows. Stop and investigate"
  fi
fi

echo
echo "Drill results (paste into docs/operations/pilot-runbook.md §10):"
echo
echo "| Step | Seconds |"
echo "|---|---:|"
for i in "${!STEP_NAMES[@]}"; do echo "| ${STEP_NAMES[$i]} | ${STEP_SECONDS[$i]} |"; done
if [[ "${DRY_RUN}" == 1 ]]; then echo "| Whole drill (before teardown) | — |"; else echo "| Whole drill (before teardown) | $((SECONDS - DRILL_STARTED)) |"; fi
echo
for line in ${RECEIPT_RESULT[@]+"${RECEIPT_RESULT[@]}"}; do echo "- Receipt check, ${line}"; done
