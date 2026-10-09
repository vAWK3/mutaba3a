#!/usr/bin/env bash
# Mutaba3a API — operator database access through the Cloud SQL Auth Proxy.
# Nothing in CI calls this. `scripts/deploy.sh` already migrates as its step 2;
# this is the by-hand path (DEPLOYMENT.md §6) and the way to check status
# before a release.
#
#   TF_STATE_BUCKET=<bucket> npm run db:migrate          # prisma migrate deploy against production
#   TF_STATE_BUCKET=<bucket> npm run db:migrate:status   # prisma migrate status (read-only)
#   TF_STATE_BUCKET=<bucket> npm run db:psql             # interactive psql
#   TF_STATE_BUCKET=<bucket> npm run db:proxy            # keep the proxy up until Ctrl-C (for other tools)
#
# How it reaches the database: `terraform output` (remote state) gives the
# instance connection name and the local URL, cloud-sql-proxy listens on
# 127.0.0.1:${PROXY_PORT:-5440} for the duration of the command, then stops.
# Your gcloud application-default identity needs roles/cloudsql.client on the
# project (DEPLOYMENT.md §1.2).
#
# Local development: set DATABASE_URL and no proxy is started — the command
# runs straight against it (e.g. the docker Postgres from README.md).
#
#   DATABASE_URL=postgresql://mutaba3a:mutaba3a@localhost:54329/mutaba3a_dev npm run db:migrate:status
set -euo pipefail

COMMAND="${1:-}"
ENVIRONMENT="${ENVIRONMENT:-production}"
PROXY_PORT="${PROXY_PORT:-5440}"
SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${SERVER_DIR}/infrastructure/terraform"
PROXY_PID=""

info() { printf '\033[0;36m[db]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[db] %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 ($2)"; }
cleanup() { if [[ -n "${PROXY_PID}" ]]; then kill "${PROXY_PID}" 2>/dev/null || true; fi; }
trap cleanup EXIT

usage() {
  cat <<EOF
usage: scripts/db.sh <migrate|status|psql|proxy>

  migrate   prisma migrate deploy (forward-only; applies every pending migration)
  status    prisma migrate status (read-only; shows pending migrations)
  psql      interactive psql session
  proxy     start cloud-sql-proxy and wait until Ctrl-C

Production (default): set TF_STATE_BUCKET; the connection comes from terraform output.
Local: set DATABASE_URL and the command runs against it with no proxy.
EOF
}

case "${COMMAND}" in
  migrate|status|psql|proxy) ;;
  -h|--help|help|"") usage; [[ -n "${COMMAND}" ]] && exit 0 || exit 2 ;;
  *) usage; die "unknown command: ${COMMAND}" ;;
esac

# ---------------------------------------------------------------------------
# Resolve the database URL: explicit DATABASE_URL, or production via the proxy
# ---------------------------------------------------------------------------
if [[ -n "${DATABASE_URL:-}" ]]; then
  [[ "${COMMAND}" != "proxy" ]] || die "DATABASE_URL is set; nothing to proxy. Unset it to reach production."
  info "using DATABASE_URL from the environment (no proxy)"
  URL="${DATABASE_URL}"
else
  : "${TF_STATE_BUCKET:?set TF_STATE_BUCKET (GCS bucket holding terraform state), or DATABASE_URL for a local database}"
  need gcloud "https://cloud.google.com/sdk/docs/install"
  need cloud-sql-proxy "brew install cloud-sql-proxy"
  need terraform "brew install terraform"

  pushd "${TF_DIR}" >/dev/null
  terraform init -reconfigure -input=false \
    -backend-config="bucket=${TF_STATE_BUCKET}" \
    -backend-config="prefix=mutaba3a-api/${ENVIRONMENT}" >/dev/null
  URL="$(terraform output -raw local_database_url 2>/dev/null)" || die "no local_database_url output: has scripts/deploy.sh created the database yet?"
  SQL_CONNECTION="$(terraform output -raw cloud_sql_connection_name)"
  popd >/dev/null

  # The URL from Terraform points at the default proxy port; honour PROXY_PORT if the operator changed it.
  TF_PORT="$(cd "${TF_DIR}" && terraform output -raw proxy_port 2>/dev/null || echo 5440)"
  URL="${URL/127.0.0.1:${TF_PORT}/127.0.0.1:${PROXY_PORT}}"

  info "starting cloud-sql-proxy for ${SQL_CONNECTION} on 127.0.0.1:${PROXY_PORT} (${ENVIRONMENT})"
  cloud-sql-proxy "${SQL_CONNECTION}" --port "${PROXY_PORT}" --quiet &
  PROXY_PID=$!
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/${PROXY_PORT}") 2>/dev/null && break
    sleep 1
  done
  (exec 3<>"/dev/tcp/127.0.0.1/${PROXY_PORT}") 2>/dev/null || die "cloud-sql-proxy did not open 127.0.0.1:${PROXY_PORT} within 30 s (is the port free? is gcloud authenticated?)"
fi

# ---------------------------------------------------------------------------
# Run the command
# ---------------------------------------------------------------------------
pushd "${SERVER_DIR}" >/dev/null
case "${COMMAND}" in
  migrate)
    info "prisma migrate deploy (${ENVIRONMENT})"
    DATABASE_URL="${URL}" npx prisma migrate deploy || die "migration failed; nothing else was touched. Read the Prisma error, fix the migration, commit, re-run."
    ;;
  status)
    info "prisma migrate status (${ENVIRONMENT})"
    # `migrate status` exits 1 when migrations are pending; that is information, not a failure here.
    DATABASE_URL="${URL}" npx prisma migrate status || true
    ;;
  psql)
    need psql "brew install libpq && brew link --force libpq"
    info "psql (${ENVIRONMENT}); \\q to leave"
    psql "${URL}"
    ;;
  proxy)
    info "proxy is up; DATABASE_URL for other tools (password included — do not paste it into chat or tickets):"
    info "  ${URL}"
    info "Ctrl-C to stop"
    wait "${PROXY_PID}"
    ;;
esac
popd >/dev/null
