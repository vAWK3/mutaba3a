#!/usr/bin/env bash
# Mutaba3a API — operator deploy, production. Nothing in CI calls this (ADR-025 §9).
#
#   GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh
#
# Everything that can run on this machine does (ADR-026), the same way
# Malafat's `pnpm release` works:
#   1. docker build (linux/amd64) with your local daemon, docker push to
#      Artifact Registry as mutaba3a-api:<short git sha>.
#   2. Cloud SQL Auth Proxy on 127.0.0.1:5440, then `prisma migrate deploy`
#      from this directory against the production database. The proxy is
#      stopped afterwards. A failed migration stops here; the service is not
#      touched.
#   3. terraform apply -var image_tag=<sha>: the service rolls to the new
#      image with SERVICE_VERSION=<sha>. Everything else is reconciled too.
#   4. scripts/smoke.ts against the service URL.
#
# Prerequisites (DEPLOYMENT.md §1): gcloud (authenticated), docker daemon
# running, cloud-sql-proxy v2, terraform >= 1.5, node 22, and
# infrastructure/terraform/production.tfvars. Terraform prompts before every
# apply; pass AUTO_APPROVE=1 to skip the prompts once you trust the plan.
set -euo pipefail

ENVIRONMENT="${ENVIRONMENT:-production}"   # staging is not used for now; see DEPLOYMENT.md
: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${TF_STATE_BUCKET:?set TF_STATE_BUCKET (GCS bucket holding terraform state)}"
GCP_REGION="${GCP_REGION:-me-west1}"
ARTIFACT_REPO="${ARTIFACT_REPO:-mutaba3a}"
AUTO_APPROVE="${AUTO_APPROVE:-0}"
PROXY_PORT="${PROXY_PORT:-5440}"

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${SERVER_DIR}/infrastructure/terraform"
SHORT_SHA="${IMAGE_TAG:-$(git -C "${SERVER_DIR}" rev-parse --short HEAD)}"
REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPO}"
IMAGE="${REGISTRY}/mutaba3a-api:${SHORT_SHA}"
SUFFIX=""; [[ "${ENVIRONMENT}" == "production" ]] || SUFFIX="-${ENVIRONMENT}"
SERVICE_NAME="mutaba3a-api${SUFFIX}"
PROXY_PID=""

info() { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 ($2)"; }
cleanup() { if [[ -n "${PROXY_PID}" ]]; then kill "${PROXY_PID}" 2>/dev/null || true; fi; }
trap cleanup EXIT

need gcloud "https://cloud.google.com/sdk/docs/install"
need docker "Docker Desktop, daemon running"
need cloud-sql-proxy "brew install cloud-sql-proxy"
need terraform "brew install terraform"
need node "node 22"
docker info >/dev/null 2>&1 || die "the docker daemon is not running"
[[ -f "${TF_DIR}/${ENVIRONMENT}.tfvars" ]] || die "missing ${TF_DIR}/${ENVIRONMENT}.tfvars (copy ${ENVIRONMENT}.tfvars.example)"
if [[ -n "$(git -C "${SERVER_DIR}" status --porcelain -- . 2>/dev/null)" && -z "${IMAGE_TAG:-}" ]]; then
  die "server/ has uncommitted changes; commit first so the image tag names what you deploy (or pass IMAGE_TAG=)"
fi

info "environment=${ENVIRONMENT} project=${GCP_PROJECT_ID} region=${GCP_REGION} tag=${SHORT_SHA}"

# ---------------------------------------------------------------------------
# 0. Terraform init (remote state) and the registry, which must exist before push
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
terraform init -reconfigure -input=false \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="prefix=mutaba3a-api/${ENVIRONMENT}" >/dev/null
TF_ARGS=(-input=false -var-file="${ENVIRONMENT}.tfvars" -var "image_tag=${SHORT_SHA}")
APPROVE=(); [[ "${AUTO_APPROVE}" == "1" ]] && APPROVE=(-auto-approve)
info "ensuring the Artifact Registry repository and the database exist"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}" \
  -target=google_artifact_registry_repository.images \
  -target=google_sql_user.api \
  -target=google_sql_database.mutaba3a \
  -target=google_secret_manager_secret_version.database_url
LOCAL_DATABASE_URL="$(terraform output -raw local_database_url)"
SQL_CONNECTION="$(terraform output -raw cloud_sql_connection_name)"
popd >/dev/null

# ---------------------------------------------------------------------------
# 1. Build locally, push
# ---------------------------------------------------------------------------
pushd "${SERVER_DIR}" >/dev/null
info "building ${IMAGE} with the local docker daemon"
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
docker build --platform linux/amd64 -t "${IMAGE}" .
info "pushing ${IMAGE}"
docker push "${IMAGE}"

# ---------------------------------------------------------------------------
# 2. Migrate from this machine through the Cloud SQL Auth Proxy
# ---------------------------------------------------------------------------
info "starting cloud-sql-proxy for ${SQL_CONNECTION} on 127.0.0.1:${PROXY_PORT}"
cloud-sql-proxy "${SQL_CONNECTION}" --port "${PROXY_PORT}" --quiet &
PROXY_PID=$!
for _ in $(seq 1 30); do
  (exec 3<>"/dev/tcp/127.0.0.1/${PROXY_PORT}") 2>/dev/null && break
  sleep 1
done
info "running prisma migrate deploy"
DATABASE_URL="${LOCAL_DATABASE_URL}" npx prisma migrate deploy \
  || die "migration failed; the service was NOT rolled. Fix the migration and re-run."
kill "${PROXY_PID}" 2>/dev/null || true; PROXY_PID=""
popd >/dev/null

# ---------------------------------------------------------------------------
# 3. Roll the service and reconcile everything else
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
info "applying the full stack at ${SHORT_SHA}"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}"
SERVICE_URL="$(terraform output -raw service_url)"
popd >/dev/null

# ---------------------------------------------------------------------------
# 4. Smoke
# ---------------------------------------------------------------------------
info "smoke-testing ${SERVICE_URL}"
pushd "${SERVER_DIR}" >/dev/null
npm run --silent smoke -- --url "${SERVICE_URL}" --expect-version "${SHORT_SHA}"
popd >/dev/null

info "done: ${SERVICE_NAME} serves ${SHORT_SHA} at ${SERVICE_URL}"
