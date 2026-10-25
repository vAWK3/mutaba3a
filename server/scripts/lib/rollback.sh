# shellcheck shell=bash
# MUT-347: a real rollback. `ROLLBACK_TO=<sha|api-vX.Y.Z> ./scripts/deploy.sh` (or `make rollback-server SHA=…`)
# rolls the service back to the image that commit already has in Artifact Registry. Sourced by deploy.sh, never
# run; it uses deploy.sh's helpers (info, die, warn, need, guard_release, start_proxy, apply_release,
# smoke_release). Bash 3.2 compatible (macOS /bin/bash).
#
# Step matrix (DEPLOYMENT.md §6 "Roll back the service"):
#   Runs:  clean-tree and IMAGE_TAG refusals; the terms check against the commit's own CURRENT_TERMS; the image
#          lookup (the commit's short-sha tag, its revision and dirty labels); the infra-drift gate; the 4 release
#          guards (cmek, stripe, sentry, mailer); the migration gate; terraform apply -var image_tag=<that tag>; smoke.
#   Skips: the docker daemon, npm ci, the portal bundle and its check, the Sentry token checks, the Turnstile site
#          key guard (the portal is the image's own), the image build and push, the terraform bootstrap,
#          prisma migrate and the pre-roll checks (migrations are forward-only: the schema stays ahead), and the
#          post-roll repairs (HEAD's repairs don't belong to the old code). Smoke checks error reporting only for
#          images from MUT-148 on, whose /health reports it.
# The hosted portal rolls back with the image. A phone build that calls an endpoint newer than the commit gets
# 404s until you roll forward.

# MUT-148's first commit: /health reports errorReporting from here on (smoke --expect-error-reporting).
ROLLBACK_MUT148_COMMIT="21f1d467"

# rollback_resolve <sha|tag>: the full commit sha, after fetching origin's tags. Dies when the clone lacks it.
rollback_resolve() {
  local ref="$1" commit
  git -C "${REPO_ROOT}" fetch --quiet --tags origin 2>/dev/null || warn "could not fetch origin's tags; resolving ${ref} from this clone"
  commit="$(git -C "${REPO_ROOT}" rev-parse --verify --quiet "${ref}^{commit}")" \
    || die "ROLLBACK_TO=${ref} is not a commit in this clone (a sha, or a release tag like api-v0.8.0)"
  printf '%s\n' "${commit}"
}

# rollback_deployed_tag: the image tag the live service runs (its SERVICE_VERSION, which deploy.sh sets to it).
rollback_deployed_tag() {
  local json tag
  json="$(gcloud run services describe "${SERVICE_NAME}" --region="${GCP_REGION}" --project="${GCP_PROJECT_ID}" --format=json)" \
    || die "could not read ${SERVICE_NAME} (above); a rollback needs to know what it serves"
  tag="$(printf '%s' "${json}" | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>{const env=JSON.parse(s).spec?.template?.spec?.containers?.[0]?.env??[];process.stdout.write(env.find((e)=>e.name==="SERVICE_VERSION")?.value??"")})')"
  [[ -n "${tag}" ]] || die "${SERVICE_NAME} has no SERVICE_VERSION; can't tell what it serves"
  printf '%s\n' "${tag}"
}

# rollback_infra_gate <deployed tag>: terraform apply -var image_tag=<old> also applies this checkout's main.tf
# and tfvars. Plan them at the tag that serves now: anything but "no changes" means this checkout's
# infrastructure differs from what is deployed, and the rollback would ship that difference too. Run in TF_DIR.
rollback_infra_gate() {
  local deployed="$1" out rc=0
  out="$(mktemp "${TMPDIR:-/tmp}/rollback-plan-XXXX")"
  terraform plan -detailed-exitcode -input=false -no-color -var-file="${ENVIRONMENT}.tfvars" -var "image_tag=${deployed}" >"${out}" 2>&1 || rc=$?
  case "${rc}" in
    0) rm -f "${out}"; info "infra-drift gate: this checkout's terraform matches what serves ${deployed}" ;;
    2) grep -E '^  # |^Plan:' "${out}" >&2 || cat "${out}" >&2
       rm -f "${out}"
       die "this checkout's infrastructure differs from what is deployed (above, planned at ${deployed}); a rollback would apply that too. Check out the commit that deployed ${deployed}, or release the difference first" ;;
    *) cat "${out}" >&2; rm -f "${out}"; die "terraform plan failed (above); refusing to roll back on a guess" ;;
  esac
}

# rollback_migration_gate <commit>: the database keeps every migration (forward-only). rollback:check lists the
# ones the commit doesn't know and refuses when a DEPLOYMENT.md "Roll back past" count is above 0; when it lists
# any, the operator types the commit's short sha to go on. Needs LOCAL_DATABASE_URL (the proxy is up).
rollback_migration_gate() {
  local commit="$1" rc=0 answer
  DATABASE_URL="${LOCAL_DATABASE_URL}" npm --prefix "${SERVER_DIR}" run --silent rollback:check -- --commit "${commit}" || rc=$?
  case "${rc}" in
    0) return 0 ;;
    2) printf 'Roll back past those migrations? The schema stays as it is. Type %s to go on: ' "${commit:0:7}" >&2
       read -r answer || answer=""
       [[ "${answer}" == "${commit:0:7}" ]] || die "not confirmed; nothing was rolled back" ;;
    *) die "the migration gate refused the rollback (above); nothing was rolled back" ;;
  esac
}

# rollback_expects_error_reporting <commit>: true when the commit's /health reports errorReporting (MUT-148 on).
rollback_expects_error_reporting() {
  git -C "${REPO_ROOT}" merge-base --is-ancestor "${ROLLBACK_MUT148_COMMIT}" "$1" 2>/dev/null
}

# The globals it sets (SHORT_SHA, IMAGE, TF_ARGS, APPROVE, EXPECT_ERROR_REPORTING, LOCAL_DATABASE_URL, SQL_CONNECTION)
# are read by deploy.sh's apply_release, smoke_release and start_proxy.
# shellcheck disable=SC2034
rollback_main() {
  local commit tag deployed
  [[ -z "${IMAGE_TAG:-}" ]] || die "ROLLBACK_TO and IMAGE_TAG are both set: a rollback deploys the commit's existing image, so unset IMAGE_TAG"
  need gcloud "https://cloud.google.com/sdk/docs/install"
  need cloud-sql-proxy "brew install cloud-sql-proxy"
  need terraform "brew install terraform"
  need node "node 22"
  [[ -f "${TF_DIR}/${ENVIRONMENT}.tfvars" ]] || die "missing ${TF_DIR}/${ENVIRONMENT}.tfvars (copy ${ENVIRONMENT}.tfvars.example)"
  # The drift gate plans this checkout's terraform, so it must be exactly a commit.
  [[ -z "$(git -C "${REPO_ROOT}" status --porcelain 2>/dev/null)" ]] || die "the repo has uncommitted changes; a rollback plans terraform from this checkout, so commit or stash them first"

  commit="$(rollback_resolve "${ROLLBACK_TO}")"
  [[ "${commit}" != "$(git -C "${REPO_ROOT}" rev-parse HEAD)" ]] || die "ROLLBACK_TO=${ROLLBACK_TO} is HEAD: that is a normal deploy (./scripts/deploy.sh)"

  # MUT-324 (D11), MUT-347: the old revision asks people to accept the terms it names, so those must be live.
  if [[ "${SKIP_TERMS_CHECK:-}" == "1" ]]; then
    info "WARNING: skipping the terms check (SKIP_TERMS_CHECK=1)"
  else
    MUTABA3A_ENVIRONMENT="${ENVIRONMENT}" npm --prefix "${SERVER_DIR}" run --silent terms:check-live -- --commit "${commit}" \
      || die "the terms check failed for ${ROLLBACK_TO} (above)"
  fi

  tag="$(REGISTRY_TOKEN="$(gcloud auth print-access-token)" npm --prefix "${SERVER_DIR}" run --silent release-image -- rollback --repository "${REGISTRY}/mutaba3a-api" --commit "${commit}")" \
    || die "no usable image for ${ROLLBACK_TO} (above); nothing was rolled back"
  SHORT_SHA="${tag}"
  IMAGE="${REGISTRY}/mutaba3a-api:${tag}"
  info "rollback: environment=${ENVIRONMENT} project=${GCP_PROJECT_ID} region=${GCP_REGION} to ${ROLLBACK_TO} (${commit:0:12}), image ${IMAGE}"

  tf_init "${TF_DIR}" "${ENVIRONMENT}"
  deployed="$(rollback_deployed_tag)"
  if [[ "${deployed}" == "${tag}" ]]; then
    info "${SERVICE_NAME} already serves ${tag}; nothing to roll back"
    return 0
  fi
  TF_ARGS=(-input=false -var-file="${ENVIRONMENT}.tfvars" -var "image_tag=${tag}")
  APPROVE=(); [[ "${AUTO_APPROVE}" == "1" ]] && APPROVE=(-auto-approve)
  (cd "${TF_DIR}" && rollback_infra_gate "${deployed}")
  guard_release
  EXPECT_ERROR_REPORTING=""
  if rollback_expects_error_reporting "${commit}"; then
    EXPECT_ERROR_REPORTING="off"; [[ "${SENTRY_ENABLED}" == "true" ]] && EXPECT_ERROR_REPORTING="on"
  else
    warn "${ROLLBACK_TO} predates MUT-148: its /health doesn't report error reporting, so smoke won't check it"
  fi
  LOCAL_DATABASE_URL="$(tf_output "${TF_DIR}" local_database_url)" || die "terraform state has no local_database_url"
  SQL_CONNECTION="$(tf_output "${TF_DIR}" cloud_sql_connection_name)" || die "terraform state has no cloud_sql_connection_name"

  start_proxy
  rollback_migration_gate "${commit}"
  stop_proxy

  apply_release # runs the guards again: the gates took a while, and a cutover may have started since
  smoke_release
  info "post-roll repairs skipped: they are HEAD's, not ${ROLLBACK_TO}'s; the next forward deploy runs them"
  info "done: ${SERVICE_NAME} rolled back to ${tag} (${ROLLBACK_TO}) at ${SERVICE_URL}. Roll forward with ./scripts/deploy.sh from main"
}
