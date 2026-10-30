# shellcheck shell=bash
# MUT-523: who a release, a project move or a restore drill acts as, for that process and its children only.
# mtb3a-production is owned by barmajiyatltd@gmail.com, which runs the whole move; other sessions on this Mac keep the
# machine's own gcloud account and Application Default Credentials. So nothing here is machine-wide: deploy.env (per
# checkout, git-ignored; the Makefile exports both) may set
#   GCP_ACCOUNT=barmajiyatltd@gmail.com                          -> CLOUDSDK_CORE_ACCOUNT (every gcloud call)
#   GCP_ADC_FILE=~/.config/gcloud/adc-barmajiyatltd.json         -> GOOGLE_APPLICATION_CREDENTIALS (Terraform,
#                                                                   cloud-sql-proxy, client libraries)
# and a checkout that sets neither runs exactly as before. DEPLOYMENT.md §6d C0 makes the file without touching the
# default ADC. Sourced by scripts/deploy.sh, scripts/project-move.sh, scripts/restore-drill.sh and
# ../../scripts/preflight.sh. Tested by src/scripts/__tests__/gcp-identity.test.ts. The caller defines die.

# use_gcp_identity: exports the mapping above. Both or neither: gcloud and Terraform must act as the same person.
use_gcp_identity() {
  if [[ -z "${GCP_ACCOUNT:-}" && -z "${GCP_ADC_FILE:-}" ]]; then return 0; fi
  [[ -n "${GCP_ACCOUNT:-}" && -n "${GCP_ADC_FILE:-}" ]] \
    || die "GCP_ACCOUNT and GCP_ADC_FILE go together (deploy.env): with only one, gcloud and Terraform would act as different people"
  local file="${GCP_ADC_FILE}"
  # make passes deploy.env's values literally, so a leading ~ arrives unexpanded.
  if [[ "${file}" == \~/* ]]; then file="${HOME}/${file#\~/}"; fi
  [[ -f "${file}" ]] || die "GCP_ADC_FILE=${GCP_ADC_FILE} doesn't exist: make it once as DEPLOYMENT.md §6d C0 says (application-default login into a temporary CLOUDSDK_CONFIG, then copy the file)"
  export CLOUDSDK_CORE_ACCOUNT="${GCP_ACCOUNT}"
  export GOOGLE_APPLICATION_CREDENTIALS="${file}"
}

# gcp_identity_summary: one line naming who this run acts as.
gcp_identity_summary() {
  if [[ -n "${GCP_ACCOUNT:-}" ]]; then
    printf 'gcloud account %s, credentials %s\n' "${CLOUDSDK_CORE_ACCOUNT:-${GCP_ACCOUNT}}" "${GOOGLE_APPLICATION_CREDENTIALS:-${GCP_ADC_FILE:-}}"
  else
    printf "the machine's defaults (gcloud's active account, the default Application Default Credentials)\n"
  fi
}

# adc_account_of <credentials file>: the email those credentials sign in as. The ADC file itself doesn't say (its
# `account` is empty), so this mints a token from it and asks Google's tokeninfo. The token goes through a pipe into
# curl's request body: never argv, never printed. Fails (prints nothing) when no token comes back.
adc_account_of() {
  local token
  token="$(GOOGLE_APPLICATION_CREDENTIALS="$1" gcloud auth application-default print-access-token 2>/dev/null)" || return 1
  [[ -n "${token}" ]] || return 1
  printf 'access_token=%s' "${token}" \
    | curl -fsS --max-time 15 --data-binary @- https://oauth2.googleapis.com/tokeninfo 2>/dev/null \
    | node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
        try { process.stdout.write(String(JSON.parse(s).email || "")); } catch { process.exitCode = 1; }
      });'
}

# gcp_identity_problems: for preflight. Prints what is wrong (nothing, status 0, when the credentials file signs in
# as GCP_ACCOUNT, or when the run uses the machine's defaults). Call after use_gcp_identity.
gcp_identity_problems() {
  [[ -n "${GCP_ACCOUNT:-}" ]] || return 0
  local email
  email="$(adc_account_of "${GOOGLE_APPLICATION_CREDENTIALS}")" || email=""
  if [[ -z "${email}" ]]; then
    printf 'could not get a token from %s: make it again (DEPLOYMENT.md §6d C0)\n' "${GOOGLE_APPLICATION_CREDENTIALS}"
    return 1
  fi
  if [[ "${email}" != "${GCP_ACCOUNT}" ]]; then
    printf '%s signs in as %s, not GCP_ACCOUNT=%s: Terraform and gcloud would act as different people\n' "${GOOGLE_APPLICATION_CREDENTIALS}" "${email}" "${GCP_ACCOUNT}"
    return 1
  fi
}
