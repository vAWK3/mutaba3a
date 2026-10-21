# shellcheck shell=bash
# deploy.sh (MUT-381, ADR-164): refuse a release that would move the database or reopen a closed service.
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
# SKIP_CMEK_GUARD=1 skips it, like SKIP_TERMS_CHECK: only when the guard itself is what's wrong (a GCP or
# terraform hiccup it can't read past) and you know no CMEK cutover or restore is in progress. The release
# then runs exactly as it did before MUT-381.

# guard_cmek_release <suffix> <service> <region> <project> <terraform args…>
#   <terraform args…>: the apply's own arguments; only -var and -var-file are kept, so `terraform console`
#   sees the same variables (tfvars, *.auto.tfvars, TF_VAR_*) the apply will.
guard_cmek_release() {
  if [[ "${SKIP_CMEK_GUARD:-}" == "1" ]]; then
    warn "WARNING: skipping the CMEK release guard (SKIP_CMEK_GUARD=1)"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  local -a var_args=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -var|-var-file) var_args+=("$1" "${2:-}"); shift 2 ;;
      -var=*|-var-file=*) var_args+=("$1"); shift ;;
      *) shift ;;
    esac
  done

  local values stage ingress
  values="$(printf 'var.cmek_stage\nvar.api_ingress\n' | terraform console ${var_args[@]+"${var_args[@]}"})" \
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
