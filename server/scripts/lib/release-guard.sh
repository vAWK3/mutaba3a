# shellcheck shell=bash
# deploy.sh step 0 (MUT-381, ADR-163): refuse a release that would move the database or reopen a closed
# service. Sourced by scripts/deploy.sh; tested by src/scripts/__tests__/release-guard.test.ts through a
# fake `terraform` and `gcloud`.
#
# A release ends in a full `terraform apply`, so whatever the tfvars in this checkout say happens:
#   * tfvars "active" while mutaba3a-pg serves would switch to a mutaba3a-pg2 nobody has copied or migrated
#     into (the switch belongs to DEPLOYMENT.md §6d, which runs it with ingress closed);
#   * tfvars "off"/"prepared" while mutaba3a-pg2 serves (a stale, git-ignored tfvars in another checkout)
#     would move the API back to the frozen mutaba3a-pg and lose everything written since;
#   * a release while a cutover or a restore holds ingress closed would reopen it mid-copy.
# The caller defines die and runs this inside the terraform dir, after `terraform init`.

# guard_cmek_release <tfvars file> <suffix> <service> <region> <project>
guard_cmek_release() {
  local tfvars="$1" suffix="$2" service="$3" region="$4" project="$5"
  local stage ingress serving want live err rc=0
  stage="$(sed -n 's/^[[:space:]]*cmek_stage[[:space:]]*=[[:space:]]*"\([a-z]*\)".*/\1/p' "${tfvars}" | tail -1)"
  stage="${stage:-off}"
  ingress="$(sed -n 's/^[[:space:]]*api_ingress[[:space:]]*=[[:space:]]*"\([A-Z_]*\)".*/\1/p' "${tfvars}" | tail -1)"
  ingress="${ingress:-INGRESS_TRAFFIC_ALL}"

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

  want="mutaba3a-pg${suffix}"
  [[ "${stage}" == "active" ]] && want="mutaba3a-pg2${suffix}"
  [[ "${want}" == "${serving}" ]] || die "${tfvars##*/} says cmek_stage = \"${stage}\", which serves ${want}, but production serves ${serving}. A release never moves the database: the CMEK switch is DEPLOYMENT.md §6d's printed apply. Set cmek_stage to match what serves (a stale tfvars from another checkout?), then release."

  live="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(metadata.annotations."run.googleapis.com/ingress")' 2>/dev/null || true)"
  if [[ "${live}" == "internal" && "${ingress}" != "INGRESS_TRAFFIC_INTERNAL_ONLY" ]]; then
    die "${service} is closed to outside traffic: a CMEK cutover (DEPLOYMENT.md §6d) or a whole-database restore (pilot runbook §4.3) is in progress, and this release would reopen it mid-way. Finish or roll that back first."
  fi
}
