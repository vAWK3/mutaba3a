#!/usr/bin/env bash
# Mutaba3a API — operator deploy. Nothing in CI calls this (ADR-025 §9).
#
#   GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh staging
#   GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh production
#
# What it does, in order:
#   1. Builds and pushes mutaba3a-api:<sha> and mutaba3a-api-migrate:<sha> with
#      Cloud Build (BUILD_MODE=local uses your Docker daemon instead).
#   2. terraform apply, targeted to the migration job, so the job runs the new
#      migrations image.
#   3. Executes the migration job and waits for it (prisma migrate deploy).
#   4. terraform apply for everything else: the service rolls to the new image
#      with SERVICE_VERSION=<sha>.
#   5. Runs scripts/smoke.ts against the service URL.
#
# Prerequisites: gcloud (authenticated, with the project's Owner or the roles in
# DEPLOYMENT.md), terraform >= 1.5, node 22, a copy of
# infrastructure/terraform/<env>.tfvars and backend.<env>.hcl (see the *.example
# files). The first run of an environment is interactive at each terraform
# step; pass AUTO_APPROVE=1 to skip the prompts once you trust the plan.
set -euo pipefail

ENVIRONMENT="${1:-}"
case "${ENVIRONMENT}" in
  staging|production) ;;
  *) echo "usage: $0 staging|production" >&2; exit 2 ;;
esac

: "${GCP_PROJECT_ID:?set GCP_PROJECT_ID}"
: "${TF_STATE_BUCKET:?set TF_STATE_BUCKET (GCS bucket holding terraform state)}"
GCP_REGION="${GCP_REGION:-me-west1}"
ARTIFACT_REPO="${ARTIFACT_REPO:-mutaba3a}"
BUILD_MODE="${BUILD_MODE:-cloud}"      # cloud | local
AUTO_APPROVE="${AUTO_APPROVE:-0}"

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="${SERVER_DIR}/infrastructure/terraform"
SHORT_SHA="${IMAGE_TAG:-$(git -C "${SERVER_DIR}" rev-parse --short HEAD)}"
REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPO}"
SUFFIX=""; [[ "${ENVIRONMENT}" == "production" ]] || SUFFIX="-${ENVIRONMENT}"
JOB_NAME="mutaba3a-api-migrate${SUFFIX}"
SERVICE_NAME="mutaba3a-api${SUFFIX}"

info() { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f "${TF_DIR}/${ENVIRONMENT}.tfvars" ]] || die "missing ${TF_DIR}/${ENVIRONMENT}.tfvars (copy ${ENVIRONMENT}.tfvars.example)"
if [[ -n "$(git -C "${SERVER_DIR}" status --porcelain -- . 2>/dev/null)" && -z "${IMAGE_TAG:-}" ]]; then
  die "server/ has uncommitted changes; commit first so the image tag names what you deploy (or pass IMAGE_TAG=)"
fi

info "environment=${ENVIRONMENT} project=${GCP_PROJECT_ID} region=${GCP_REGION} tag=${SHORT_SHA}"

# ---------------------------------------------------------------------------
# 0. Terraform init (remote state, one prefix per environment)
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
terraform init -reconfigure -input=false \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="prefix=mutaba3a-api/${ENVIRONMENT}" >/dev/null
TF_ARGS=(-input=false -var-file="${ENVIRONMENT}.tfvars" -var "image_tag=${SHORT_SHA}")
APPROVE=(); [[ "${AUTO_APPROVE}" == "1" ]] && APPROVE=(-auto-approve)

# The registry must exist before the first push. On the first run of an
# environment this also creates nothing else, so it is safe to repeat.
info "ensuring the Artifact Registry repository exists"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}" -target=google_artifact_registry_repository.images
popd >/dev/null

# ---------------------------------------------------------------------------
# 1. Build and push both images
# ---------------------------------------------------------------------------
pushd "${SERVER_DIR}" >/dev/null
if [[ "${BUILD_MODE}" == "local" ]]; then
  info "building locally with docker"
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
  docker build --platform linux/amd64 --target runtime -t "${REGISTRY}/mutaba3a-api:${SHORT_SHA}" .
  docker build --platform linux/amd64 --target migrate -t "${REGISTRY}/mutaba3a-api-migrate:${SHORT_SHA}" .
  docker push "${REGISTRY}/mutaba3a-api:${SHORT_SHA}"
  docker push "${REGISTRY}/mutaba3a-api-migrate:${SHORT_SHA}"
else
  info "building with Cloud Build"
  gcloud builds submit --project="${GCP_PROJECT_ID}" --config=cloudbuild.yaml \
    --substitutions="_REGION=${GCP_REGION},_REPO=${ARTIFACT_REPO},SHORT_SHA=${SHORT_SHA}" .
fi
popd >/dev/null

# ---------------------------------------------------------------------------
# 2 + 3. Migrate: point the job at the new image, run it, wait
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
info "updating the migration job to ${SHORT_SHA}"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}" -target=google_cloud_run_v2_job.migrate
popd >/dev/null

info "running prisma migrate deploy (${JOB_NAME})"
gcloud run jobs execute "${JOB_NAME}" --project="${GCP_PROJECT_ID}" --region="${GCP_REGION}" --wait \
  || die "migration job failed; the service was NOT rolled. Inspect: gcloud run jobs executions list --job=${JOB_NAME} --region=${GCP_REGION}"

# ---------------------------------------------------------------------------
# 4. Roll the service and reconcile everything else
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
info "applying the full stack at ${SHORT_SHA}"
terraform apply "${TF_ARGS[@]}" "${APPROVE[@]}"
SERVICE_URL="$(terraform output -raw service_url)"
popd >/dev/null

# ---------------------------------------------------------------------------
# 5. Smoke
# ---------------------------------------------------------------------------
info "smoke-testing ${SERVICE_URL}"
pushd "${SERVER_DIR}" >/dev/null
npm run --silent smoke -- --url "${SERVICE_URL}" --expect-version "${SHORT_SHA}"
popd >/dev/null

info "done: ${SERVICE_NAME} serves ${SHORT_SHA} at ${SERVICE_URL}"
