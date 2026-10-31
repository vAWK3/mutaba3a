#!/usr/bin/env bash
#
# Deploys the web app to Netlify from this checkout.
#
#   scripts/netlify-deploy.sh 0.4.2      # build HEAD here, publish it to production
#
# Git builds are stopped on the mutaba3a Netlify site ("Stop builds"), so a push
# to main deploys nothing: every push used to be a production deploy, and those
# spent the Barmajiyat team's Netlify credits. Only this script deploys, from
# `make release web` and `make deploy web`.
#
# The CLI runs netlify.toml's build command here (build:web + the bundle guard)
# with CONTEXT=production and the site's Netlify env vars. SENTRY_AUTH_TOKEN is a
# secret var Netlify never hands to the CLI, so it comes from the environment or
# the release-kit Keychain item, as in release-server.

set -euo pipefail

C_GREEN=$'\033[0;32m'; C_YELLOW=$'\033[1;33m'; C_RED=$'\033[0;31m'; C_NC=$'\033[0m'

VERSION="${1:?usage: $0 <version>}"
SITE="${NETLIFY_SITE:?NETLIFY_SITE is not set (the Makefile sets it)}"
KEYCHAIN_SERVICE="${SENTRY_TOKEN_KEYCHAIN_SERVICE:-release-kit}"
KEYCHAIN_ACCOUNT="${SENTRY_TOKEN_KEYCHAIN_ACCOUNT:-barmajiyat/SENTRY_AUTH_TOKEN}"

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

SHA="$(git rev-parse --short HEAD)"
printf '\nDeploying web v%s (%s) to Netlify production\n' "$VERSION" "$SHA"

if ! netlify deploy --prod --site "$SITE" --message "web v$VERSION ($SHA)"; then
  printf '\n%sThe Netlify deploy failed; the live site is unchanged. Retry with: make deploy web%s\n' "$C_YELLOW" "$C_NC" >&2
  exit 1
fi

printf '\n%s✓ web v%s is live on Netlify%s\n' "$C_GREEN" "$VERSION" "$C_NC"
