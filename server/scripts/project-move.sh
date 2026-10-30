#!/usr/bin/env bash
# MTB3A API: move production from one GCP project to another (MUT-487, ADR-232). The operator runs this; nothing in
# CI does. DEPLOYMENT.md §6d is the whole procedure, in order; this is its tested core. Every subcommand checks its own
# preconditions and is safe to run again; there is no hidden state between them. The same steps with --from and --to
# swapped are the rollback.
#
#   scripts/project-move.sh secrets       --from <old> --to <new>
#       Moves the five generated random_passwords from the old stack's state into the new one's (a copy of the old
#       state is edited; only the new state is pushed), then checks the new stack's plan keeps all five.
#   scripts/project-move.sh secret-values --from <old> --to <new> [--rotate]
#       The operator-set secrets (Stripe, Resend, Turnstile) into the new project, through a pipe; --rotate asks for
#       new values instead (R7). Also copies the forwarder token from the production project into the legacy one.
#   scripts/project-move.sh images        --from <old> --to <new> [--count 3 | --tags a,b,c]
#       Copies the newest release images, tag by tag, so rollback.sh works in the new project. Never over a tag.
#   scripts/project-move.sh rehearse      --from <old> --to <new>
#       copy + verify against a target that isn't live, with the source still open: times the window. Mismatches are
#       reported, not fatal (the source keeps changing).
#   scripts/project-move.sh freeze        --from <old> --to <new>
#       Closes the source: ingress internal, every Scheduler job paused, then its write counters must hold still.
#   scripts/project-move.sh copy          --from <old> --to <new> [--rollback]
#       Source frozen, target not live: on-demand backup, cross-project restore, the API user's password set to the
#       target's, receipts rsynced (deletions too), then verify.
#   scripts/project-move.sh verify        --from <old> --to <new>
#       Row counts and a per-table checksum on both databases, every receipt object present, one signed-URL download.
#   scripts/project-move.sh open          --from <old> --to <new> [--rollback]
#       verify again, then the target's apply with api_public, scheduler and the live label on; /ready must answer.
#   scripts/project-move.sh forward       --from <old> --to <new>
#       The old project's apply as the legacy forwarder to the new service (D7: this is what brings users back).
#
# Options: --yes (no prompts), --dry-run (print every command, call nothing), --from-region / --to-region (MUT-523:
# optional, they may only restate config/gcp.json).
# Projects and their files come from config/gcp.json: its `project` uses production.tfvars, its `legacyProject`
# legacy.tfvars. MUT-523: so do their regions (`region`, `legacyRegion`): mtb3a-production is in europe-west1 and
# malafat-production in me-west1, and every gcloud call, registry and connection name uses its own project's region.
# Each stack's tfvars must set the same `region`. GCP_ACCOUNT / GCP_ADC_FILE (deploy.env) set who this run acts as,
# for this process only (lib/gcp-identity.sh). State buckets default to <project>-terraform-state; FROM_STATE_BUCKET / TO_STATE_BUCKET override.
# Secret values never reach argv or the terminal: they go through pipes and files in a private work dir.
#
# Bash 3.2 compatible (macOS /bin/bash): no associative arrays, no mapfile.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${MOVE_TF_DIR:-${SERVER_DIR}/infrastructure/terraform}"
GCP_CONFIG="${GCP_CONFIG:-${SERVER_DIR}/../config/gcp.json}"
SERVICE="mutaba3a-api"
INSTANCE="mutaba3a-pg"
DB_USER="mutaba3a_api"
STATE_PREFIX="mutaba3a-api/production"
PORT_FROM="${PROXY_PORT_SOURCE:-5471}"
PORT_TO="${PROXY_PORT_TARGET:-5472}"
# Seconds for in-flight requests to finish and for Postgres to flush its write counters (up to ~10 s on idle).
DRAIN_SECONDS="${DRAIN_SECONDS:-15}"
# R1: the generated secrets the new state takes over byte for byte (R7 then rotates db, admin_token, job_token).
GENERATED="db admin_token session_pepper job_token oauth_derive_key"
# AM10: the secrets Basel sets by hand, never Terraform.
OPERATOR_SECRETS="mutaba3a-api-stripe-secret-key mutaba3a-api-stripe-webhook-secret mutaba3a-api-resend-api-key mutaba3a-api-resend-webhook-secret mutaba3a-api-turnstile-secret"
FORWARDER_SECRET="mutaba3a-api-forwarder-token"
LIVE_LABEL="mtb3a-live"

SUBCOMMAND=""
FROM=""
TO=""
DRY_RUN=0
YES=0
ROLLBACK=0
ROTATE=0
IMAGE_COUNT=3
IMAGE_TAGS=""
FROM_REGION_FLAG=""
TO_REGION_FLAG=""

info() { printf '\033[0;36m[move]\033[0m %s\n' "$*"; }
warn() { printf '\033[0;33m[move] %s\033[0m\n' "$*" >&2; }
die()  { printf '\033[0;31m[move] %s\033[0m\n' "$*" >&2; exit 1; }

# shellcheck source-path=SCRIPTDIR source=lib/script-helpers.sh
. "${SERVER_DIR}/scripts/lib/script-helpers.sh"
# shellcheck source-path=SCRIPTDIR source=lib/db-checks.sh
. "${SERVER_DIR}/scripts/lib/db-checks.sh"
# shellcheck source-path=SCRIPTDIR source=lib/legacy-stack.sh
. "${SERVER_DIR}/scripts/lib/legacy-stack.sh"
# shellcheck source-path=SCRIPTDIR source=lib/gcp-identity.sh
. "${SERVER_DIR}/scripts/lib/gcp-identity.sh"

usage() {
  cat >&2 <<EOF
usage: scripts/project-move.sh <step> --from <project> --to <project> [--from-region R] [--to-region R] [--yes] [--dry-run]

  steps (DEPLOYMENT.md §6d gives the order): secrets, secret-values [--rotate], images [--count N | --tags a,b],
         rehearse, freeze, copy [--rollback], verify, open [--rollback], forward
  --rollback  copy/open may target the old project's forwarder (the move run backwards)
  --from-region, --to-region  restate config/gcp.json's region for each project; a different one is refused
EOF
}

case "${1:-}" in
  secrets|secret-values|images|rehearse|freeze|copy|verify|open|forward) SUBCOMMAND="$1"; shift ;;
esac
while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM="${2:-}"; shift 2 ;;
    --to) TO="${2:-}"; shift 2 ;;
    --from-region) FROM_REGION_FLAG="${2:-}"; shift 2 ;;
    --to-region) TO_REGION_FLAG="${2:-}"; shift 2 ;;
    --yes) YES=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --rollback) ROLLBACK=1; shift ;;
    --rotate) ROTATE=1; shift ;;
    --count) IMAGE_COUNT="${2:-}"; shift 2 ;;
    --tags) IMAGE_TAGS="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; die "unknown option: $1" ;;
  esac
done
[[ -n "${SUBCOMMAND}" && -n "${FROM}" && -n "${TO}" ]] || { usage; exit 2; }
[[ "${FROM}" != "${TO}" ]] || die "--from and --to are the same project (${FROM})"
[[ "${IMAGE_COUNT}" =~ ^[1-9][0-9]*$ ]] || die "--count takes a number of images"
[[ "${PORT_FROM}" != "${PORT_TO}" ]] || die "PROXY_PORT_SOURCE and PROXY_PORT_TARGET must differ"

use_gcp_identity
WORK="$(mktemp -d "${TMPDIR:-/tmp}/project-move-XXXX")"
chmod 700 "${WORK}"
PROXY_PIDS=()
cleanup() {
  local status=$? pid
  for pid in ${PROXY_PIDS[@]+"${PROXY_PIDS[@]}"}; do kill "${pid}" 2>/dev/null || true; done
  rm -rf "${WORK}"
  exit "${status}"
}
trap cleanup EXIT
trap 'exit 130' INT TERM
[[ "${DRY_RUN}" == 1 ]] && info "dry run: commands are printed, nothing is called"
need gcloud "https://cloud.google.com/sdk/docs/install"
need terraform "brew install terraform"
need node "node 22"

# ---------------------------------------------------------------------------
# Which project is which (config/gcp.json)
# ---------------------------------------------------------------------------
[[ -f "${GCP_CONFIG}" ]] || die "missing ${GCP_CONFIG}"
# shellcheck disable=SC2016 # ${…} is a JavaScript template literal
read -r LIVE_PROJECT LEGACY_PROJECT <<<"$(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).production || {};
  process.stdout.write(`${c.project || "-"} ${c.legacyProject || "-"}`);' "${GCP_CONFIG}")"
for p in "${FROM}" "${TO}"; do
  [[ "${p}" == "${LIVE_PROJECT}" || "${p}" == "${LEGACY_PROJECT}" ]] \
    || die "${p} is neither config/gcp.json's project (${LIVE_PROJECT}) nor its legacyProject (${LEGACY_PROJECT})"
done

# tfvars_of <project>: the git-ignored tfvars that stack is applied with.
tfvars_of() { if [[ "$1" == "${LIVE_PROJECT}" ]]; then printf 'production.tfvars'; else printf 'legacy.tfvars'; fi; }

# MUT-523: each project's region, from config/gcp.json. A --from-region/--to-region may restate it, never change it,
# and each stack's tfvars must set the same `region` (Terraform has no default): checked here, before any call.
FROM_REGION="$(gcp_region_of "${GCP_CONFIG}" production "${FROM}")"
TO_REGION="$(gcp_region_of "${GCP_CONFIG}" production "${TO}")"
[[ -n "${FROM_REGION}" ]] || die "config/gcp.json names no region for ${FROM} (${GCP_CONFIG})"
[[ -n "${TO_REGION}" ]] || die "config/gcp.json names no region for ${TO} (${GCP_CONFIG})"
[[ -z "${FROM_REGION_FLAG}" || "${FROM_REGION_FLAG}" == "${FROM_REGION}" ]] \
  || die "--from-region ${FROM_REGION_FLAG}, but config/gcp.json puts ${FROM} in ${FROM_REGION}"
[[ -z "${TO_REGION_FLAG}" || "${TO_REGION_FLAG}" == "${TO_REGION}" ]] \
  || die "--to-region ${TO_REGION_FLAG}, but config/gcp.json puts ${TO} in ${TO_REGION}"
# region_of <project>: FROM's or TO's region.
region_of() { if [[ "$1" == "${FROM}" ]]; then printf '%s' "${FROM_REGION}"; else printf '%s' "${TO_REGION}"; fi; }
for p in "${FROM}" "${TO}"; do
  vars="${TF_DIR}/$(tfvars_of "${p}")"
  [[ -f "${vars}" ]] || continue
  named="$(sed -n 's/^[[:space:]]*region[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "${vars}" | head -1)"
  [[ -n "${named}" ]] || die "$(tfvars_of "${p}") sets no region: add region = \"$(region_of "${p}")\" (Terraform has no default region; MUT-523)"
  [[ "${named}" == "$(region_of "${p}")" ]] \
    || die "$(tfvars_of "${p}") sets region = \"${named}\", but config/gcp.json puts ${p} in $(region_of "${p}"); nothing done"
done
info "regions: ${FROM} in ${FROM_REGION}, ${TO} in ${TO_REGION}; identity: $(gcp_identity_summary)"
bucket_of() { if [[ "$1" == "${FROM}" ]]; then printf '%s' "${FROM_STATE_BUCKET:-$1-terraform-state}"; else printf '%s' "${TO_STATE_BUCKET:-$1-terraform-state}"; fi; }
attachments_of() { printf '%s-mutaba3a-attachments' "$1"; }
registry_of() { printf '%s-docker.pkg.dev/%s/mutaba3a/mutaba3a-api' "$(region_of "$1")" "$1"; }

# tf <project> <terraform args…>: terraform in that project's own data dir (AM8), never the other's.
tf() {
  local project="$1"; shift
  (cd "${TF_DIR}" && TF_DATA_DIR="${TF_DIR}/.terraform-${project}" terraform "$@")
}
INITIALISED=" "
tf_ready() {
  local project="$1" vars
  vars="${TF_DIR}/$(tfvars_of "${project}")"
  [[ "${DRY_RUN}" == 1 || -f "${vars}" ]] || die "missing ${vars} (copy $(tfvars_of "${project}")).example)"
  if [[ "${DRY_RUN}" != 1 && -f "${vars}" ]]; then
    local named
    named="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "${vars}" | head -1)"
    [[ "${named}" == "${project}" ]] || die "${vars} names project_id \"${named}\", not ${project}"
  fi
  [[ "${INITIALISED}" == *" ${project} "* ]] && return 0
  run tf "${project}" init -reconfigure -input=false -backend-config="bucket=$(bucket_of "${project}")" \
    -backend-config="prefix=${STATE_PREFIX}" >/dev/null || die "terraform init failed for ${project} (bucket $(bucket_of "${project}"))"
  INITIALISED+="${project} "
}

# ---------------------------------------------------------------------------
# Cloud Run: what serves, and is it live
# ---------------------------------------------------------------------------
# describe_service <project>: sets SVC_URL SVC_IMAGE SVC_LIVE (the mtb3a-live label) SVC_ARGS SVC_INGRESS.
describe_service() {
  local described
  run_capture described $'https://<service>.a.run.app\t<registry>/mutaba3a-api:<tag>\t<label>\t<args>\tall' \
    gcloud run services describe "${SERVICE}" --region="$(region_of "$1")" --project="$1" \
    --format="value(status.url,spec.template.spec.containers[0].image,metadata.labels.${LIVE_LABEL},spec.template.spec.containers[0].args.list(),metadata.annotations.\"run.googleapis.com/ingress-status\")" \
    || die "could not read ${SERVICE} in $1"
  # A tab IFS collapses empty fields (no label, no args): read on a separator that isn't whitespace.
  IFS='|' read -r SVC_URL SVC_IMAGE SVC_LIVE SVC_ARGS SVC_INGRESS <<<"${described//$'\t'/|}" || true
  [[ -n "${SVC_URL:-}" ]] || die "${SERVICE} in $1 has no URL: is it deployed?"
}

is_forwarder() { [[ "${SVC_ARGS:-}" == *forwarder.js* ]]; }

# refuse_live_target: AM7 (corrected). A target labelled anything but mtb3a-live=false, or with no label, is treated
# as live: copying over it would destroy what it serves. --rollback lets the old project's forwarder through, nothing else.
refuse_live_target() {
  describe_service "${TO}"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  [[ "${SVC_LIVE}" == "false" ]] && return 0
  if [[ "${ROLLBACK}" == 1 ]] && is_forwarder; then
    info "${TO} serves the legacy forwarder: the rollback may copy into it"
    return 0
  fi
  if is_forwarder; then
    die "${TO}'s ${SERVICE} is the legacy forwarder: copying into it is the rollback, so pass --rollback"
  fi
  die "${TO}'s ${SERVICE} is live (label ${LIVE_LABEL}=${SVC_LIVE:-unset}): copying over it would overwrite what it serves. Nothing done."
}

# expect_closed <project>: closed in fact: ingress-status says internal and /health is turned away from outside.
expect_closed() {
  local live code
  describe_service "$1"
  live="${SVC_INGRESS}"; [[ "${DRY_RUN}" == 1 ]] && live="internal"
  [[ "${live}" == "internal" ]] || die "$1's ${SERVICE} is open (ingress ${live:-unknown}): run freeze first"
  run_capture code "404" curl -s -o /dev/null -w '%{http_code}' --max-time 10 "${SVC_URL}/health"
  [[ "${code}" != 2* ]] || die "$1's ${SERVICE} still answers /health from outside (HTTP ${code}): not frozen yet"
}

# ---------------------------------------------------------------------------
# Databases: credentials from each stack's own state, proxies on two ports
# ---------------------------------------------------------------------------
# db_url <project> <var>: the API user's URL from that project's terraform state (never printed).
db_url() {
  if [[ "${DRY_RUN}" == 1 ]]; then printf -v "$2" '%s' "postgresql://<user>:<password>@127.0.0.1:5440/mutaba3a"; return 0; fi
  tf_ready "$1"
  # Not `url`: printf -v below must reach the caller's variable, which a local of the same name would shadow.
  local _db_url_value
  _db_url_value="$(tf "$1" output -raw local_database_url 2>/dev/null)" || die "no local_database_url in $1's terraform state"
  [[ "${_db_url_value}" =~ ^postgresql://[^:]+:[^@]+@[^/]+/[^?]+ ]] || die "unexpected local_database_url shape in $1's state"
  printf -v "$2" '%s' "${_db_url_value}"
}

# connection_of <project>: the instance's connection name.
# Called as $(connection_of …): run_capture's "+ gcloud …" trace goes to stderr, or it would become part of the
# connection name handed to cloud-sql-proxy (MUT-523 found it: the name was "+ gcloud sql …\n<project>:<region>:…").
connection_of() {
  local conn
  run_capture conn "$1:$(region_of "$1"):${INSTANCE}" gcloud sql instances describe "${INSTANCE}" --project="$1" --format='value(connectionName)' >&2 \
    || die "could not read ${INSTANCE} in $1"
  printf '%s' "${conn}"
}

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

# with_db <url> <port> <command…>: read-only, as the API user, through the proxy on <port>.
with_db() {
  local url="$1" port="$2"; shift 2
  [[ "${url}" =~ ^postgresql://([^:]+):([^@]+)@[^/]+/([^?]+) ]] || die "unexpected database URL shape"
  PGHOST=127.0.0.1 PGPORT="${port}" PGUSER="${BASH_REMATCH[1]}" PGPASSWORD="${BASH_REMATCH[2]}" \
    PGDATABASE="${BASH_REMATCH[3]}" PGOPTIONS='-c default_transaction_read_only=on' "$@"
}

# table_sums <file>: "table|rows|md5 of the rows' md5s, sorted" for every table in public.
table_sums() {
  local out="$1" tables query t
  tables="$(db_sql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")" || return 1
  query=""
  for t in ${tables}; do
    query+="${query:+ UNION ALL }SELECT '${t}', count(*), coalesce(md5(string_agg(md5(x::text), '' ORDER BY md5(x::text))), '-') FROM \"${t}\" x"
  done
  [[ -n "${query}" ]] || die "no tables in the public schema"
  db_sql -F '|' -c "${query} ORDER BY 1" >"${out}"
}

# writes_of <project> <url> <port> <var>: db_write_counters on that database.
writes_of() {
  open_proxy "$(connection_of "$1")" "$3"
  printf '+ psql (read-only, %s): rows inserted, updated, deleted (pg_stat_database)\n' "$1"
  if [[ "${DRY_RUN}" == 1 ]]; then printf -v "$4" '%s' "<writes>"; return 0; fi
  local counters
  counters="$(with_db "$2" "$3" db_write_counters)" || die "could not read $1's write counters (above)"
  printf -v "$4" '%s' "${counters}"
}

# writes_hold_still <project> <url> <port>: two reads DRAIN_SECONDS apart must agree (AM13: a writer we didn't close,
# such as Malafat through VPC egress, shows up here).
writes_hold_still() {
  local first second
  writes_of "$1" "$2" "$3" first
  [[ "${DRY_RUN}" == 1 ]] || sleep "${DRAIN_SECONDS}"
  writes_of "$1" "$2" "$3" second
  [[ "${first}" == "${second}" ]] \
    || die "$1's database is still being written to (inserted,updated,deleted ${first} → ${second}). Something still reaches it: Malafat's VPC egress (DEPLOYMENT.md §6d, AM13)? Nothing copied."
  info "$1's database holds still (${first})"
}

# set_db_password <project>: R7. A restore brings back the source's mutaba3a_api password hash; set it to the one this
# project's state holds, through the Cloud SQL Admin API. The password goes in a request body read from stdin and the
# token in a header file: never argv.
set_db_password() {
  local project="$1" url token
  printf '+ PUT sqladmin users/%s on %s/%s (password from %s terraform state, never printed)\n' "${DB_USER}" "${project}" "${INSTANCE}" "${project}"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  db_url "${project}" url
  token="$(gcloud auth print-access-token)" || die "gcloud auth print-access-token failed"
  printf 'Authorization: Bearer %s\nContent-Type: application/json\n' "${token}" >"${WORK}/auth.headers"
  unset token
  printf '%s' "${url}" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const m = /^postgresql:\/\/([^:]+):([^@]+)@/.exec(s);
      process.stdout.write(JSON.stringify({ name: decodeURIComponent(m[1]), password: decodeURIComponent(m[2]) }));
    });' \
    | curl -fsS -X PUT -H "@${WORK}/auth.headers" --data-binary @- -o "${WORK}/set-password.json" \
      "https://sqladmin.googleapis.com/v1/projects/${project}/instances/${INSTANCE}/users?name=${DB_USER}" \
    || die "could not set ${DB_USER}'s password on ${project}/${INSTANCE} (Cloud SQL Admin API, above)"
  rm -f "${WORK}/auth.headers"
  unset url
  info "${DB_USER} on ${project} now has ${project}'s own password (R7)"
}

# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------
step_secrets() {
  [[ "${TO}" == "${LIVE_PROJECT}" ]] || die "secrets moves the generated secrets into ${LIVE_PROJECT}'s state only (--to ${LIVE_PROJECT})"
  tf_ready "${FROM}"
  tf_ready "${TO}"
  local list r moved=0
  run_capture list "" tf "${TO}" state list || die "could not list ${TO}'s state"
  for r in ${GENERATED}; do
    if grep -qx "random_password.${r}" <<<"${list}"; then continue; fi
    moved=$((moved + 1))
  done
  if (( moved > 0 )); then
    [[ "${moved}" == 5 ]] || die "${TO}'s state holds some of the generated secrets but not all: fix it by hand (terraform state list), nothing moved"
    run tf "${FROM}" state pull >"${WORK}/from.tfstate" || die "could not pull ${FROM}'s state"
    run tf "${TO}" state pull >"${WORK}/to.tfstate" || die "could not pull ${TO}'s state"
    [[ -s "${WORK}/to.tfstate" ]] || rm -f "${WORK}/to.tfstate"
    for r in ${GENERATED}; do
      # A copy of the old state is edited; the old state itself is never pushed, so it keeps all five.
      run tf "${TO}" state mv -state="${WORK}/from.tfstate" -state-out="${WORK}/to.tfstate" "random_password.${r}" "random_password.${r}" >/dev/null \
        || die "could not move random_password.${r} (nothing pushed yet)"
    done
    run tf "${TO}" state push "${WORK}/to.tfstate" || die "could not push ${TO}'s state"
    rm -f "${WORK}/from.tfstate" "${WORK}/to.tfstate"
    info "moved ${GENERATED} into ${TO}'s state; ${FROM}'s state is unchanged"
  else
    info "${TO}'s state already holds all five generated secrets: nothing to move"
  fi
  # The first plan must keep all five as they are: a replacement would sign everyone out.
  run tf "${TO}" plan -input=false -lock=false -var-file="$(tfvars_of "${TO}")" -var image_tag=plan-check -out="${WORK}/check.plan" >/dev/null \
    || die "terraform plan failed for ${TO} (above)"
  local changed
  run_capture changed "" sh -c "cd '${TF_DIR}' && TF_DATA_DIR='${TF_DIR}/.terraform-${TO}' terraform show -json '${WORK}/check.plan' | node -e '
    let s = \"\"; process.stdin.on(\"data\", (d) => (s += d)).on(\"end\", () => {
      const want = new Set(process.argv[1].split(\" \").map((r) => \"random_password.\" + r));
      const bad = (JSON.parse(s).resource_changes || []).filter((c) => want.has(c.address) && !(c.change.actions.length === 1 && c.change.actions[0] === \"no-op\"));
      process.stdout.write(bad.map((c) => c.address + \" \" + c.change.actions.join(\"+\")).join(\", \"));
    });' '${GENERATED}'" || die "could not read the plan"
  [[ -z "${changed}" ]] || die "the new stack's plan would change ${changed}: everyone would be signed out. Stop and look (terraform state show)."
  info "the plan keeps all five generated secrets"
  cat <<EOF

Next (DEPLOYMENT.md §6d C1): the first apply rotates the three machine secrets Malafat could read (R7):
  terraform apply -var-file=$(tfvars_of "${TO}") -var image_tag=<tag> -replace=random_password.db -replace=random_password.admin_token -replace=random_password.job_token
session_pepper and oauth_derive_key stay as they are (AM16): rotating them would sign everyone out.
EOF
}

# secret_hash <project> <secret> <var>: the latest version's sha256 (a missing or disabled one is empty).
secret_hash() {
  local hash
  run_capture hash "<sha256>" bash -c "set -o pipefail; gcloud secrets versions access latest --secret='$2' --project='$1' 2>/dev/null | shasum -a 256 | cut -d' ' -f1" || hash=""
  # An empty value hashes to e3b0…: treat it as no version.
  [[ "${hash}" == e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 ]] && hash=""
  printf -v "$3" '%s' "${hash}"
}

# copy_secret <from> <to> <secret>: through a pipe; skipped when the target already holds the same value.
copy_secret() {
  local src dst
  secret_hash "$1" "$3" src
  secret_hash "$2" "$3" dst
  if [[ "${DRY_RUN}" != 1 && -z "${src}" ]]; then warn "$3 has no version in $1: nothing to copy (set it in $2 before its flag mounts it)"; return 0; fi
  if [[ "${DRY_RUN}" != 1 && "${src}" == "${dst}" ]]; then info "$3: $2 already holds the same value"; return 0; fi
  printf '+ gcloud secrets versions access latest --secret=%s --project=%s | gcloud secrets versions add %s --project=%s --data-file=-\n' "$3" "$1" "$3" "$2"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  gcloud secrets versions access latest --secret="$3" --project="$1" | gcloud secrets versions add "$3" --project="$2" --data-file=- >/dev/null \
    || die "could not copy $3 from $1 to $2"
  info "$3: copied to $2"
}

# rotate_secret <to> <secret>: a new value typed (not shown) on the terminal, piped in.
rotate_secret() {
  printf '+ gcloud secrets versions add %s --project=%s --data-file=- (a new value from the terminal, not shown)\n' "$2" "$1"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "--rotate needs a terminal to type the new values into"
  local value
  read -r -s -p "New value for $2 (empty = skip): " value </dev/tty; printf '\n'
  if [[ -z "${value}" ]]; then warn "$2 skipped: it has no version in $1 yet"; return 0; fi
  printf '%s' "${value}" | gcloud secrets versions add "$2" --project="$1" --data-file=- >/dev/null || die "could not add a version of $2 in $1"
  unset value
  info "$2: new value set in $1"
}

step_secret_values() {
  local s
  if [[ "${TO}" == "${LIVE_PROJECT}" ]]; then
    for s in ${OPERATOR_SECRETS}; do
      if [[ "${ROTATE}" == 1 ]]; then rotate_secret "${TO}" "${s}"; else copy_secret "${FROM}" "${TO}" "${s}"; fi
    done
  else
    info "rollback direction: ${TO} keeps its own operator secrets"
  fi
  # R5/D9: the legacy forwarder's copy of the token the production project generated.
  copy_secret "${LIVE_PROJECT}" "${LEGACY_PROJECT}" "${FORWARDER_SECRET}"
  [[ "${ROTATE}" == 1 ]] && cat <<EOF

Once the cutover is verified, revoke the old provider keys (R7): the Stripe restricted key and webhook signing secret,
the Resend API key and webhook secret, the Turnstile secret (DEPLOYMENT.md §6d C5).
EOF
  return 0
}

step_images() {
  local src dst tags tag sdigest ddigest
  src="$(registry_of "${FROM}")"; dst="$(registry_of "${TO}")"
  if [[ -n "${IMAGE_TAGS}" ]]; then
    tags="$(tr ',' ' ' <<<"${IMAGE_TAGS}")"
  else
    run_capture tags "<tag1> <tag2> <tag3>" sh -c "gcloud artifacts docker images list '${src}' --include-tags --sort-by=~UPDATE_TIME --limit=50 --format='value(tags)' | tr ',' '\n' | grep -v '^\$' | head -n ${IMAGE_COUNT} | tr '\n' ' '" \
      || die "could not list ${src}"
    [[ -n "${tags// /}" ]] || die "no tagged images in ${src}"
  fi
  for tag in ${tags}; do
    run_capture sdigest "<digest>" gcloud artifacts docker images describe "${src}:${tag}" --format='value(image_summary.digest)' \
      || die "${src}:${tag} doesn't exist: nothing copied for it, and nothing after it"
    ddigest=""
    run_capture ddigest "" sh -c "gcloud artifacts docker images describe '${dst}:${tag}' --format='value(image_summary.digest)' 2>/dev/null || true"
    if [[ -n "${ddigest}" ]]; then
      [[ "${ddigest}" == "${sdigest}" ]] || die "${dst}:${tag} already holds another image (${ddigest}); a tag is never pushed over (MUT-347)"
      info "${dst}:${tag} already holds it"
      continue
    fi
    run gcloud container images add-tag "${src}:${tag}" "${dst}:${tag}" --quiet || die "could not copy ${tag}"
  done
}

step_freeze() {
  [[ "${DRY_RUN}" == 1 || -n "$(command -v psql)" ]] || die "missing tool: psql (brew install libpq && brew link --force libpq)"
  need cloud-sql-proxy "brew install cloud-sql-proxy"
  describe_service "${FROM}"
  if [[ "${SVC_INGRESS}" == "internal" && "${DRY_RUN}" != 1 ]]; then
    info "${FROM}'s ${SERVICE} is already closed"
  else
    confirm "Close ${FROM}'s ${SERVICE} to outside traffic (portal, phones, Malafat) and pause its Scheduler jobs?" || die "stopped before closing anything"
    run gcloud run services update "${SERVICE}" --region="${FROM_REGION}" --project="${FROM}" --ingress=internal --quiet \
      || die "could not close ${FROM}'s ${SERVICE}"
  fi
  local jobs name state
  run_capture jobs $'mutaba3a-account-purge,ENABLED' gcloud scheduler jobs list --location="${FROM_REGION}" --project="${FROM}" \
    --format='csv[no-heading](name.basename(),state)' || die "could not list ${FROM}'s Scheduler jobs"
  while IFS=, read -r name state; do
    [[ -n "${name}" && "${state}" == "ENABLED" ]] || continue
    run gcloud scheduler jobs pause "${name}" --location="${FROM_REGION}" --project="${FROM}" --quiet || die "could not pause ${name}"
  done <<<"${jobs}"
  [[ "${DRY_RUN}" == 1 ]] || sleep "${DRAIN_SECONDS}"
  expect_closed "${FROM}"
  local url
  db_url "${FROM}" url
  writes_hold_still "${FROM}" "${url}" "${PORT_FROM}"
  info "${FROM} is frozen. Next: copy (DEPLOYMENT.md §6d)."
}

# step_copy <rehearse 0|1>
step_copy() {
  local rehearse="$1" from_url stamp backup
  [[ "${DRY_RUN}" == 1 || -n "$(command -v psql)" ]] || die "missing tool: psql (brew install libpq && brew link --force libpq)"
  need cloud-sql-proxy "brew install cloud-sql-proxy"
  refuse_live_target
  db_url "${FROM}" from_url
  if [[ "${rehearse}" == 1 ]]; then
    confirm "Overwrite ${TO}'s ${INSTANCE} and attachments with a fresh copy of ${FROM}? (${FROM} stays open)" || die "stopped before copying anything"
  else
    expect_closed "${FROM}"
    writes_hold_still "${FROM}" "${from_url}" "${PORT_FROM}"
    confirm "Copy ${FROM} over ${TO}'s ${INSTANCE} and attachments?" || die "stopped before copying anything"
  fi
  stamp="$(date -u +%Y%m%dt%H%M%S)"
  timed "On-demand backup of ${FROM}" run gcloud sql backups create --instance="${INSTANCE}" --project="${FROM}" \
    --description="mut-487-${SUBCOMMAND}-${stamp}" --quiet
  run_capture backup "<backup-id>" gcloud sql backups list --instance="${INSTANCE}" --project="${FROM}" \
    --filter="description=mut-487-${SUBCOMMAND}-${stamp}" --limit=1 --format='value(id)'
  [[ -n "${backup}" ]] || die "could not find the backup just taken (mut-487-${SUBCOMMAND}-${stamp})"
  # MUT-523: a cross-region restore when the regions differ (the backup is in FROM's region, the instance in TO's);
  # the rehearsal times it (DEPLOYMENT.md §6d C2).
  timed "Restore into ${TO} (${FROM_REGION} → ${TO_REGION})" run gcloud sql backups restore "${backup}" --restore-instance="${INSTANCE}" \
    --backup-instance="${INSTANCE}" --backup-project="${FROM}" --project="${TO}" --quiet
  timed "Set ${DB_USER}'s password on ${TO}" set_db_password "${TO}"
  timed "Receipts rsync" run gcloud storage rsync "gs://$(attachments_of "${FROM}")" "gs://$(attachments_of "${TO}")" \
    --recursive --delete-unmatched-destination-objects
  step_verify "${rehearse}"
}

# step_verify <report-only 0|1>
step_verify() {
  local report="$1" from_url to_url from_conn to_conn mismatch=0
  [[ "${DRY_RUN}" == 1 || -n "$(command -v psql)" ]] || die "missing tool: psql (brew install libpq && brew link --force libpq)"
  need cloud-sql-proxy "brew install cloud-sql-proxy"
  need curl "curl"
  db_url "${FROM}" from_url
  db_url "${TO}" to_url
  from_conn="$(connection_of "${FROM}")"
  to_conn="$(connection_of "${TO}")"
  open_proxy "${from_conn}" "${PORT_FROM}"
  open_proxy "${to_conn}" "${PORT_TO}"
  printf '+ psql (read-only, both): every table'"'"'s row count and checksum\n'
  if [[ "${DRY_RUN}" != 1 ]]; then
    # AM2: connecting as mutaba3a_api with the target's own password is the check that the reset took.
    with_db "${to_url}" "${PORT_TO}" table_sums "${WORK}/to.sums" || die "could not read ${TO} as ${DB_USER} (is its password set? copy sets it)"
    with_db "${from_url}" "${PORT_FROM}" table_sums "${WORK}/from.sums" || die "could not read ${FROM}"
    if ! diff "${WORK}/from.sums" "${WORK}/to.sums" >"${WORK}/sums.diff"; then
      mismatch=1
      warn "tables differ (< ${FROM}, > ${TO}):"
      cat "${WORK}/sums.diff" >&2
    else
      info "every table matches: $(wc -l <"${WORK}/to.sums" | tr -d ' ') tables, counts and checksums"
    fi
  fi
  printf '+ gcloud storage ls gs://%s/** and gs://%s/** (object names)\n' "$(attachments_of "${FROM}")" "$(attachments_of "${TO}")"
  if [[ "${DRY_RUN}" != 1 ]]; then
    gcloud storage ls "gs://$(attachments_of "${FROM}")/**" 2>/dev/null | sed 's#^gs://[^/]*/##' | sort >"${WORK}/from.objects" || true
    gcloud storage ls "gs://$(attachments_of "${TO}")/**" 2>/dev/null | sed 's#^gs://[^/]*/##' | sort >"${WORK}/to.objects" || true
    if ! diff "${WORK}/from.objects" "${WORK}/to.objects" >"${WORK}/objects.diff"; then
      mismatch=1
      warn "receipt objects differ (< ${FROM}, > ${TO}): $(grep -c '^[<>]' "${WORK}/objects.diff") lines"
      head -20 "${WORK}/objects.diff" >&2
    else
      info "every receipt object is present: $(wc -l <"${WORK}/to.objects" | tr -d ' ') objects"
    fi
    local first signed
    first="$(head -1 "${WORK}/to.objects")"
    if [[ -n "${first}" ]]; then
      signed="$(gcloud storage sign-url "gs://$(attachments_of "${TO}")/${first}" --duration=10m \
        --impersonate-service-account="${SERVICE}@${TO}.iam.gserviceaccount.com" --format='value(signed_url)' 2>"${WORK}/sign.err")" \
        || { cat "${WORK}/sign.err" >&2; die "could not sign a URL as ${SERVICE}@${TO} (you need roles/iam.serviceAccountTokenCreator on it)"; }
      curl -fsS -o /dev/null --max-time 30 "${signed}" || die "the signed URL for ${first} did not download"
      info "a receipt downloads through a signed URL minted as ${TO}'s ${SERVICE} account"
    else
      info "no receipt objects: nothing to download"
    fi
  else
    printf '+ gcloud storage sign-url gs://%s/<first object> --impersonate-service-account=%s@%s.iam.gserviceaccount.com; curl the URL\n' "$(attachments_of "${TO}")" "${SERVICE}" "${TO}"
  fi
  if (( mismatch )); then
    [[ "${report}" == 1 ]] && { warn "rehearsal: ${FROM} stayed open, so differences are expected; at the cutover they stop it"; return 0; }
    die "${TO} doesn't match ${FROM}: ${FROM} stays closed. Run copy again, or roll back (reopen ${FROM}: DEPLOYMENT.md §6d)."
  fi
  print_timings
}

print_timings() {
  (( ${#STEP_NAMES[@]} > 0 )) || return 0
  echo
  echo "Results (paste into docs/operations/pilot-runbook.md §10):"
  echo
  echo "| Step | Seconds |"
  echo "|---|---:|"
  local i
  for i in "${!STEP_NAMES[@]}"; do echo "| ${STEP_NAMES[$i]} | ${STEP_SECONDS[$i]} |"; done
}

# apply_args <project> <extra vars…>: the image the service runs now, so an apply changes only what we ask.
APPLY=()
apply_with() {
  local project="$1" tag; shift
  describe_service "${project}"
  [[ "${SVC_IMAGE}" != *@* ]] || die "${project}'s ${SERVICE} runs a digest-pinned image (${SVC_IMAGE}); deploy a tag first"
  tag="${SVC_IMAGE##*:}"
  tf_ready "${project}"
  APPLY=(apply -input=false -var-file="$(tfvars_of "${project}")" -var "image_tag=${tag}" "$@")
  [[ "${YES}" == 1 ]] && APPLY+=(-auto-approve)
  run tf "${project}" "${APPLY[@]}" || die "terraform apply failed for ${project} (above)"
}

step_open() {
  step_verify 0
  confirm "Open ${TO}'s ${SERVICE} to everyone and resume its jobs?" || die "stopped before opening anything"
  if [[ "${TO}" == "${LEGACY_PROJECT}" ]]; then
    [[ "${ROLLBACK}" == 1 ]] || die "opening ${LEGACY_PROJECT} again is the rollback: pass --rollback"
    apply_with "${TO}" -var legacy_forwarder=false -var api_ingress=INGRESS_TRAFFIC_ALL -var scheduler_paused=false
  else
    apply_with "${TO}" -var api_public=true -var scheduler_paused=false -var live_label=true
  fi
  describe_service "${TO}"
  run curl -fsS --max-time 30 -o /dev/null "${SVC_URL}/ready" || die "${SVC_URL}/ready did not answer 200 after the apply"
  cat <<EOF

${TO} is open at ${SVC_URL}. Now, in $(tfvars_of "${TO}") (every checkout you release from), delete the
scheduler_paused, api_public and live_label lines (or legacy_forwarder, on a rollback), so the next release keeps it open.
Then: forward (DEPLOYMENT.md §6d C3).
EOF
}

step_forward() {
  [[ "${FROM}" == "${LEGACY_PROJECT}" && "${TO}" == "${LIVE_PROJECT}" ]] \
    || die "forward turns ${LEGACY_PROJECT}'s service into the forwarder to ${LIVE_PROJECT}: --from ${LEGACY_PROJECT} --to ${LIVE_PROJECT}"
  describe_service "${TO}"
  local target="${SVC_URL}" has
  [[ "${DRY_RUN}" == 1 || "${SVC_LIVE}" == "true" ]] || die "${TO} isn't open yet (label ${LIVE_LABEL}=${SVC_LIVE:-unset}): run open first"
  run curl -fsS --max-time 30 -o /dev/null "${target}/ready" || die "${target}/ready doesn't answer: forwarding to it would take everyone down"
  secret_hash "${FROM}" "${FORWARDER_SECRET}" has
  [[ "${DRY_RUN}" == 1 || -n "${has}" ]] || die "${FROM} has no ${FORWARDER_SECRET} version: run secret-values first"
  # AM12: the old project must already run an image that has the forwarder in it.
  describe_service "${FROM}"
  local tag="${SVC_IMAGE##*:}" first
  first="$(git -C "${SERVER_DIR}" log --diff-filter=A --format=%H -- src/forwarder.ts | tail -1)"
  if [[ "${DRY_RUN}" != 1 ]]; then
    [[ -n "${first}" ]] || die "this checkout has no src/forwarder.ts"
    git -C "${SERVER_DIR}" merge-base --is-ancestor "${first}" "${tag}" 2>/dev/null \
      || die "${FROM} runs ${tag}, which predates the forwarder (or isn't in this clone): release this branch to ${FROM} first with LEGACY_STACK=1 (DEPLOYMENT.md §6d C1, AM12)"
  fi
  confirm "Turn ${FROM}'s ${SERVICE} into the forwarder to ${target}?" || die "stopped before changing anything"
  apply_with "${FROM}" -var legacy_forwarder=true -var "forward_to=${target}" -var api_ingress=INGRESS_TRAFFIC_ALL -var min_instances=0
  describe_service "${FROM}"
  run curl -fsS --max-time 30 -o /dev/null "${SVC_URL}/forwarder/health" || die "${SVC_URL}/forwarder/health did not answer"
  run curl -fsS --max-time 30 -o /dev/null "${SVC_URL}/ready" || die "${SVC_URL}/ready through the forwarder did not answer"
  cat <<EOF

Everyone reaches ${target} now, old phone builds through ${SVC_URL}. In legacy.tfvars set legacy_forwarder = true,
forward_to = "${target}", min_instances = 0 and enable_uptime_check = false. Then the same day, off the critical path
(D7): the frontdoor repoint (config/hosts.json legacy.portalUpstream) and Malafat's secret (R9). DEPLOYMENT.md §6d C3.
EOF
}

case "${SUBCOMMAND}" in
  secrets) step_secrets ;;
  secret-values) step_secret_values ;;
  images) step_images ;;
  rehearse) step_copy 1; cat <<EOF

Rehearsal done. Smoke-test ${TO} from your machine (R3): gcloud run services proxy ${SERVICE} --region=${TO_REGION} --project=${TO} --port=8788
then curl http://localhost:8788/ready, sign in on http://localhost:8788, open a receipt. Run the restore drill against ${TO}.
EOF
    ;;
  freeze) step_freeze ;;
  copy) step_copy 0 ;;
  verify) step_verify 0 ;;
  open) step_open ;;
  forward) step_forward ;;
esac
