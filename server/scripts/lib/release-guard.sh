# shellcheck shell=bash
# deploy.sh (MUT-381, ADR-164): refuse a release that would move the database or reopen a closed service.
# (MUT-360: guard_stripe_release, below, refuses one that would switch Stripe off.)
# Sourced by scripts/deploy.sh, which calls it before the bootstrap apply, before the migration and before the
# full apply (each a few minutes apart). Tested by src/scripts/__tests__/release-guard.test.ts through a fake
# `terraform` and `gcloud`.
#
# A release ends in a full `terraform apply`, so whatever this checkout's variables say happens:
#   * cmek_stage "active" while mutaba3a-pg serves would switch to a mutaba3a-pg2 nobody has copied or
#     migrated into (the switch belongs to DEPLOYMENT.md §6d, which runs it with ingress closed);
#   * "off"/"prepared" while mutaba3a-pg2 serves (a stale, git-ignored tfvars in another checkout) would move
#     the API back to the frozen mutaba3a-pg and lose everything written since; "off" once the key exists
#     would plan the key's destroy after the migration ran;
#   * a release while a cutover or a restore holds ingress closed would reopen it mid-copy.
# The caller defines die and warn and runs this inside the terraform dir, after `terraform init`. It fails
# closed: anything it cannot read stops the release.
#
# Off by default while the CMEK epic is unfinished (Basel, 2026-10-21): cmek_stage stays "off", so a release
# changes nothing and runs exactly as it did before MUT-381. SKIP_CMEK_GUARD=0 turns it on; it must be on
# before any CMEK cutover (DEPLOYMENT.md §6d), and MUT-385 makes on the default.

# guard_var_args <terraform args…>: keeps only -var and -var-file in GUARD_VAR_ARGS, so `terraform console`
# sees the same variables (tfvars, *.auto.tfvars, TF_VAR_*) the apply will.
GUARD_VAR_ARGS=()
guard_var_args() {
  GUARD_VAR_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -var|-var-file) GUARD_VAR_ARGS+=("$1" "${2:-}"); shift 2 ;;
      -var=*|-var-file=*) GUARD_VAR_ARGS+=("$1"); shift ;;
      *) shift ;;
    esac
  done
}

# guard_cmek_release <suffix> <service> <region> <project> <terraform args…>
#   <terraform args…>: the apply's own arguments; only -var and -var-file are kept, so `terraform console`
#   sees the same variables (tfvars, *.auto.tfvars, TF_VAR_*) the apply will.
guard_cmek_release() {
  if [[ "${SKIP_CMEK_GUARD:-1}" != "0" ]]; then
    warn "CMEK release guard off (the default until MUT-385; SKIP_CMEK_GUARD=0 turns it on)"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local values stage ingress
  values="$(printf 'var.cmek_stage\nvar.api_ingress\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate cmek_stage and api_ingress with terraform console (above); refusing to release on a guess"
  stage="$(sed -n '1s/"//gp' <<<"${values}")"
  ingress="$(sed -n '2s/"//gp' <<<"${values}")"
  [[ -n "${stage}" && -n "${ingress}" ]] || die "terraform console gave no cmek_stage/api_ingress; refusing to release on a guess"

  local err serving rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  serving="$(terraform output -raw cloud_sql_instance_name 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    # A state applied before MUT-381 has no such output, and then mutaba3a-pg2 can't be serving.
    if grep -q 'Output "cloud_sql_instance_name" not found' "${err}"; then
      serving="mutaba3a-pg${suffix}"
    else
      cat "${err}" >&2; rm -f "${err}"
      die "could not read cloud_sql_instance_name from terraform state (above); refusing to release on a guess"
    fi
  fi
  rm -f "${err}"
  [[ -n "${serving}" ]] || die "terraform output cloud_sql_instance_name is empty: is TF_STATE_BUCKET (and the prefix) right?"

  if [[ "${stage}" == "off" ]] && terraform state list 2>/dev/null | grep -q '^google_kms_crypto_key\.data'; then
    die "cmek_stage = \"off\" but the KMS key exists: this release would plan its destroy (refused by prevent_destroy, after the migration). Set cmek_stage to match what serves."
  fi

  local want="mutaba3a-pg${suffix}"
  [[ "${stage}" == "active" ]] && want="mutaba3a-pg2${suffix}"
  [[ "${want}" == "${serving}" ]] || die "this checkout's cmek_stage = \"${stage}\", which serves ${want}, but production serves ${serving}. A release never moves the database: the CMEK switch is DEPLOYMENT.md §6d's printed apply. Set cmek_stage to match what serves (a stale tfvars from another checkout?), then release."

  local live
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  rc=0
  live="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(metadata.annotations."run.googleapis.com/ingress-status")' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: no service yet, nothing to reopen or to have moved
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s ingress (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  if [[ "${live}" == "internal" && "${ingress}" != "INGRESS_TRAFFIC_INTERNAL_ONLY" ]]; then
    die "${service} is closed to outside traffic: a CMEK cutover (DEPLOYMENT.md §6d) or a whole-database restore (pilot runbook §4.3) is in progress, and this release would reopen it mid-way. Finish or roll that back first."
  fi

  # Terraform state says what should serve; the revisions taking traffic say what does.
  local revs rev mounts conn
  revs="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(status.traffic[].revisionName)')" || die "could not list ${service}'s revisions; refusing to release on a guess"
  for rev in $(tr ';' ' ' <<<"${revs}"); do
    mounts="$(gcloud run revisions describe "${rev}" --region="${region}" --project="${project}" \
      --format='value(metadata.annotations."run.googleapis.com/cloudsql-instances")')" \
      || die "could not read what ${rev} mounts; refusing to release on a guess"
    for conn in $(tr ',' ' ' <<<"${mounts}"); do
      [[ "${conn}" == *":${want}" ]] || die "${rev} mounts ${conn}, but this release would serve ${want}: terraform state and Cloud Run disagree. Find out why before releasing."
    done
  done
}

# MUT-360 (ADR-165): refuse a release whose checkout says stripe_enabled = false (or doesn't set it) while
# production already runs Stripe. stripe_enabled lives in the git-ignored production.tfvars, so a checkout that
# never got the line would release with the default, false: its full apply deletes the nightly reconcile job and
# unmounts the Stripe secrets, and the webhook answers 503 until someone notices. Turning Stripe off is
# DEPLOYMENT.md §6e's own apply, never a side effect of a release.
#
# "Production runs Stripe" is read from Google, not from terraform state: the reconcile job exists, or the
# service's template mounts STRIPE_SECRET_KEY. Either one is enough. On by default; SKIP_STRIPE_GUARD=1 skips it.
# It fails closed like the CMEK guard: anything it cannot read stops the release. It also warns (never refuses)
# when the job is paused, which a CMEK cutover or a whole-database restore leaves to the operator to undo.

# guard_stripe_release <suffix> <service> <region> <project> <terraform args…>
guard_stripe_release() {
  if [[ "${SKIP_STRIPE_GUARD:-0}" == "1" ]]; then
    warn "Stripe release guard skipped (SKIP_STRIPE_GUARD=1)"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local enabled
  enabled="$(printf 'var.stripe_enabled\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate stripe_enabled with terraform console (above); refusing to release on a guess"
  # The first line only, as guard_cmek_release reads its values: a console notice after it must not refuse a release.
  enabled="$(sed -n '1{s/"//g;p;}' <<<"${enabled}")"
  [[ "${enabled}" == "true" || "${enabled}" == "false" ]] \
    || die "terraform console gave '${enabled}' for stripe_enabled; refusing to release on a guess"

  local job="mutaba3a-stripe-reconcile${suffix}" err rc=0 state
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  state="$(gcloud scheduler jobs describe "${job}" --location="${region}" --project="${project}" \
    --format='value(state)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    state=""
    # Stripe on in this checkout: the job only feeds the paused warning, so an unreadable one never stops it.
    if [[ "${enabled}" == "false" ]] && ! grep -qiE 'NOT_FOUND|not found' "${err}"; then
      cat "${err}" >&2; rm -f "${err}"
      die "could not read the Scheduler job ${job} (above); refusing to release on a guess"
    fi
  fi
  rm -f "${err}"
  if [[ "${state}" == "PAUSED" ]]; then
    warn "${job} is paused: the nightly Stripe reconcile doesn't run. If no CMEK cutover or restore holds the database closed, resume it: gcloud scheduler jobs resume ${job} --location=${region} --project=${project}"
  fi
  [[ "${enabled}" == "true" ]] && return 0

  local env_names="" live=""
  if [[ -n "${state}" ]]; then
    live="the Scheduler job ${job} exists"
  else
    err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
    rc=0
    env_names="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
      --format='value(spec.template.spec.containers[0].env[].name)' 2>"${err}")" || rc=$?
    if (( rc != 0 )); then
      if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
        rm -f "${err}"; return 0 # first deploy: nothing runs Stripe yet
      fi
      cat "${err}" >&2; rm -f "${err}"
      die "could not read ${service}'s env (above); refusing to release on a guess"
    fi
    rm -f "${err}"
    if [[ ";${env_names};" == *";STRIPE_SECRET_KEY;"* ]]; then
      live="${service} mounts STRIPE_SECRET_KEY"
    fi
  fi
  [[ -z "${live}" ]] && return 0
  die "this checkout's stripe_enabled is false (or unset), but production runs Stripe: ${live}. This release would delete the nightly reconcile job and unmount the Stripe secrets. Set stripe_enabled = true in this checkout's production.tfvars (git doesn't carry it), then release. To turn Stripe off, use DEPLOYMENT.md §6e's own apply; SKIP_STRIPE_GUARD=1 only if you mean this release to do it."
}

# MUT-148 (ADR-091): refuse a release whose checkout says sentry_enabled = false (or doesn't set it) while the
# service already mounts SENTRY_DSN. Like stripe_enabled it lives in the git-ignored production.tfvars, so a
# checkout without the line would release with the default, false: its full apply deletes the DSN secret and
# the API stops reporting errors without anyone noticing. Turning reports off is a deliberate apply, never a
# side effect of a release.
#
# Sets SENTRY_ENABLED (true|false) for deploy.sh, which tells the smoke what /health must say and hands
# pre-roll and post-roll the DSN. SKIP_SENTRY_GUARD=1 skips the check, never the read. Fails closed.

# guard_sentry_release <suffix> <service> <region> <project> <terraform args…>
# shellcheck disable=SC2034 # read by deploy.sh, which sources this file
SENTRY_ENABLED=""
# shellcheck disable=SC2034 # the same: SENTRY_ENABLED is set here for deploy.sh
guard_sentry_release() {
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local enabled
  enabled="$(printf 'var.sentry_enabled\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate sentry_enabled with terraform console (above); refusing to release on a guess"
  enabled="$(sed -n '1{s/"//g;p;}' <<<"${enabled}")"
  [[ "${enabled}" == "true" || "${enabled}" == "false" ]] \
    || die "terraform console gave '${enabled}' for sentry_enabled; refusing to release on a guess"
  SENTRY_ENABLED="${enabled}"

  if [[ "${SKIP_SENTRY_GUARD:-0}" == "1" ]]; then
    warn "Sentry release guard skipped (SKIP_SENTRY_GUARD=1)"
    return 0
  fi
  [[ "${enabled}" == "true" ]] && return 0

  local env_names err rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  env_names="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(spec.template.spec.containers[0].env[].name)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: nothing reports yet
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s env (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  [[ ";${env_names};" == *";SENTRY_DSN;"* ]] || return 0
  die "this checkout's sentry_enabled is false (or unset), but ${service} mounts SENTRY_DSN. This release would delete the DSN secret and stop error reports. Set sentry_enabled = true in this checkout's production.tfvars (git doesn't carry it), then release. SKIP_SENTRY_GUARD=1 only if you mean this release to turn reports off."
}
