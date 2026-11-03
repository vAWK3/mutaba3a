#!/usr/bin/env bash
#
# Deploys the website (Netlify) through the release gate (~/Work/tools/release-gate,
# web standard; MUT-551). The gate is the only thing that deploys it:
#
#   scripts/netlify-deploy.sh production   # make deploy web / make release web
#   scripts/netlify-deploy.sh preview      # make deploy-preview: a smoked draft, never published
#   scripts/netlify-deploy.sh check        # make deploy-check: the deploy's preflight only, deploys nothing
#
# A production deploy: the gate's preflight (WD-1 Netlify Git builds off, WD-2 no
# raw deploy call, WD-3 clean local main), then HEAD of local main is checked out
# clean under the temp dir and built there through the heavy queue (netlify.toml's
# build command: build:web + the bundle guard), uploaded as a Netlify draft and
# smoked (release/gate.config.mjs, surface "web"), then deployed to production
# from the same checkout and smoked again on the production domain. A failure
# after the switch prints the rollback command; nothing rolls back on its own.
#
# Git builds are stopped on the mutaba3a Netlify site, so a push to main deploys
# nothing. SENTRY_AUTH_TOKEN is a secret var Netlify never hands to the CLI, so it
# comes from the environment or the release-kit Keychain item, as in release-server.
# Production never ships with telemetry off (WD-5): SENTRY_ENABLED and
# POSTHOG_ENABLED are unset for the gate.

set -euo pipefail

C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

MODE="${1:?usage: $0 production|preview|check}"
RELEASE_GATE="${RELEASE_GATE:-node $HOME/Work/tools/release-gate/bin/release-gate.mjs}"
KEYCHAIN_SERVICE="${SENTRY_TOKEN_KEYCHAIN_SERVICE:-release-kit}"
KEYCHAIN_ACCOUNT="${SENTRY_TOKEN_KEYCHAIN_ACCOUNT:-barmajiyat/SENTRY_AUTH_TOKEN}"

case "$MODE" in
  check)
    exec $RELEASE_GATE web mini-crm web --env production --dry-run ;;
  production|preview) ;;
  *) printf 'usage: %s production|preview|check\n' "$0" >&2; exit 2 ;;
esac

if ! command -v netlify >/dev/null 2>&1; then
  printf '%snetlify CLI is not installed: npm i -g netlify-cli, then netlify login%s\n' "$C_RED" "$C_NC" >&2
  exit 1
fi

if [[ -z "${SENTRY_AUTH_TOKEN:-}" ]]; then
  SENTRY_AUTH_TOKEN="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null || true)"
  if [[ -z "$SENTRY_AUTH_TOKEN" ]]; then
    printf '%sNo Sentry upload token (SENTRY_AUTH_TOKEN, or Keychain %s / %s): the production build needs it for source maps. Nothing was deployed.%s\n' \
      "$C_RED" "$KEYCHAIN_SERVICE" "$KEYCHAIN_ACCOUNT" "$C_NC" >&2
    exit 1
  fi
  export SENTRY_AUTH_TOKEN
fi

exec env -u SENTRY_ENABLED -u POSTHOG_ENABLED $RELEASE_GATE web mini-crm web --env "$MODE"
