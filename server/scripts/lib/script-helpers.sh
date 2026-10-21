# shellcheck shell=bash
# Command helpers shared by scripts/restore-drill.sh (MUT-327) and scripts/cmek-cutover.sh (MUT-381).
# Sourced, never run. Bash 3.2 compatible. The caller defines die and sets DRY_RUN (and YES, to skip prompts).

# run <command...>: print it, then run it unless this is a dry run.
run() {
  printf '+ %s\n' "$*"
  [[ "${DRY_RUN}" == 1 ]] && return 0
  "$@"
}

# run_capture <var> <placeholder> <command...>: run a read-only command and keep its stdout.
run_capture() {
  local var="$1" placeholder="$2"; shift 2
  printf '+ %s\n' "$*"
  if [[ "${DRY_RUN}" == 1 ]]; then printf -v "${var}" '%s' "${placeholder}"; return 0; fi
  local value
  value="$("$@")"
  printf -v "${var}" '%s' "${value}"
}

# confirm <question>: a y/N prompt on the terminal; yes on a dry run or with YES=1 (--yes).
confirm() {
  if [[ "${DRY_RUN}" == 1 ]]; then printf '[dry-run] would ask: %s [y/N]\n' "$1"; return 0; fi
  [[ "${YES:-0}" == 1 ]] && return 0
  [[ -r /dev/tty ]] || die "this step needs a terminal to confirm: $1"
  local answer
  read -r -p "$1 [y/N] " answer </dev/tty
  [[ "${answer}" == "y" || "${answer}" == "Y" ]]
}

need() { [[ "${DRY_RUN}" == 1 ]] || command -v "$1" >/dev/null 2>&1 || die "missing tool: $1 ($2)"; }

# timed <label> <command...>: run it and record how long it took, as two parallel arrays (no associative
# arrays in bash 3.2) the caller prints as a results table.
STEP_NAMES=()
STEP_SECONDS=()
timed() {
  local label="$1"; shift
  local started=${SECONDS}
  "$@"
  STEP_NAMES+=("${label}")
  if [[ "${DRY_RUN}" == 1 ]]; then STEP_SECONDS+=("—"); else STEP_SECONDS+=("$((SECONDS - started))"); fi
}
