#!/usr/bin/env bash
# MUT-487 (ADR-232): the Makefile's way to make legacy.tfvars before preflight reads it, while releases act on the
# old project (LEGACY_STACK=1, on its own until the cutover; lib/legacy-stack.sh). Does nothing otherwise.
set -euo pipefail

SERVER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVIRONMENT="${ENVIRONMENT:-production}"
info() { printf '[legacy-stack] %s\n' "$*"; }
die()  { printf '[legacy-stack] %s\n' "$*" >&2; exit 1; }
# shellcheck source=lib/legacy-stack.sh
source "${SERVER_DIR}/scripts/lib/legacy-stack.sh"

[[ "${LEGACY_STACK:-0}" == "1" ]] || exit 0
ensure_legacy_tfvars "${SERVER_DIR}/infrastructure/terraform" "${ENVIRONMENT}" "${SERVER_DIR}/../config/gcp.json"
