# deploy.sh step 0: the resources that must exist before the image is pushed
# and the migration runs. Sourced by scripts/deploy.sh; tested by
# src/scripts/__tests__/deploy-bootstrap.test.ts through a fake `terraform`.
#
# The targeted apply is for a first run on an empty project only. Once these
# four addresses are in state it is skipped: a targeted plan refuses any
# pending `moved` block, so a release would stop here whenever main carries
# a Terraform rename that has not been applied yet (MUT-328 blocked api
# v0.3.18 this way, 2026-10-20). Walking a rename belongs to the operator
# step that introduced it (DEPLOYMENT.md §6b), or to step 4's full apply,
# never to the bootstrap. ADR-161.

BOOTSTRAP_TARGETS=(
  google_artifact_registry_repository.images
  google_sql_user.api
  google_sql_database.mutaba3a
  google_secret_manager_secret_version.database_url
)

type info >/dev/null 2>&1 || info() { printf '[deploy] %s\n' "$*"; }

# Prints the bootstrap addresses absent from state, one per line. With no
# state at all (first run) every address is missing.
bootstrap_missing() {
  local present target
  present="$(terraform state list 2>/dev/null || true)"
  for target in "${BOOTSTRAP_TARGETS[@]}"; do
    grep -qxF -- "${target}" <<<"${present}" || printf '%s\n' "${target}"
  done
}

# ensure_bootstrap <terraform apply args…>: applies only BOOTSTRAP_TARGETS,
# and only when at least one of them is not in state yet.
ensure_bootstrap() {
  local missing target
  local -a targets=()
  missing="$(bootstrap_missing)"
  if [[ -z "${missing}" ]]; then
    info "registry and database already in state; skipping the bootstrap apply (step 4 reconciles everything)"
    return 0
  fi
  info "bootstrapping (not in state yet): $(tr '\n' ' ' <<<"${missing}")"
  for target in "${BOOTSTRAP_TARGETS[@]}"; do targets+=("-target=${target}"); done
  terraform apply "$@" "${targets[@]}"
}
