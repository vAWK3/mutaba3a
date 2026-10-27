#!/usr/bin/env bash
# Runs src/scripts/mail-preview.ts (what `npm run mail:preview` calls) with what --send needs filled in, so an
# operator never pastes or exports it:
#   RESEND_API_KEY      Secret Manager's mutaba3a-api-resend-api-key (what the live API mounts), only with --send
#   MAIL_FROM_ADDRESS   no-reply@<mailDomain> from config/hosts.json (as email.tf sets it)
#   PORTAL_ORIGIN       config/hosts.json's portalOrigin (serves /mail/v1)
#   WEBSITE_ORIGIN      config/hosts.json's landingOrigin
# A variable already set in the environment wins. Project: GCP_PROJECT_ID, else project_id in
# infrastructure/terraform/${ENVIRONMENT:-production}.tfvars, like live-admin.sh. The key lives only in this
# process's environment. Needs gcloud signed in with secretAccessor on the secret.
set -euo pipefail

die() { printf 'mail-preview: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

environment="${ENVIRONMENT:-production}"
suffix=""; [[ "${environment}" == production ]] || suffix="-${environment}"
host() { npm --prefix .. run --silent hosts -- get "$1" --env "${environment}" 2>/dev/null || true; }

[[ -n "${WEBSITE_ORIGIN:-}" ]] || WEBSITE_ORIGIN="$(host landingOrigin)"
export WEBSITE_ORIGIN

if [[ " $* " == *" --send "* ]]; then
  [[ -n "${PORTAL_ORIGIN:-}" ]] || PORTAL_ORIGIN="$(host portalOrigin)"
  if [[ -z "${MAIL_FROM_ADDRESS:-}" ]]; then
    mail_domain="$(host mailDomain)"
    [[ -n "${mail_domain}" ]] && MAIL_FROM_ADDRESS="no-reply@${mail_domain}"
  fi
  [[ -n "${PORTAL_ORIGIN:-}" && -n "${MAIL_FROM_ADDRESS:-}" ]] \
    || die "no portal origin or mail domain: npm install at the repo root so config/hosts.json resolves"
  if [[ -z "${RESEND_API_KEY:-}" ]]; then
    command -v gcloud >/dev/null 2>&1 || die "missing tool: gcloud (https://cloud.google.com/sdk/docs/install)"
    project="${GCP_PROJECT_ID:-$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
      "infrastructure/terraform/${environment}.tfvars" 2>/dev/null | head -1)}"
    [[ -n "${project}" ]] || die "GCP project unknown: set GCP_PROJECT_ID or project_id in infrastructure/terraform/${environment}.tfvars"
    secret="mutaba3a-api-resend-api-key${suffix}"
    RESEND_API_KEY="$(gcloud secrets versions access latest --secret="${secret}" --project="${project}")" \
      || die "could not read ${secret} in ${project} (gcloud auth login?)"
    [[ -n "${RESEND_API_KEY}" ]] || die "${secret} in ${project} is empty"
    printf 'mail-preview: sending from %s, art from %s (key from %s)\n' "${MAIL_FROM_ADDRESS}" "${PORTAL_ORIGIN}" "${project}" >&2
  fi
  export RESEND_API_KEY MAIL_FROM_ADDRESS PORTAL_ORIGIN
fi

exec npx tsx src/scripts/mail-preview.ts "$@"
