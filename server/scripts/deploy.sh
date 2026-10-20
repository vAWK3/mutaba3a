#!/usr/bin/env bash
# Mutaba3a API — operator deploy, production. Nothing in CI calls this (ADR-025 §9).
#
#   GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh
#
# Everything that can run on this machine does (ADR-026), the same way
# Malafat's `pnpm release` works:
#   1. npm run build:hosted at the repo root (MUT-45): the hosted-portal
#      bundle, copied into this build context as dist-hosted/.
#   2. docker build (linux/amd64) with your local daemon, docker push to
#      Artifact Registry as mutaba3a-api:<short git sha>. The image serves
#      dist-hosted/ from the same origin as the API (hosted-portal.md §9).
#   3. Cloud SQL Auth Proxy on 127.0.0.1:5440, then `prisma migrate deploy`
#      from this directory against the production database. The proxy is
#      stopped afterwards. A failed migration stops here; the service is not
#      touched.
#   4. terraform apply -var image_tag=<sha>: the service rolls to the new
#      image with SERVICE_VERSION=<sha>. Everything else is reconciled too.
#   5. scripts/smoke.ts against the service URL, API and portal both.
#   6. Post-roll data repairs (src/scripts/post-roll.ts) through the proxy
#      again: idempotent fixes for rows the old revision wrote after step 3's
#      migration, which a migration's backfill cannot see. Usually 0 rows.
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
REPO_ROOT="$(cd "${SERVER_DIR}/.." && pwd)"
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
# The Cloud SQL Auth Proxy on 127.0.0.1:PROXY_PORT, for steps 3 and 6; needs SQL_CONNECTION (step 0).
start_proxy() {
  info "starting cloud-sql-proxy for ${SQL_CONNECTION} on 127.0.0.1:${PROXY_PORT}"
  cloud-sql-proxy "${SQL_CONNECTION}" --port "${PROXY_PORT}" --quiet &
  PROXY_PID=$!
  for _ in $(seq 1 30); do
    (exec 3<>"/dev/tcp/127.0.0.1/${PROXY_PORT}") 2>/dev/null && return 0
    sleep 1
  done
  die "cloud-sql-proxy did not open 127.0.0.1:${PROXY_PORT} within 30 s"
}
stop_proxy() { kill "${PROXY_PID}" 2>/dev/null || true; PROXY_PID=""; }

need gcloud "https://cloud.google.com/sdk/docs/install"
need docker "Docker Desktop, daemon running"
need cloud-sql-proxy "brew install cloud-sql-proxy"
need terraform "brew install terraform"
need node "node 22"
docker info >/dev/null 2>&1 || die "the docker daemon is not running"
[[ -f "${TF_DIR}/${ENVIRONMENT}.tfvars" ]] || die "missing ${TF_DIR}/${ENVIRONMENT}.tfvars (copy ${ENVIRONMENT}.tfvars.example)"
# The image now bundles the hosted-portal build (MUT-45) alongside server/, so
# the whole repo must be clean for the tag to name everything that went in.
if [[ -n "$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null)" && -z "${IMAGE_TAG:-}" ]]; then
  die "the repo has uncommitted changes; commit first so the image tag names what you deploy (or pass IMAGE_TAG=)"
fi

# MUT-324 (D11): web first. People are asked to accept the terms this release names, so that exact
# text must already be on the public site. `make release server` also checks it in its preflight,
# before the version bump and push; this second check costs one fetch and holds whatever runs this.
# SKIP_TERMS_CHECK=1 only for an emergency fix that keeps the version.
if [[ "${SKIP_TERMS_CHECK:-}" == "1" ]]; then
  info "WARNING: skipping the terms check (SKIP_TERMS_CHECK=1)"
else
  npm --prefix "${SERVER_DIR}" run --silent terms:check-live || die "the terms check failed (above); if the version isn't listed yet, release web first (make release web)"
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
# 1. Build the hosted-portal bundle, copy it into the Docker build context
# ---------------------------------------------------------------------------
pushd "${REPO_ROOT}" >/dev/null
info "building the hosted-portal bundle (npm run build:hosted)"
npm ci --no-audit --no-fund
npm run --silent build:hosted
popd >/dev/null
rm -rf "${SERVER_DIR}/dist-hosted"
cp -r "${REPO_ROOT}/dist-hosted" "${SERVER_DIR}/dist-hosted"

# ---------------------------------------------------------------------------
# 2. Build the image locally, push
# ---------------------------------------------------------------------------
pushd "${SERVER_DIR}" >/dev/null
info "building ${IMAGE} with the local docker daemon"
gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
docker build --platform linux/amd64 -t "${IMAGE}" .
info "pushing ${IMAGE}"
docker push "${IMAGE}"

# ---------------------------------------------------------------------------
# 3. Migrate from this machine through the Cloud SQL Auth Proxy
# ---------------------------------------------------------------------------
start_proxy
info "running prisma migrate deploy"
DATABASE_URL="${LOCAL_DATABASE_URL}" npx prisma migrate deploy \
  || die "migration failed; the service was NOT rolled. Fix the migration and re-run."
stop_proxy
popd >/dev/null

# ---------------------------------------------------------------------------
# 4. Roll the service and reconcile everything else
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
info "applying the full stack at ${SHORT_SHA}"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}"
SERVICE_URL="$(terraform output -raw service_url 2>/dev/null || true)"
popd >/dev/null
[[ -n "${SERVICE_URL}" ]] || die "terraform did not create the Cloud Run service (no service_url output); fix the error above and re-run this script — everything already created is kept"

# ---------------------------------------------------------------------------
# 5. Smoke (API and portal both — see server/src/smoke.ts)
# ---------------------------------------------------------------------------
info "smoke-testing ${SERVICE_URL}"
pushd "${SERVER_DIR}" >/dev/null
npm run --silent smoke -- --url "${SERVICE_URL}" --expect-version "${SHORT_SHA}"
popd >/dev/null

# ---------------------------------------------------------------------------
# 6. Post-roll data repairs (see server/src/scripts/post-roll.ts)
# ---------------------------------------------------------------------------
# After the roll and the smoke, so the old revision has drained. Idempotent: a
# re-run or a rollback (IMAGE_TAG=<old sha>) runs it again and finds 0 rows.
pushd "${SERVER_DIR}" >/dev/null
start_proxy
info "running post-roll data repairs"
DATABASE_URL="${LOCAL_DATABASE_URL}" npm run --silent post-roll \
  || die "post-roll repairs failed; the service IS rolled and healthy. Re-run ./scripts/deploy.sh (every step is idempotent) or 'DATABASE_URL=… npm run post-roll' through 'npm run db:proxy'."
stop_proxy
popd >/dev/null

info "done: ${SERVICE_NAME} serves ${SHORT_SHA} at ${SERVICE_URL}"
