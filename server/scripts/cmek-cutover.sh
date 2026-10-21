#!/usr/bin/env bash
# Mutaba3a API — move the database onto our own KMS key (MUT-381, ADR-163). The operator runs this;
# nothing in CI does. Cloud SQL can't add a key to an existing instance, so Terraform (cmek_stage =
# "prepared") creates mutaba3a-pg2 with the key, and this script fills it from a fresh backup of
# mutaba3a-pg. DEPLOYMENT.md §6d is the whole procedure; this is its tested core.
#
#   scripts/cmek-cutover.sh rehearse --project <id> [--dry-run]
#       fresh backup of mutaba3a-pg → restore into mutaba3a-pg2 → key check → row counts → timings.
#       The API stays open; run it before the cutover to learn how long the window will be.
#   scripts/cmek-cutover.sh cutover --project <id> [--yes] [--dry-run]
#       close the API to outside traffic → the same copy → every table's count must match mutaba3a-pg's
#       → prints the switch apply. Any failure or mismatch reopens the API on mutaba3a-pg.
#   scripts/cmek-cutover.sh verify --project <id> [--dry-run]
#       after the switch apply: terraform serves from mutaba3a-pg2, the serving revision mounts it, the key
#       is set; once ingress is open again (second apply), /ready answers.
#
# Safety:
#   * The only instance any command creates, changes or deletes is mutaba3a-pg2 (`mutate` refuses any
#     other name). mutaba3a-pg is only read, and backed up.
#   * Once cutover has closed ingress, every exit path reopens it on mutaba3a-pg (the EXIT trap), until
#     the counts match and the switch apply is printed. From then on the API stays closed until the
#     operator applies the switch or reopens it by hand (the printed rollback).
#   * It refuses to run once terraform serves from mutaba3a-pg2: a second copy would overwrite live data.
#   * Database credentials come from terraform state (TF_STATE_BUCKET), as scripts/db.sh reads them.
#
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no mapfile.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${SERVER_DIR}/infrastructure/terraform"
ENVIRONMENT="${ENVIRONMENT:-production}"
REGION="${GCP_REGION:-me-west1}"
# Production only: the names below carry no environment suffix (main.tf's local.suffix).
SOURCE="mutaba3a-pg"
TARGET="mutaba3a-pg2"
SERVICE="mutaba3a-api"
PORT_SOURCE="${PROXY_PORT_SOURCE:-5461}"
PORT_TARGET="${PROXY_PORT_TARGET:-5462}"
# Seconds between closing ingress and the backup, for requests already in flight to finish.
DRAIN_SECONDS="${DRAIN_SECONDS:-15}"

SUBCOMMAND=""
PROJECT="${GCP_PROJECT_ID:-}"
DRY_RUN=0
YES=0

info() { printf '\033[0;36m[cmek]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[cmek] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[0;31m[cmek] %s\033[0m\n' "$*" >&2; exit 1; }

# shellcheck source-path=SCRIPTDIR source=lib/script-helpers.sh
. "${SERVER_DIR}/scripts/lib/script-helpers.sh"
# shellcheck source-path=SCRIPTDIR source=lib/db-checks.sh
. "${SERVER_DIR}/scripts/lib/db-checks.sh"

usage() {
  cat >&2 <<EOF
usage: scripts/cmek-cutover.sh rehearse|cutover|verify --project <id> [--yes] [--dry-run]

  rehearse    copy a fresh backup of ${SOURCE} into ${TARGET}; the API stays open
  cutover     close the API, copy, match every table's count, print the switch apply
  verify      after the switch apply: ${TARGET} serves, under its key; /ready once ingress is open
  --project   GCP project (or GCP_PROJECT_ID)
  --yes       don't ask before closing the API (cutover)
  --dry-run   print every command, run nothing

Needs TF_STATE_BUCKET (except --dry-run). The whole procedure: server/DEPLOYMENT.md §6d.
EOF
}

case "${1:-}" in
  rehearse|cutover|verify) SUBCOMMAND="$1"; shift ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) PROJECT="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
done
[[ -n "${SUBCOMMAND}" && -n "${PROJECT}" ]] || { usage; exit 2; }
[[ "${ENVIRONMENT}" == "production" ]] || die "ENVIRONMENT=${ENVIRONMENT}: this script only knows production's instance and service names"

# ---------------------------------------------------------------------------
# Command helpers (the drill's shape: scripts/restore-drill.sh)
# ---------------------------------------------------------------------------
# run, run_capture, confirm, need, timed: lib/script-helpers.sh

# mutate <target instance> <command...>: the only way this script creates, changes or deletes an instance.
mutate() {
  local target="$1"; shift
  [[ "${target}" == "${TARGET}" ]] || die "refusing: ${target} is not ${TARGET}; this script changes no other instance"
  run "$@"
}

set_ingress() {
  run gcloud run services update "${SERVICE}" --region="${REGION}" --project="${PROJECT}" --ingress="$1" --quiet
}

# ---------------------------------------------------------------------------
# Terraform state: which instance serves, and the API user's credentials
# ---------------------------------------------------------------------------
ACTIVE=""
DB_URL=""
read_state() {
  if [[ "${DRY_RUN}" == 1 ]]; then
    printf '+ terraform output -raw cloud_sql_instance_name\n+ terraform output -raw local_database_url\n'
    ACTIVE="${SOURCE}"
    [[ "${SUBCOMMAND}" == "verify" ]] && ACTIVE="${TARGET}"
    DB_URL="postgresql://<user>:<password>@127.0.0.1:5440/mutaba3a"
    return 0
  fi
  local rc=0
  tf_init "${TF_DIR}" "${ENVIRONMENT}"
  ACTIVE="$(tf_output "${TF_DIR}" cloud_sql_instance_name)" || rc=$?
  case "${rc}" in
    0) ;;
    3) warn "terraform state has no cloud_sql_instance_name output yet (no apply since MUT-381): ${SOURCE} serves"
       ACTIVE="${SOURCE}" ;;
    *) exit 1 ;; # tf_output said why
  esac
  DB_URL="$(tf_output "${TF_DIR}" local_database_url)" || die "no local_database_url output in terraform state"
}

# read_serving <placeholder mounts>: what Cloud Run actually serves. Sets REVISION PERCENT LATEST INGRESS URL
# and MOUNTS (the Cloud SQL instances the serving revision mounts). Terraform state says what should serve;
# this is the ground truth a copy must never contradict.
read_serving() {
  run_capture SERVING $'<revision>\t100\t<revision>\t<ingress>\t<service-url>' \
    gcloud run services describe "${SERVICE}" --region="${REGION}" --project="${PROJECT}" \
    --format='value(status.traffic[0].revisionName,status.traffic[0].percent,status.latestReadyRevisionName,metadata.annotations."run.googleapis.com/ingress",status.url)'
  IFS=$'\t' read -r REVISION PERCENT LATEST INGRESS URL <<<"${SERVING}"
  run_capture MOUNTS "$1" gcloud run revisions describe "${REVISION}" --region="${REGION}" --project="${PROJECT}" \
    --format='value(metadata.annotations."run.googleapis.com/cloudsql-instances")'
  [[ -n "${MOUNTS}" ]] || die "could not read which Cloud SQL instance revision ${REVISION} mounts; stopping rather than guess"
}

# with_db <port> <command...>: run a read-only command as the API user against the proxy on <port>.
with_db() {
  local port="$1"; shift
  [[ "${DB_URL}" =~ ^postgresql://([^:]+):([^@]+)@[^/]+/([^?]+) ]] || die "unexpected local_database_url shape"
  PGHOST=127.0.0.1 PGPORT="${port}" PGUSER="${BASH_REMATCH[1]}" PGPASSWORD="${BASH_REMATCH[2]}" \
    PGDATABASE="${BASH_REMATCH[3]}" PGOPTIONS='-c default_transaction_read_only=on' "$@"
}

# open_proxy <connection> <port>: a cloud-sql-proxy on <port>, once per port.
OPEN_PORTS=" "
open_proxy() {
  local connection="$1" port="$2"
  [[ "${OPEN_PORTS}" == *" ${port} "* ]] && return 0
  printf '+ cloud-sql-proxy %s --port %s --quiet &\n' "${connection}" "${port}"
  OPEN_PORTS+="${port} "
  [[ "${DRY_RUN}" == 1 ]] && return 0
  db_start_proxy "${connection}" "${port}"
  PROXY_PIDS+=("${DB_PROXY_PID}")
}

# count_rows <connection> <port> <label>: proxy to one instance, write WORK/<label>.counts.
count_rows() {
  local connection="$1" port="$2" label="$3"
  open_proxy "${connection}" "${port}"
  printf '+ psql (read-only, %s): exact row count of every table\n' "${label}"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  with_db "${port}" db_table_counts "${WORK}/${label}.counts"
}

# source_writes <var>: mutaba3a-pg's write counters (lib/db-checks.sh db_write_counters).
source_writes() {
  open_proxy "${SOURCE_CONN}" "${PORT_SOURCE}"
  printf '+ psql (read-only, %s): rows inserted, updated, deleted (pg_stat_database)\n' "${SOURCE}"
  if [[ "${DRY_RUN}" == 1 ]]; then printf -v "$1" '%s' "<writes>"; return 0; fi
  printf -v "$1" '%s' "$(with_db "${PORT_SOURCE}" db_write_counters)"
}

# expect_closed <when>: the live service must report internal ingress.
expect_closed() {
  local live
  run_capture live "internal" gcloud run services describe "${SERVICE}" --region="${REGION}" --project="${PROJECT}" \
    --format='value(metadata.annotations."run.googleapis.com/ingress")'
  [[ "${live}" == "internal" ]] || die "${1}: ingress still reports ${live:-nothing}, so ${SOURCE} may be taking writes; ${SERVICE} goes back to ${SOURCE}"
}

describe_target() {
  # CSV, not value(): read with a tab IFS collapses an empty leading field, so a missing key would read as
  # the disk size. A comma IFS keeps empty fields.
  run_capture TARGET_DESCRIBED "<kms-key>,<target-gb>,<project>:<region>:${TARGET},<kms-key-version>" \
    gcloud sql instances describe "${TARGET}" --project="${PROJECT}" \
    --format='csv[no-heading](diskEncryptionConfiguration.kmsKeyName,settings.dataDiskSizeGb,connectionName,diskEncryptionStatus.kmsKeyVersionName)' \
    || TARGET_DESCRIBED=""
  IFS=, read -r TARGET_KEY TARGET_GB TARGET_CONN TARGET_KEY_VERSION <<<"${TARGET_DESCRIBED}" || true
  [[ -n "${TARGET_KEY:-}" ]] || die "${TARGET} doesn't exist or has no key: set cmek_stage = \"prepared\" in ${ENVIRONMENT}.tfvars and apply first (DEPLOYMENT.md §6d)"
}

# ---------------------------------------------------------------------------
# Cleanup: proxies, the work dir, and ingress (C4)
# ---------------------------------------------------------------------------
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cmek-cutover-XXXX")"
PROXY_PIDS=()
INGRESS_CLOSED=0
SWITCH_READY=0
cleanup() {
  local status=$? pid
  trap '' INT TERM # a second Ctrl-C must not abort the reopen below
  for pid in ${PROXY_PIDS[@]+"${PROXY_PIDS[@]}"}; do kill "${pid}" 2>/dev/null || true; done
  if [[ "${INGRESS_CLOSED}" == 1 && "${SWITCH_READY}" != 1 ]]; then
    warn "stopped before the switch: reopening ${SERVICE} on ${SOURCE}"
    set_ingress all || warn "could not reopen: run  gcloud run services update ${SERVICE} --region=${REGION} --project=${PROJECT} --ingress=all"
  fi
  rm -rf "${WORK}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

need gcloud "https://cloud.google.com/sdk/docs/install"
need terraform "brew install terraform"
[[ "${DRY_RUN}" == 1 ]] && info "dry run: commands are printed, nothing is called"

# ---------------------------------------------------------------------------
# verify
# ---------------------------------------------------------------------------
if [[ "${SUBCOMMAND}" == "verify" ]]; then
  read_state
  [[ "${ACTIVE}" == "${TARGET}" ]] || die "terraform still serves from ${ACTIVE}: set cmek_stage = \"active\" and run the switch apply first (DEPLOYMENT.md §6d)"
  describe_target
  read_serving "${TARGET_CONN}"
  [[ "${PERCENT}" == "100" && "${REVISION}" == "${LATEST}" ]] || die "traffic is not 100% on the latest ready revision (${REVISION} ${PERCENT}%, latest ${LATEST}); wait for the rollout, then verify again"
  [[ ",${MOUNTS}," == *",${TARGET_CONN},"* ]] || die "the serving revision ${REVISION} mounts ${MOUNTS}, not ${TARGET_CONN}"
  # The probes only hit /health, so a revision with the wrong DATABASE_URL still turns Ready. Check the
  # secret's host without ever printing the URL (it carries the password).
  run_capture SECRET_URL "host=/cloudsql/${TARGET_CONN}&" gcloud secrets versions access latest \
    --secret="mutaba3a-api-database-url" --project="${PROJECT}"
  SECRET_CONN="${SECRET_URL#*host=/cloudsql/}"
  SECRET_CONN="${SECRET_CONN%%&*}"
  unset SECRET_URL
  [[ "${SECRET_CONN}" == "${TARGET_CONN}" ]] || die "the DATABASE_URL secret points at ${SECRET_CONN}, not ${TARGET_CONN}: re-run the switch apply before reopening"
  info "${REVISION} serves 100% from ${TARGET_CONN}, encrypted with ${TARGET_KEY}"
  if [[ "${INGRESS}" == "all" ]]; then
    run curl -fsS "${URL}/ready" -o /dev/null || die "${URL}/ready did not answer 200"
    info "verify passed: ${URL}/ready answers; finish with the smoke checks (DEPLOYMENT.md §6d)"
  else
    info "verify passed while ingress is ${INGRESS}: run the second apply (without api_ingress) to reopen, then verify again to check /ready"
  fi
  exit 0
fi

# ---------------------------------------------------------------------------
# rehearse / cutover
# ---------------------------------------------------------------------------
need cloud-sql-proxy "brew install cloud-sql-proxy"
need psql "brew install libpq && brew link --force libpq"

read_state
[[ "${ACTIVE}" != "${TARGET}" ]] || die "terraform already serves from ${TARGET}: copying again would overwrite live data. Nothing to do."

describe_target
run_capture SOURCE_DESCRIBED $'<source-gb>\t<project>:<region>:'"${SOURCE}" \
  gcloud sql instances describe "${SOURCE}" --project="${PROJECT}" --format='value(settings.dataDiskSizeGb,connectionName)'
IFS=$'\t' read -r SOURCE_GB SOURCE_CONN <<<"${SOURCE_DESCRIBED}"
info "${SOURCE} (${SOURCE_GB} GB) → ${TARGET} (${TARGET_GB} GB, key ${TARGET_KEY})"

# Fix 1 (review): terraform state is not enough. If the serving revision mounts mutaba3a-pg2, it is live.
read_serving "<project>:<region>:${SOURCE}"
[[ ",${MOUNTS}," != *",${TARGET_CONN},"* ]] \
  || die "${SERVICE} serves from ${TARGET_CONN} (revision ${REVISION}): copying again would overwrite live data. Nothing to do."

# C2: a backup restores only into an instance with at least the source's storage.
if [[ "${DRY_RUN}" != 1 ]] && (( TARGET_GB < SOURCE_GB )); then
  die "${TARGET} has ${TARGET_GB} GB but ${SOURCE} has ${SOURCE_GB} GB; grow it first: gcloud sql instances patch ${TARGET} --project=${PROJECT} --storage-size=${SOURCE_GB}GB"
fi

STAMP="$(date -u +%Y%m%dt%H%M%S)"
STARTED=${SECONDS}

if [[ "${SUBCOMMAND}" == "rehearse" ]]; then
  confirm "Overwrite ${TARGET} with a fresh copy of ${SOURCE}? (the API stays open)" || die "stopped before copying anything"
fi

if [[ "${SUBCOMMAND}" == "cutover" ]]; then
  confirm "Close ${SERVICE} to outside traffic (portal, phones, Malafat) and copy ${SOURCE} into ${TARGET}?" || die "stopped before closing anything"
  INGRESS_CLOSED=1
  timed "Close ingress" set_ingress internal
  # Fix 2 (review): requests already in flight finish, the close must have taken, and from here on
  # mutaba3a-pg's write counters must not move. Row counts alone can't see an UPDATE.
  [[ "${DRY_RUN}" == 1 ]] || sleep "${DRAIN_SECONDS}"
  expect_closed "after closing"
  source_writes WRITES_BEFORE
fi

timed "On-demand backup of ${SOURCE}" run gcloud sql backups create --instance="${SOURCE}" --project="${PROJECT}" \
  --description="mut-381-${SUBCOMMAND}-${STAMP}" --quiet
run_capture BACKUP_ID "<backup-id>" gcloud sql backups list --instance="${SOURCE}" --project="${PROJECT}" \
  --filter="description=mut-381-${SUBCOMMAND}-${STAMP}" --limit=1 --format='value(id)'
[[ -n "${BACKUP_ID}" ]] || die "could not find the backup just taken (description mut-381-${SUBCOMMAND}-${STAMP})"

timed "Restore into ${TARGET}" mutate "${TARGET}" gcloud sql backups restore "${BACKUP_ID}" \
  --restore-instance="${TARGET}" --backup-instance="${SOURCE}" --project="${PROJECT}" --quiet

# The restore must leave the target under its own key.
KEY_BEFORE="${TARGET_KEY}"
describe_target
[[ "${TARGET_KEY}" == "${KEY_BEFORE}" && -n "${TARGET_KEY_VERSION:-}" ]] \
  || die "after the restore ${TARGET} reports key '${TARGET_KEY}' (version '${TARGET_KEY_VERSION:-}'), expected ${KEY_BEFORE}"
info "${TARGET} is encrypted with ${TARGET_KEY_VERSION}"

timed "Row counts on ${TARGET}" count_rows "${TARGET_CONN}" "${PORT_TARGET}" target
# rehearse counts the source too, so its timings match the cutover's window; only cutover compares.
timed "Row counts on ${SOURCE}" count_rows "${SOURCE_CONN}" "${PORT_SOURCE}" source
if [[ "${SUBCOMMAND}" == "cutover" ]]; then
  # Ingress is closed, so mutaba3a-pg has not changed since the backup: every count must match.
  if [[ "${DRY_RUN}" != 1 ]]; then
    if ! diff "${WORK}/source.counts" "${WORK}/target.counts" >"${WORK}/counts.diff"; then
      warn "row counts differ (< ${SOURCE}, > ${TARGET}):"
      cat "${WORK}/counts.diff" >&2
      die "the copy doesn't match; ${SERVICE} goes back to ${SOURCE}"
    fi
    info "every table matches ($(wc -l <"${WORK}/target.counts" | tr -d ' ') tables)"
  fi
  source_writes WRITES_AFTER
  [[ "${WRITES_AFTER}" == "${WRITES_BEFORE}" ]] \
    || die "${SOURCE} recorded writes during the copy (inserted,updated,deleted ${WRITES_BEFORE} → ${WRITES_AFTER}); the copy may miss them, so ${SERVICE} goes back to ${SOURCE}"
  info "${SOURCE} recorded no writes during the copy (${WRITES_BEFORE})"
fi

echo
echo "Results (paste into docs/operations/pilot-runbook.md §10):"
echo
echo "| Step | Seconds |"
echo "|---|---:|"
for i in "${!STEP_NAMES[@]}"; do echo "| ${STEP_NAMES[$i]} | ${STEP_SECONDS[$i]} |"; done
if [[ "${DRY_RUN}" == 1 ]]; then echo "| Whole ${SUBCOMMAND} | — |"; else echo "| Whole ${SUBCOMMAND} | $((SECONDS - STARTED)) |"; fi
if [[ "${DRY_RUN}" != 1 && -f "${WORK}/target.counts" ]]; then
  echo
  echo "| Table | Rows in ${TARGET} |"
  echo "|---|---:|"
  awk -F'|' '{ printf "| %s | %s |\n", $1, $2 }' "${WORK}/target.counts"
fi

[[ "${SUBCOMMAND}" == "rehearse" ]] && exit 0

run_capture IMAGE "<registry>/mutaba3a-api:<live-tag>" gcloud run services describe "${SERVICE}" --region="${REGION}" \
  --project="${PROJECT}" --format='value(spec.template.spec.containers[0].image)'
expect_closed "before the switch"
[[ "${IMAGE}" != *@* ]] || die "${SERVICE} runs a digest-pinned image (${IMAGE}); the switch apply needs the image tag deploy.sh pushed"
IMAGE_TAG="${IMAGE##*:}"
SWITCH_READY=1
cat <<EOF

${TARGET} holds a verified copy. ${SERVICE} stays closed until you finish (DEPLOYMENT.md §6d):

  1. The switch, ingress still closed:
       terraform apply -var-file=${ENVIRONMENT}.tfvars -var image_tag=${IMAGE_TAG} -var cmek_stage=active -var api_ingress=INGRESS_TRAFFIC_INTERNAL_ONLY
  2. scripts/cmek-cutover.sh verify --project ${PROJECT}
  3. Only now, in infrastructure/terraform/${ENVIRONMENT}.tfvars set: cmek_stage = "active"
     (until then a release is refused, so nothing switches or reopens behind your back)
  4. Reopen:
       terraform apply -var-file=${ENVIRONMENT}.tfvars -var image_tag=${IMAGE_TAG} -var cmek_stage=active
  5. scripts/cmek-cutover.sh verify --project ${PROJECT}   (checks /ready), then DEPLOYMENT.md §6d step 5.

Roll back before step 2 (nothing moved yet):
  gcloud run services update ${SERVICE} --region=${REGION} --project=${PROJECT} --ingress=all
EOF
