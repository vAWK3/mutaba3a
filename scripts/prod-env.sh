#!/usr/bin/env bash
#
# Production operator shell: the project, the account, the API's URL and the
# secrets the server scripts read, all from gcloud (Secret Manager), never a file.
#
#   source scripts/prod-env.sh            # from the mini-crm folder, once per shell
#
# Then, from server/ (the users scripts default to localhost, so pass --url):
#   npm run billing:uncovered -- --url "$URL"
#   npm run billing:product-tiers
#
# Prints names only, never a secret's value. Needs gcloud signed in as the
# account deploy.env names (gcloud auth login <that account>).

_prod_env_root="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

export GCP_PROJECT_ID=mtb3a-production GCP_REGION=europe-west1
export CLOUDSDK_CORE_ACCOUNT="$(sed -n 's/^GCP_ACCOUNT=//p' "${_prod_env_root}/deploy.env")"

# _prod_secret VAR secret-id: export VAR from Secret Manager, or say why not.
_prod_secret() {
  local value
  if value="$(gcloud secrets versions access latest --secret="$2" --project="$GCP_PROJECT_ID" 2>/dev/null)"; then
    export "$1=$value"
    echo "  ✓ $1"
  else
    echo "  ✗ $1: could not read $2 as ${CLOUDSDK_CORE_ACCOUNT:-the active account} (gcloud auth login?)"
  fi
}

echo "Production env (${GCP_PROJECT_ID}, ${CLOUDSDK_CORE_ACCOUNT:-no GCP_ACCOUNT in deploy.env}):"
if URL="$(gcloud run services describe mutaba3a-api --region="$GCP_REGION" --project="$GCP_PROJECT_ID" --format='value(status.url)' 2>/dev/null)" && [[ -n "$URL" ]]; then
  export URL MUTABA3A_URL="$URL"
  echo "  ✓ URL ${URL}"
else
  echo "  ✗ URL: could not describe the mutaba3a-api service"
fi
_prod_secret MUTABA3A_ADMIN_TOKEN mutaba3a-api-admin-token
_prod_secret STRIPE_SECRET_KEY mutaba3a-api-stripe-secret-key
_prod_secret MUTABA3A_JOB_TOKEN mutaba3a-api-job-token

unset -f _prod_secret
unset _prod_env_root
