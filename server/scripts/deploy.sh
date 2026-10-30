#!/usr/bin/env bash
# Mutaba3a API — operator deploy, production. Nothing in CI calls this (ADR-025 §9).
#
#   GCP_PROJECT_ID=<project> TF_STATE_BUCKET=<bucket> ./scripts/deploy.sh
#
# MUT-487 (ADR-232): config/gcp.json names the one project production releases go to (guard_project_release).
# The old project (the legacy forwarder, a rollback of the move, the teardown) needs LEGACY_STACK=1, which also
# reads legacy.tfvars instead of production.tfvars. Each project keeps its own terraform dir state
# (TF_DATA_DIR=.terraform-<project>), so switching between the two never re-inits one onto the other's bucket.
#
# Everything that can run on this machine does (ADR-026), the same way
# Malafat's `pnpm release` works:
#   1. npm run build:hosted at the repo root (MUT-45): the hosted-portal
#      bundle, copied into this build context as dist-hosted/.
#   2. docker build (linux/amd64) with your local daemon, docker push to
#      Artifact Registry as mutaba3a-api:<short git sha>. The image serves
#      dist-hosted/ from the same origin as the API (hosted-portal.md §9).
#      MUT-347: an image that already holds this clean HEAD is reused (steps 1
#      and 2 are skipped), and a tag is never pushed over (src/scripts/release-image.ts).
#      MUT-441: while server_ocr_enabled, also receipt-ocr:<short git sha> from
#      server/ocr (lib/receipt-ocr.sh), reused and never pushed over the same way.
#   3. Cloud SQL Auth Proxy on 127.0.0.1:5440, then `prisma migrate deploy` and the read-only pre-roll checks (src/scripts/pre-roll.ts)
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
# Roll back (MUT-347): ROLLBACK_TO=<sha|api-vX.Y.Z> ./scripts/deploy.sh, or
# make rollback-server SHA=…, rolls back to the image that commit already has.
# No build and no migration; its gates and step matrix are in lib/rollback.sh.
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
LEGACY_STACK="${LEGACY_STACK:-0}"
TFVARS_FILE="${TFVARS_FILE:-${ENVIRONMENT}.tfvars}"
[[ "${LEGACY_STACK}" == "1" && "${TFVARS_FILE}" == "${ENVIRONMENT}.tfvars" ]] && TFVARS_FILE="legacy.tfvars"

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "${SERVER_DIR}/.." && pwd)"
TF_DIR="${SERVER_DIR}/infrastructure/terraform"
# MUT-487 (AM8): one terraform data dir per project, so the old and the new stack never share an init.
export TF_DATA_DIR="${TF_DATA_DIR:-${TF_DIR}/.terraform-${GCP_PROJECT_ID}}"
SHORT_SHA="${IMAGE_TAG:-$(git -C "${SERVER_DIR}" rev-parse --short HEAD)}"
REGISTRY="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REPO}"
IMAGE="${REGISTRY}/mutaba3a-api:${SHORT_SHA}"
SUFFIX=""; [[ "${ENVIRONMENT}" == "production" ]] || SUFFIX="-${ENVIRONMENT}"
SERVICE_NAME="mutaba3a-api${SUFFIX}"
PROXY_PID=""
ROLLBACK_TO="${ROLLBACK_TO:-}"

info() { printf '\033[0;36m[deploy]\033[0m %s\n' "$*"; }
die()  { printf '\033[0;31m[deploy] %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[0;33m[deploy] %s\033[0m\n' "$*" >&2; }
need() { command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 ($2)"; }
cleanup() { if [[ -n "${PROXY_PID}" ]]; then kill "${PROXY_PID}" 2>/dev/null || true; fi; }
trap cleanup EXIT
# shellcheck source=lib/tf-bootstrap.sh
source "${SERVER_DIR}/scripts/lib/tf-bootstrap.sh"
# shellcheck source=lib/release-guard.sh
source "${SERVER_DIR}/scripts/lib/release-guard.sh"
# shellcheck source=lib/db-checks.sh
source "${SERVER_DIR}/scripts/lib/db-checks.sh"
# shellcheck source=lib/receipt-ocr.sh
source "${SERVER_DIR}/scripts/lib/receipt-ocr.sh"
# shellcheck source=lib/rollback.sh
source "${SERVER_DIR}/scripts/lib/rollback.sh"
# MUT-487 / MUT-360 / MUT-148 / MUT-359 / MUT-471: the release guards with this release's own terraform arguments; run inside TF_DIR.
guard_release() {
  guard_project_release "${GCP_PROJECT_ID}"
  (cd "${TF_DIR}" && guard_ingress_release "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}" \
    && guard_stripe_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}" \
    && guard_sentry_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}" \
    && guard_mailer_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}" \
    && guard_min_build_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}")
}
# MUT-148 (ADR-091): pre-roll and post-roll run here, not in Cloud Run, so they get the API's DSN from Secret
# Manager. Re-read before each step: the release that turns sentry_enabled on creates the secret in step 4.
SCRIPT_SENTRY_ENV=()
script_sentry_env() {
  SCRIPT_SENTRY_ENV=(SERVICE_VERSION="${SHORT_SHA}" SENTRY_ENVIRONMENT="${ENVIRONMENT}")
  [[ "${SENTRY_ENABLED}" == "true" ]] || return 0
  local dsn
  if dsn="$(gcloud secrets versions access latest --secret="mutaba3a-api-sentry-dsn${SUFFIX}" --project="${GCP_PROJECT_ID}" 2>/dev/null)"; then
    SCRIPT_SENTRY_ENV+=(SENTRY_DSN="${dsn}")
  else
    warn "mutaba3a-api-sentry-dsn${SUFFIX} has no version yet (step 4 creates it); this step's crashes are logged, not reported"
  fi
}
# The Cloud SQL Auth Proxy on 127.0.0.1:PROXY_PORT, for steps 3 and 6; needs SQL_CONNECTION (step 0). It
# refuses a port something already listens on: an old proxy there would take the migration to its instance.
start_proxy() {
  info "starting cloud-sql-proxy for ${SQL_CONNECTION} on 127.0.0.1:${PROXY_PORT}"
  db_start_proxy "${SQL_CONNECTION}" "${PROXY_PORT}"
  PROXY_PID="${DB_PROXY_PID}"
}
stop_proxy() { kill "${PROXY_PID}" 2>/dev/null || true; PROXY_PID=""; }
# Step 4: roll the service to TF_ARGS's image_tag and reconcile everything else. Sets SERVICE_URL and PUBLIC_PORTAL_ORIGIN.
apply_release() {
  guard_release
  pushd "${TF_DIR}" >/dev/null
  info "applying the full stack at ${SHORT_SHA}"
  terraform apply "${TF_ARGS[@]}" "${APPROVE[@]+"${APPROVE[@]}"}"
  SERVICE_URL="$(terraform output -raw service_url 2>/dev/null || true)"
  # MUT-326: where users reach the portal (the custom domain from config/hosts.json's stage "live" on).
  PUBLIC_PORTAL_ORIGIN="$(terraform output -raw public_portal_origin 2>/dev/null || true)"
  popd >/dev/null
  [[ -n "${SERVICE_URL}" ]] || die "terraform did not create the Cloud Run service (no service_url output); fix the error above and re-run this script — everything already created is kept"
}
# Step 5: smoke the API and portal both (server/src/smoke.ts). An empty EXPECT_ERROR_REPORTING skips that check.
smoke_release() {
  local expect=()
  [[ -n "${EXPECT_ERROR_REPORTING}" ]] && expect=(--expect-error-reporting "${EXPECT_ERROR_REPORTING}")
  info "smoke-testing ${SERVICE_URL}"
  pushd "${SERVER_DIR}" >/dev/null
  npm run --silent smoke -- --url "${SERVICE_URL}" --expect-version "${SHORT_SHA}" "${expect[@]+"${expect[@]}"}"
  # Through the front door too, once users are sent there (ADR-155): same checks, the Worker's path.
  if [[ -n "${PUBLIC_PORTAL_ORIGIN}" && "${PUBLIC_PORTAL_ORIGIN}" != "${SERVICE_URL}" ]]; then
    info "smoke-testing ${PUBLIC_PORTAL_ORIGIN} (the front door)"
    npm run --silent smoke -- --url "${PUBLIC_PORTAL_ORIGIN}" --expect-version "${SHORT_SHA}" "${expect[@]+"${expect[@]}"}"
  fi
  popd >/dev/null
}

# MUT-487 (ADR-232): only config/gcp.json's project, or the old one with LEGACY_STACK=1. Before anything else.
guard_project_release "${GCP_PROJECT_ID}"
info "stack: project=${GCP_PROJECT_ID} bucket=${TF_STATE_BUCKET} LEGACY_STACK=${LEGACY_STACK} tfvars=${TFVARS_FILE} TF_DATA_DIR=${TF_DATA_DIR}"

# MUT-347: a rollback builds nothing and migrates nothing; lib/rollback.sh runs it end to end.
if [[ -n "${ROLLBACK_TO}" ]]; then
  rollback_main
  exit 0
fi

need gcloud "https://cloud.google.com/sdk/docs/install"
need docker "Docker Desktop, daemon running"
need cloud-sql-proxy "brew install cloud-sql-proxy"
need terraform "brew install terraform"
need node "node 22"
docker info >/dev/null 2>&1 || die "the docker daemon is not running"
[[ -f "${TF_DIR}/${TFVARS_FILE}" ]] || die "missing ${TF_DIR}/${TFVARS_FILE} (copy ${TFVARS_FILE}.example)"
# The image now bundles the hosted-portal build (MUT-45) alongside server/, so
# the whole repo must be clean for the tag to name everything that went in.
TREE_DIRTY="false"; [[ -n "$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null)" ]] && TREE_DIRTY="true"
if [[ "${TREE_DIRTY}" == "true" && -z "${IMAGE_TAG:-}" ]]; then
  die "the repo has uncommitted changes; commit first so the image tag names what you deploy (or pass IMAGE_TAG=)"
fi
HEAD_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD)"

# MUT-324 (D11): web first. People are asked to accept the terms this release names, so that exact
# text must already be on the public site. `make release server` also checks it in its preflight,
# before the version bump and push; this second check costs one fetch and holds whatever runs this.
# SKIP_TERMS_CHECK=1 only for an emergency fix that keeps the version.
if [[ "${SKIP_TERMS_CHECK:-}" == "1" ]]; then
  info "WARNING: skipping the terms check (SKIP_TERMS_CHECK=1)"
else
  MUTABA3A_ENVIRONMENT="${ENVIRONMENT}" npm --prefix "${SERVER_DIR}" run --silent terms:check-live || die "the terms check failed (above); if the version isn't listed yet, release web first (make release web)"
fi

info "environment=${ENVIRONMENT} project=${GCP_PROJECT_ID} region=${GCP_REGION} tag=${SHORT_SHA}"

# ---------------------------------------------------------------------------
# 0. Terraform init (remote state); on a first run, the registry and database
# ---------------------------------------------------------------------------
pushd "${TF_DIR}" >/dev/null
terraform init -reconfigure -input=false \
  -backend-config="bucket=${TF_STATE_BUCKET}" \
  -backend-config="prefix=mutaba3a-api/${ENVIRONMENT}" >/dev/null
TF_ARGS=(-input=false -var-file="${TFVARS_FILE}" -var "image_tag=${SHORT_SHA}")
APPROVE=(); [[ "${AUTO_APPROVE}" == "1" ]] && APPROVE=(-auto-approve)
# Never reopen a service a restore or a project move holds closed as a side effect of a release. Checked here,
# before the bootstrap apply, and again before steps 3 and 4. SKIP_INGRESS_GUARD=1 skips it (lib/release-guard.sh).
guard_ingress_release "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}"
# MUT-360: never switch Stripe off as a side effect of a release (a checkout whose production.tfvars lacks
# stripe_enabled = true). On by default; SKIP_STRIPE_GUARD=1 skips it (lib/release-guard.sh).
guard_stripe_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}"
# MUT-148: never switch error reports off as a side effect of a release. Also sets SENTRY_ENABLED, which the
# smoke checks against /health (D4). On by default; SKIP_SENTRY_GUARD=1 skips the check (lib/release-guard.sh).
guard_sentry_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}"
EXPECT_ERROR_REPORTING="off"; [[ "${SENTRY_ENABLED}" == "true" ]] && EXPECT_ERROR_REPORTING="on"
# MUT-359 (D22): never switch mail off as a side effect of a release (a checkout whose production.tfvars lacks
# mailer = "resend"). On by default; SKIP_MAILER_GUARD=1 skips it (lib/release-guard.sh).
guard_mailer_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}"
# MUT-471: never change the phone minimum builds or their kill switch as a side effect of a release (a stale or
# incomplete production.tfvars). ALLOW_MIN_BUILD_CHANGE names a meant change; SKIP_MIN_BUILD_GUARD=1 skips it (lib/release-guard.sh).
guard_min_build_release "${SUFFIX}" "${SERVICE_NAME}" "${GCP_REGION}" "${GCP_PROJECT_ID}" "${TF_ARGS[@]}"
# MUT-368 (D6): with mail on, the portal built below must carry the production Turnstile site key, not a test key.
guard_turnstile_site_key "${TF_ARGS[@]}"
# MUT-441 (F6): the receipt-ocr service runs the same commit as the API; its image is built in step 2b.
ocr_read_enabled "${TF_ARGS[@]}"
OCR_IMAGE="${REGISTRY}/receipt-ocr:${SHORT_SHA}"
[[ "${OCR_ENABLED}" == "true" ]] && TF_ARGS+=(-var "ocr_image_tag=${SHORT_SHA}")
# First run only: the registry must exist before `docker push`, the database
# before the migration. Skipped once they are in state (lib/tf-bootstrap.sh).
ensure_bootstrap "${TF_ARGS[@]}" "${APPROVE[@]}"
LOCAL_DATABASE_URL="$(terraform output -raw local_database_url)"
SQL_CONNECTION="$(terraform output -raw cloud_sql_connection_name)"
popd >/dev/null

# MUT-347: never push over a tag. A tag that already holds this clean HEAD (a re-run), built with the same portal
# settings, is reused as it is; a tag that holds anything else is refused (src/scripts/release-image.ts). The portal
# bundle bakes in ENVIRONMENT and deploy.env's MUTABA3A_* settings, so their hash is part of what an image holds.
PORTAL_CONFIG="$({ printf 'ENVIRONMENT=%s\n' "${ENVIRONMENT}"; { env | LC_ALL=C grep '^MUTABA3A_' || true; } | LC_ALL=C sort; } | shasum -a 256 | cut -d' ' -f1)"
IMAGE_PLAN="$(REGISTRY_TOKEN="$(gcloud auth print-access-token)" npm --prefix "${SERVER_DIR}" run --silent release-image -- deploy-plan --image "${IMAGE}" --head "${HEAD_SHA}" --dirty "$([[ "${TREE_DIRTY}" == "true" ]] && echo 1 || echo 0)" --config "${PORTAL_CONFIG}")" \
  || die "refusing to deploy ${IMAGE} (above)"
if [[ "${IMAGE_PLAN}" == "reuse" ]]; then
  info "reusing ${IMAGE}: it already holds ${HEAD_SHA:0:12}; skipping the bundle, the build and the push"
else
  # ---------------------------------------------------------------------------
  # 1. Build the hosted-portal bundle, copy it into the Docker build context
  # ---------------------------------------------------------------------------
  # MUT-149: a DSN without the upload token would ship crash reports with unreadable stacks, so it stops here
  if [[ -n "${MUTABA3A_SENTRY_DSN:-}" && -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
    die "MUTABA3A_SENTRY_DSN is set but SENTRY_AUTH_TOKEN is not: export it, or store it once in the Keychain (DEPLOYMENT.md §1.5 step 3)"
  fi
  if [[ -z "${MUTABA3A_SENTRY_DSN:-}" && -n "${SENTRY_AUTH_TOKEN:-}" ]]; then
    warn "SENTRY_AUTH_TOKEN is set but MUTABA3A_SENTRY_DSN is not: the portal ships without crash reports, no maps uploaded"
  fi
  # The portal ships inside this image, so it versions with the API (ADR-091 am.6's release format)
  MUTABA3A_SENTRY_RELEASE="mutaba3a-portal@$(node -p "require('${SERVER_DIR}/package.json').version")+${SHORT_SHA}"
  MUTABA3A_SENTRY_ENVIRONMENT="${ENVIRONMENT}"
  export MUTABA3A_SENTRY_RELEASE MUTABA3A_SENTRY_ENVIRONMENT
  pushd "${REPO_ROOT}" >/dev/null
  info "building the hosted-portal bundle (npm run build:hosted)"
  npm ci --no-audit --no-fund
  npm run --silent build:hosted
  # TD-084: prove the bundle this release ships (no Sentry in the entry, no maps, no fixtures or tokens, no new origin)
  info "checking the hosted-portal bundle (check-bundles --dist dist-hosted)"
  npx --no-install tsx scripts/check-bundles.ts --dist dist-hosted
  popd >/dev/null
  rm -rf "${SERVER_DIR}/dist-hosted"
  cp -r "${REPO_ROOT}/dist-hosted" "${SERVER_DIR}/dist-hosted"

  # ---------------------------------------------------------------------------
  # 2. Build the image locally, push
  # ---------------------------------------------------------------------------
  pushd "${SERVER_DIR}" >/dev/null
  info "building ${IMAGE} with the local docker daemon"
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet
  # MUT-347: the labels a reuse or a rollback reads back (release-image.ts): the commit, whether IMAGE_TAG let a dirty
  # tree in, and the portal settings it was built with.
  docker build --platform linux/amd64 --label "org.opencontainers.image.revision=${HEAD_SHA}" --label "dirty=${TREE_DIRTY}" \
    --label "portal-config=${PORTAL_CONFIG}" -t "${IMAGE}" .
  info "pushing ${IMAGE}"
  docker push "${IMAGE}"
  popd >/dev/null
fi

# ---------------------------------------------------------------------------
# 2b. MUT-441: the receipt-ocr image, only while server_ocr_enabled (lib/receipt-ocr.sh)
# ---------------------------------------------------------------------------
if [[ "${OCR_ENABLED}" == "true" ]]; then
  ocr_release_image "${OCR_IMAGE}" "${HEAD_SHA}" "${TREE_DIRTY}" "${SERVER_DIR}"
fi
pushd "${SERVER_DIR}" >/dev/null

# ---------------------------------------------------------------------------
# 3. Migrate from this machine through the Cloud SQL Auth Proxy
# ---------------------------------------------------------------------------
guard_release # the build took minutes: a cutover may have started since step 0
start_proxy
info "running prisma migrate deploy"
DATABASE_URL="${LOCAL_DATABASE_URL}" npx prisma migrate deploy \
  || die "migration failed; the service was NOT rolled. Fix the migration and re-run."
# MUT-373 (OV1b): a stray membership on an owned profile would make its holder an owner once this revision serves.
info "running pre-roll checks"
script_sentry_env
env "${SCRIPT_SENTRY_ENV[@]}" DATABASE_URL="${LOCAL_DATABASE_URL}" npm run --silent pre-roll \
  || die "pre-roll checks failed; the service was NOT rolled. Fix what they name and re-run."
stop_proxy
popd >/dev/null

# ---------------------------------------------------------------------------
# 4. Roll the service and reconcile everything else
# ---------------------------------------------------------------------------
apply_release

# ---------------------------------------------------------------------------
# 5. Smoke (API and portal both — see server/src/smoke.ts)
# ---------------------------------------------------------------------------
smoke_release

# ---------------------------------------------------------------------------
# 6. Post-roll data repairs (see server/src/scripts/post-roll.ts)
# ---------------------------------------------------------------------------
# After the roll and the smoke, so the old revision has drained. Idempotent: a
# re-run runs it again and finds 0 rows. A rollback (ROLLBACK_TO) skips it:
# these repairs are HEAD's, not the old code's (lib/rollback.sh).
pushd "${SERVER_DIR}" >/dev/null
start_proxy
info "running post-roll data repairs"
script_sentry_env
env "${SCRIPT_SENTRY_ENV[@]}" DATABASE_URL="${LOCAL_DATABASE_URL}" npm run --silent post-roll \
  || die "post-roll repairs failed; the service IS rolled and healthy. Re-run ./scripts/deploy.sh (every step is idempotent) or 'DATABASE_URL=… npm run post-roll' through 'npm run db:proxy'."
stop_proxy
popd >/dev/null

info "done: ${SERVICE_NAME} serves ${SHORT_SHA} at ${SERVICE_URL}"
