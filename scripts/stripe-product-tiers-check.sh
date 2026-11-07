#!/usr/bin/env bash
#
# MUT-558 (the MUT-565 fix, pilot runbook §1.12): `make release server` runs this before it asks to deploy. It is
# the read-only check that every Stripe product a live subscription uses carries `metadata.tier`
# (`npm --prefix server run billing:product-tiers`); an untagged one stops its subscriptions mirroring and the
# people paying lapse. Only GET /v1/products and GET /v1/subscriptions are called.
#
#   scripts/stripe-product-tiers-check.sh
#
# The key: STRIPE_SECRET_KEY when the shell sets it, else the API's own key from Secret Manager
# (mutaba3a-api-stripe-secret-key<suffix> in GCP_PROJECT_ID), read with gcloud as the release's account (the
# Makefile exports deploy.env's GCP_ACCOUNT as CLOUDSDK_CORE_ACCOUNT), the same read the pilot runbook gives. The key
# goes to the check through its environment only, never argv, and is never printed. A production release refuses
# a test-mode key: it would check the wrong catalogue.
#
# Exit 0: every product in use is tagged, or SKIP_PRODUCT_TIERS=1. Exit 1: a product is untagged, or the check
# couldn't run (no key, Stripe refused): the release stops before anything is committed, pushed or deployed.
# SKIP_PRODUCT_TIERS=1 skips it, only when Stripe is off in this environment or can't be reached and you have
# checked the tags by hand.
#
# GCLOUD and NPM override the commands (tests).

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENVIRONMENT="${ENVIRONMENT:-production}"
GCLOUD="${GCLOUD:-gcloud}"
NPM="${NPM:-npm}"
SUFFIX=""; [[ "${ENVIRONMENT}" == "production" ]] || SUFFIX="-${ENVIRONMENT}"
SECRET="mutaba3a-api-stripe-secret-key${SUFFIX}"

C_BOLD=$'\033[1m'; C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

printf '\n%sStripe product tiers (MUT-565, read-only)%s\n' "$C_BOLD" "$C_NC"

if [[ "${SKIP_PRODUCT_TIERS:-0}" == "1" ]]; then
  printf '%s! skipped (SKIP_PRODUCT_TIERS=1): a product in use without metadata.tier stops its subscriptions mirroring. Check by hand: pilot runbook §1.12.%s\n' "$C_YELLOW" "$C_NC" >&2
  exit 0
fi

fail() {
  printf '%s✗ %s%s\n' "$C_RED" "$1" "$C_NC" >&2
  printf '%s  Nothing was committed, pushed or deployed. SKIP_PRODUCT_TIERS=1 skips this check, only when Stripe is off in %s or unreachable and you have checked the tags by hand (pilot runbook §1.12).%s\n' "$C_YELLOW" "$ENVIRONMENT" "$C_NC" >&2
  exit 1
}

key="${STRIPE_SECRET_KEY:-}"
source="STRIPE_SECRET_KEY"
if [[ -z "$key" ]]; then
  [[ -n "${GCP_PROJECT_ID:-}" ]] || fail "GCP_PROJECT_ID is not set, so the Stripe key can't be read from Secret Manager (or set STRIPE_SECRET_KEY)."
  key="$("$GCLOUD" secrets versions access latest --secret="$SECRET" --project="$GCP_PROJECT_ID" 2>/dev/null)" \
    || fail "could not read ${SECRET} in ${GCP_PROJECT_ID} as ${CLOUDSDK_CORE_ACCOUNT:-the active gcloud account} (no version, or no access)."
  source="Secret Manager ${SECRET}"
fi
[[ -n "$key" ]] || fail "${source} is empty."
if [[ "$ENVIRONMENT" == "production" && "$key" != *_live_* ]]; then
  fail "${source} holds a test-mode key; a production release checks the live catalogue."
fi

# The key reaches the check through its environment only (never argv), as the runbook's command passes it.
if STRIPE_SECRET_KEY="$key" "$NPM" --prefix "${ROOT}/server" run --silent billing:product-tiers; then
  printf '%s✓ every Stripe product a live subscription uses has a known tier (key from %s)%s\n' "$C_GREEN" "$source" "$C_NC"
  exit 0
fi
fail "the Stripe product-tier check failed (above): tag each product it names (Stripe › Products › Metadata › tier = freelancer, firm or accountant), then release again."
