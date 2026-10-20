#!/usr/bin/env bash
# Interactive provisioning of a real account against a remote Mutaba3a API
# deployment (the URL you give it, prod or otherwise — there is no separate
# "test" mode, it calls the live admin API directly).
#
#   ./scripts/provision-account.sh user       a person with their personal profile
#   ./scripts/provision-account.sh business   a new firm, then a person in it
#                                             (personal profile + the firm's)
#
# From the repo root the same two flows are `make create user` and
# `make create business`, which also pass GCP_PROJECT_ID so nothing is asked
# that the repo already knows.
#
# The admin token is pulled fresh from GCP Secret Manager on every run (never
# stored in a file or shell history) per the pattern documented in
# server/README.md's "Store-review account" section.
#
# Must be run from the server/ directory (same as the npm scripts it wraps).

set -euo pipefail

mode="${1:-user}"
case "$mode" in
  user|business) ;;
  *) echo "usage: $0 [user|business]" >&2; exit 2 ;;
esac

if [[ ! -f package.json ]] || ! grep -q '"provision:user"' package.json; then
  echo "Run this from the server/ directory (npm run provision:user must resolve)." >&2
  exit 1
fi

# The portal/API origin config/hosts.json names (MUT-326); empty if the repo root has no node_modules.
DEFAULT_URL="$(npm --prefix .. run --silent hosts -- get portalOrigin 2>/dev/null || true)"
SECRET_NAME="mutaba3a-api-admin-token"

if [[ "$mode" == business ]]; then
  echo "== Mutaba3a: provision a live firm and its first user =="
else
  echo "== Mutaba3a: provision a live user account =="
fi
echo

# GCP_PROJECT_ID in the environment (what `make create …` passes) skips the prompt.
project_id="${GCP_PROJECT_ID:-}"
if [[ -z "$project_id" ]]; then
  default_project="$(gcloud config get-value project 2>/dev/null || true)"
  read -rp "GCP project id [${default_project}]: " project_id
  project_id="${project_id:-$default_project}"
fi
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
if [[ -z "$url" ]]; then
  echo "An API base URL is required (npm install at the repo root lets this default to config/hosts.json)." >&2
  exit 1
fi

# --- the firm (business mode) -------------------------------------------------
firm_name=""
issue_key="n"
if [[ "$mode" == business ]]; then
  read -rp "Firm name: " firm_name
  if [[ -z "$firm_name" ]]; then
    echo "Firm name is required." >&2
    exit 1
  fi
  read -rp "Firm default currency [ILS]: " currency
  currency="${currency:-ILS}"
  read -rp "Firm timezone [Asia/Jerusalem]: " timezone
  timezone="${timezone:-Asia/Jerusalem}"
  read -rp "Issue a Malafat API key for this firm? [y/N] " issue_key
  issue_key="${issue_key:-n}"
fi

# --- the person ----------------------------------------------------------------
read -rp "User's email: " email
if [[ -z "$email" ]]; then
  echo "Email is required." >&2
  exit 1
fi

read -rp "User's display name: " name
if [[ -z "$name" ]]; then
  echo "Name is required." >&2
  exit 1
fi

org_id=""
if [[ "$mode" == user ]]; then
  read -rp "Organization id to attach to (leave blank for a solo/personal account): " org_id
  if [[ -z "$org_id" ]]; then
    read -rp "Default currency [ILS]: " currency
    currency="${currency:-ILS}"
    read -rp "Timezone [Asia/Jerusalem]: " timezone
    timezone="${timezone:-Asia/Jerusalem}"
  fi
fi

read -rp "Locale (en/ar) [ar]: " locale
locale="${locale:-ar}"

# --- summary + confirm ---------------------------------------------------------
echo
echo "About to run against: $url"
if [[ "$mode" == business ]]; then
  echo "  new firm:     $firm_name"
  echo "  currency:     $currency"
  echo "  timezone:     $timezone"
  echo "  Malafat key:  $([[ "$issue_key" =~ ^[yY]$ ]] && echo yes || echo no)"
fi
echo "  email:        $email"
echo "  name:         $name"
if [[ "$mode" == user ]]; then
  echo "  organization: ${org_id:-<none, solo account>}"
  if [[ -z "$org_id" ]]; then
    echo "  currency:     $currency"
    echo "  timezone:     $timezone"
  fi
fi
echo "  locale:       $locale"
read -rp "Proceed? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Aborted."
  exit 0
fi
echo

# --- create the firm first, keep its id ----------------------------------------
if [[ "$mode" == business ]]; then
  org_args=(--url "$url" --name "$firm_name" --currency "$currency" --timezone "$timezone")
  if [[ "$issue_key" =~ ^[yY]$ ]]; then
    org_args+=(--key-name "Malafat")
  else
    org_args+=(--no-key)
  fi
  # `tee` shows the output (the key secret, if any, is shown once) while we
  # pick the organization id out of the "organization <slug> = <uuid>" line.
  org_out="$(npm run --silent provision -- "${org_args[@]}" | tee /dev/stderr)"
  org_id="$(sed -n 's/^organization .* = \([0-9a-f-]\{36\}\)$/\1/p' <<<"$org_out" | head -1)"
  if [[ -z "$org_id" ]]; then
    echo "Could not read the new organization's id from the output above — the user was NOT created." >&2
    echo "Create them with: ./scripts/provision-account.sh user  (paste the organization id)" >&2
    exit 1
  fi
  echo
fi

# --- create the person ---------------------------------------------------------
args=(--url "$url" --email "$email" --name "$name" --locale "$locale")
if [[ -n "$org_id" ]]; then
  args+=(--organization-id "$org_id")
else
  args+=(--currency "$currency" --timezone "$timezone")
fi
npm run --silent provision:user -- "${args[@]}"
