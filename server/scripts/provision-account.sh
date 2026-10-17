#!/usr/bin/env bash
# Interactive provisioning of a real user account against a remote Mutaba3a
# API deployment (the --url you give it, prod or otherwise — this script has
# no separate "test" mode, it calls the live admin API directly).
#
# The admin token is pulled fresh from GCP Secret Manager on every run (never
# stored in a file or shell history) per the pattern documented in
# server/README.md's "Store-review account" section.
#
# Usage: ./scripts/provision-account.sh
# Must be run from the server/ directory (same as the npm scripts it wraps).

set -euo pipefail

if [[ ! -f package.json ]] || ! grep -q '"provision:user"' package.json; then
  echo "Run this from the server/ directory (npm run provision:user must resolve)." >&2
  exit 1
fi

DEFAULT_URL="https://mutaba3a-api-t5bzsudmja-zf.a.run.app"
SECRET_NAME="mutaba3a-api-admin-token"

echo "== Mutaba3a: provision a live user account =="
echo

default_project="$(gcloud config get-value project 2>/dev/null || true)"
read -rp "GCP project id [${default_project}]: " project_id
project_id="${project_id:-$default_project}"
if [[ -z "$project_id" ]]; then
  echo "A GCP project id is required to read the admin token secret." >&2
  exit 1
fi

echo "Fetching admin token from Secret Manager ($SECRET_NAME @ $project_id)..."
MUTABA3A_ADMIN_TOKEN="$(gcloud secrets versions access latest \
  --secret="$SECRET_NAME" --project="$project_id")"
export MUTABA3A_ADMIN_TOKEN
if [[ -z "$MUTABA3A_ADMIN_TOKEN" ]]; then
  echo "Got an empty token back from Secret Manager — aborting." >&2
  exit 1
fi
echo "Token retrieved (not printed)."
echo

read -rp "API base URL [${DEFAULT_URL}]: " url
url="${url:-$DEFAULT_URL}"
# Tolerate pasting a full sign-in link instead of the bare API origin.
url="${url%/sign-in}"
url="${url%/}"

read -rp "New user's email: " email
if [[ -z "$email" ]]; then
  echo "Email is required." >&2
  exit 1
fi

read -rp "New user's display name: " name
if [[ -z "$name" ]]; then
  echo "Name is required." >&2
  exit 1
fi

read -rp "Organization id to attach to (leave blank for a solo/personal account): " org_id

currency=""
timezone=""
if [[ -z "$org_id" ]]; then
  read -rp "Default currency [ILS]: " currency
  currency="${currency:-ILS}"
  read -rp "Timezone [Asia/Jerusalem]: " timezone
  timezone="${timezone:-Asia/Jerusalem}"
fi

read -rp "Locale (en/ar) [ar]: " locale
locale="${locale:-ar}"

args=(--url "$url" --email "$email" --name "$name" --locale "$locale")
if [[ -n "$org_id" ]]; then
  args+=(--organization-id "$org_id")
else
  args+=(--currency "$currency" --timezone "$timezone")
fi

echo
echo "About to run against: $url"
echo "  email:        $email"
echo "  name:         $name"
echo "  organization: ${org_id:-<none, solo account>}"
if [[ -z "$org_id" ]]; then
  echo "  currency:     $currency"
  echo "  timezone:     $timezone"
fi
echo "  locale:       $locale"
read -rp "Proceed? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi

echo
npm run provision:user -- "${args[@]}"
