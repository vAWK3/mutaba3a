#!/usr/bin/env bash
# Runs one src/scripts/users.ts command against the live API with the admin token from Secret Manager,
# so an operator never pastes or exports it:
#   ./scripts/live-admin.sh signup-reviews [--approve <email> | --decline <email>]
# (what `npm run signups:review` calls). The token always comes from gcloud, never the environment, and
# lives only in this process's environment. The URL is config/hosts.json's portalOrigin unless --url is given.
# Project: GCP_PROJECT_ID, else project_id in infrastructure/terraform/${ENVIRONMENT:-production}.tfvars
# (where the server release gets it). Needs gcloud signed in with secretAccessor on the secret.
set -euo pipefail

die() { printf 'live-admin: %s\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."
command -v gcloud >/dev/null 2>&1 || die "missing tool: gcloud (https://cloud.google.com/sdk/docs/install)"

environment="${ENVIRONMENT:-production}"
suffix=""; [[ "${environment}" == production ]] || suffix="-${environment}"
project="${GCP_PROJECT_ID:-$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' \
  "infrastructure/terraform/${environment}.tfvars" 2>/dev/null | head -1)}"
[[ -n "${project}" ]] || die "GCP project unknown: set GCP_PROJECT_ID or project_id in infrastructure/terraform/${environment}.tfvars"

secret="mutaba3a-api-admin-token${suffix}"
token="$(gcloud secrets versions access latest --secret="${secret}" --project="${project}")" \
  || die "could not read ${secret} in ${project} (gcloud auth login?)"
[[ -n "${token}" ]] || die "${secret} in ${project} is empty"

args=("$@")
if [[ " $* " != *" --url"* ]]; then
  url="$(npm --prefix .. run --silent hosts -- get portalOrigin --env "${environment}" 2>/dev/null || true)"
  [[ -n "${url}" ]] || die "no API URL: pass --url, or npm install at the repo root so config/hosts.json resolves"
  args+=(--url "${url}")
  printf 'live-admin: %s on %s (token from %s)\n' "${1:-}" "${url}" "${project}" >&2
fi

MUTABA3A_ADMIN_TOKEN="${token}" exec npx tsx src/scripts/users.ts "${args[@]}"
