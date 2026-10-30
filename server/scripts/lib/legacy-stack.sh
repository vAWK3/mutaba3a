# shellcheck shell=bash
# MUT-487 (ADR-232): until the cutover, every server release acts on MTB3A's old project (LEGACY_STACK=1) on its
# own, so nobody has to remember the flag between merging the move and running it. config/gcp.json's
# `<environment>.cutover` is "pending" until DEPLOYMENT.md §6d C3 sets it to "done"; then releases go to the new
# project and LEGACY_STACK=1 is only for the forwarder, a rollback and the teardown (MUT-520, MUT-521).
# Sourced by scripts/deploy.sh, scripts/legacy-tfvars.sh (the Makefile's) and ../../scripts/preflight.sh.
# Tested by src/scripts/__tests__/legacy-stack.test.ts. The caller defines die and info. Needs node.

# gcp_config_value <gcp.json> <environment> <key>: one string from config/gcp.json, empty when absent.
gcp_config_value() {
  [[ -f "$1" ]] || return 0
  node -e '
    const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))[process.argv[2]] || {};
    process.stdout.write(String(c[process.argv[3]] || ""));' "$1" "$2" "$3" 2>/dev/null || true
}

# cutover_pending <gcp.json> <environment>: true while the move hasn't happened yet.
cutover_pending() {
  [[ "$(gcp_config_value "$1" "$2" cutover)" == "pending" ]]
}

# default_legacy_stack <gcp.json> <environment>: prints 1 while the cutover is pending, else 0.
default_legacy_stack() {
  if cutover_pending "$1" "$2"; then echo 1; else echo 0; fi
}

# ensure_legacy_tfvars <terraform dir> <environment> <gcp.json>: makes legacy.tfvars (git-ignored) from
# <environment>.tfvars with legacy_stack = true, the first time and only while <environment>.tfvars still names the
# old project, which is what C1's first step does by hand. After C1 points <environment>.tfvars at the new project a
# missing legacy.tfvars can't be guessed, so it stops. An existing legacy.tfvars is never touched.
ensure_legacy_tfvars() {
  local tf_dir="$1" env="$2" config="$3"
  local target="${tf_dir}/legacy.tfvars" source="${tf_dir}/${env}.tfvars" project legacy
  [[ -f "${target}" ]] && return 0
  [[ -f "${source}" ]] || die "${target} is missing and so is ${source}; make legacy.tfvars by hand (DEPLOYMENT.md §6d C1)"
  project="$(sed -n 's/^project_id[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "${source}" | head -1)"
  legacy="$(gcp_config_value "${config}" "${env}" legacyProject)"
  [[ -n "${legacy}" && "${project}" == "${legacy}" ]] \
    || die "${target} is missing and ${source} names ${project:-no project}, not the old project ${legacy:-(none in ${config})}; make legacy.tfvars by hand (DEPLOYMENT.md §6d C1)"
  (
    umask 077
    {
      printf '# MUT-487 (ADR-232): made from %s.tfvars by scripts/lib/legacy-stack.sh on %s: until the cutover,\n' "${env}" "$(date -u +%Y-%m-%d)"
      printf '# releases act on the old project. Edit it like legacy.tfvars.example says from C1 on.\n'
      grep -v '^[[:space:]]*legacy_stack[[:space:]]*=' "${source}"
      printf '\nlegacy_stack = true\n'
    } >"${target}"
  )
  info "made ${target} from ${source} (legacy_stack = true): releases act on ${legacy} until the cutover"
}
