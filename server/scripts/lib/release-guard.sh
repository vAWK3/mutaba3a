# shellcheck shell=bash
# deploy.sh (MUT-381, ADR-164): refuse a release that would move the database or reopen a closed service.
# (MUT-360: guard_stripe_release, below, refuses one that would switch Stripe off.)
# Sourced by scripts/deploy.sh, which calls it before the bootstrap apply, before the migration and before the
# full apply (each a few minutes apart). Tested by src/scripts/__tests__/release-guard.test.ts through a fake
# `terraform` and `gcloud`.
#
# A release ends in a full `terraform apply`, so whatever this checkout's variables say happens:
#   * cmek_stage "active" while mutaba3a-pg serves would switch to a mutaba3a-pg2 nobody has copied or
#     migrated into (the switch belongs to DEPLOYMENT.md §6d, which runs it with ingress closed);
#   * "off"/"prepared" while mutaba3a-pg2 serves (a stale, git-ignored tfvars in another checkout) would move
#     the API back to the frozen mutaba3a-pg and lose everything written since; "off" once the key exists
#     would plan the key's destroy after the migration ran;
#   * a release while a cutover or a restore holds ingress closed would reopen it mid-copy.
# The caller defines die and warn and runs this inside the terraform dir, after `terraform init`. It fails
# closed: anything it cannot read stops the release.
#
# Off by default while the CMEK epic is unfinished (Basel, 2026-10-21): cmek_stage stays "off", so a release
# changes nothing and runs exactly as it did before MUT-381. SKIP_CMEK_GUARD=0 turns it on; it must be on
# before any CMEK cutover (DEPLOYMENT.md §6d), and MUT-385 makes on the default.

# guard_var_args <terraform args…>: keeps only -var and -var-file in GUARD_VAR_ARGS, so `terraform console`
# sees the same variables (tfvars, *.auto.tfvars, TF_VAR_*) the apply will.
GUARD_VAR_ARGS=()
guard_var_args() {
  GUARD_VAR_ARGS=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -var|-var-file) GUARD_VAR_ARGS+=("$1" "${2:-}"); shift 2 ;;
      -var=*|-var-file=*) GUARD_VAR_ARGS+=("$1"); shift ;;
      *) shift ;;
    esac
  done
}

# guard_cmek_release <suffix> <service> <region> <project> <terraform args…>
#   <terraform args…>: the apply's own arguments; only -var and -var-file are kept, so `terraform console`
#   sees the same variables (tfvars, *.auto.tfvars, TF_VAR_*) the apply will.
guard_cmek_release() {
  if [[ "${SKIP_CMEK_GUARD:-1}" != "0" ]]; then
    warn "CMEK release guard off (the default until MUT-385; SKIP_CMEK_GUARD=0 turns it on)"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local values stage ingress
  values="$(printf 'var.cmek_stage\nvar.api_ingress\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate cmek_stage and api_ingress with terraform console (above); refusing to release on a guess"
  stage="$(sed -n '1s/"//gp' <<<"${values}")"
  ingress="$(sed -n '2s/"//gp' <<<"${values}")"
  [[ -n "${stage}" && -n "${ingress}" ]] || die "terraform console gave no cmek_stage/api_ingress; refusing to release on a guess"

  local err serving rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  serving="$(terraform output -raw cloud_sql_instance_name 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    # A state applied before MUT-381 has no such output, and then mutaba3a-pg2 can't be serving.
    if grep -q 'Output "cloud_sql_instance_name" not found' "${err}"; then
      serving="mutaba3a-pg${suffix}"
    else
      cat "${err}" >&2; rm -f "${err}"
      die "could not read cloud_sql_instance_name from terraform state (above); refusing to release on a guess"
    fi
  fi
  rm -f "${err}"
  [[ -n "${serving}" ]] || die "terraform output cloud_sql_instance_name is empty: is TF_STATE_BUCKET (and the prefix) right?"

  if [[ "${stage}" == "off" ]] && terraform state list 2>/dev/null | grep -q '^google_kms_crypto_key\.data'; then
    die "cmek_stage = \"off\" but the KMS key exists: this release would plan its destroy (refused by prevent_destroy, after the migration). Set cmek_stage to match what serves."
  fi

  local want="mutaba3a-pg${suffix}"
  [[ "${stage}" == "active" ]] && want="mutaba3a-pg2${suffix}"
  [[ "${want}" == "${serving}" ]] || die "this checkout's cmek_stage = \"${stage}\", which serves ${want}, but production serves ${serving}. A release never moves the database: the CMEK switch is DEPLOYMENT.md §6d's printed apply. Set cmek_stage to match what serves (a stale tfvars from another checkout?), then release."

  local live
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  rc=0
  live="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(metadata.annotations."run.googleapis.com/ingress-status")' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: no service yet, nothing to reopen or to have moved
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s ingress (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  if [[ "${live}" == "internal" && "${ingress}" != "INGRESS_TRAFFIC_INTERNAL_ONLY" ]]; then
    die "${service} is closed to outside traffic: a CMEK cutover (DEPLOYMENT.md §6d) or a whole-database restore (pilot runbook §4.3) is in progress, and this release would reopen it mid-way. Finish or roll that back first."
  fi

  # Terraform state says what should serve; the revisions taking traffic say what does.
  local revs rev mounts conn
  revs="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(status.traffic[].revisionName)')" || die "could not list ${service}'s revisions; refusing to release on a guess"
  for rev in $(tr ';' ' ' <<<"${revs}"); do
    mounts="$(gcloud run revisions describe "${rev}" --region="${region}" --project="${project}" \
      --format='value(metadata.annotations."run.googleapis.com/cloudsql-instances")')" \
      || die "could not read what ${rev} mounts; refusing to release on a guess"
    for conn in $(tr ',' ' ' <<<"${mounts}"); do
      [[ "${conn}" == *":${want}" ]] || die "${rev} mounts ${conn}, but this release would serve ${want}: terraform state and Cloud Run disagree. Find out why before releasing."
    done
  done
}

# MUT-360 (ADR-165): refuse a release whose checkout says stripe_enabled = false (or doesn't set it) while
# production already runs Stripe. stripe_enabled lives in the git-ignored production.tfvars, so a checkout that
# never got the line would release with the default, false: its full apply deletes the nightly reconcile job and
# unmounts the Stripe secrets, and the webhook answers 503 until someone notices. Turning Stripe off is
# DEPLOYMENT.md §6e's own apply, never a side effect of a release.
#
# "Production runs Stripe" is read from Google, not from terraform state: the reconcile job exists, or the
# service's template mounts STRIPE_SECRET_KEY. Either one is enough. On by default; SKIP_STRIPE_GUARD=1 skips it.
# It fails closed like the CMEK guard: anything it cannot read stops the release. It also warns (never refuses)
# when the job is paused, which a CMEK cutover or a whole-database restore leaves to the operator to undo.

# guard_stripe_release <suffix> <service> <region> <project> <terraform args…>
guard_stripe_release() {
  if [[ "${SKIP_STRIPE_GUARD:-0}" == "1" ]]; then
    warn "Stripe release guard skipped (SKIP_STRIPE_GUARD=1)"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local enabled
  enabled="$(printf 'var.stripe_enabled\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate stripe_enabled with terraform console (above); refusing to release on a guess"
  # The first line only, as guard_cmek_release reads its values: a console notice after it must not refuse a release.
  enabled="$(sed -n '1{s/"//g;p;}' <<<"${enabled}")"
  [[ "${enabled}" == "true" || "${enabled}" == "false" ]] \
    || die "terraform console gave '${enabled}' for stripe_enabled; refusing to release on a guess"

  local job="mutaba3a-stripe-reconcile${suffix}" err rc=0 state
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  state="$(gcloud scheduler jobs describe "${job}" --location="${region}" --project="${project}" \
    --format='value(state)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    state=""
    # Stripe on in this checkout: the job only feeds the paused warning, so an unreadable one never stops it.
    if [[ "${enabled}" == "false" ]] && ! grep -qiE 'NOT_FOUND|not found' "${err}"; then
      cat "${err}" >&2; rm -f "${err}"
      die "could not read the Scheduler job ${job} (above); refusing to release on a guess"
    fi
  fi
  rm -f "${err}"
  if [[ "${state}" == "PAUSED" ]]; then
    warn "${job} is paused: the nightly Stripe reconcile doesn't run. If no CMEK cutover or restore holds the database closed, resume it: gcloud scheduler jobs resume ${job} --location=${region} --project=${project}"
  fi
  [[ "${enabled}" == "true" ]] && return 0

  local env_names="" live=""
  if [[ -n "${state}" ]]; then
    live="the Scheduler job ${job} exists"
  else
    err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
    rc=0
    env_names="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
      --format='value(spec.template.spec.containers[0].env[].name)' 2>"${err}")" || rc=$?
    if (( rc != 0 )); then
      if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
        rm -f "${err}"; return 0 # first deploy: nothing runs Stripe yet
      fi
      cat "${err}" >&2; rm -f "${err}"
      die "could not read ${service}'s env (above); refusing to release on a guess"
    fi
    rm -f "${err}"
    if [[ ";${env_names};" == *";STRIPE_SECRET_KEY;"* ]]; then
      live="${service} mounts STRIPE_SECRET_KEY"
    fi
  fi
  [[ -z "${live}" ]] && return 0
  die "this checkout's stripe_enabled is false (or unset), but production runs Stripe: ${live}. This release would delete the nightly reconcile job and unmount the Stripe secrets. Set stripe_enabled = true in this checkout's production.tfvars (git doesn't carry it), then release. To turn Stripe off, use DEPLOYMENT.md §6e's own apply; SKIP_STRIPE_GUARD=1 only if you mean this release to do it."
}

# MUT-148 (ADR-091): refuse a release whose checkout says sentry_enabled = false (or doesn't set it) while the
# service already mounts SENTRY_DSN. Like stripe_enabled it lives in the git-ignored production.tfvars, so a
# checkout without the line would release with the default, false: its full apply deletes the DSN secret and
# the API stops reporting errors without anyone noticing. Turning reports off is a deliberate apply, never a
# side effect of a release.
#
# Sets SENTRY_ENABLED (true|false) for deploy.sh, which tells the smoke what /health must say and hands
# pre-roll and post-roll the DSN. SKIP_SENTRY_GUARD=1 skips the check, never the read. Fails closed.

# guard_sentry_release <suffix> <service> <region> <project> <terraform args…>
# shellcheck disable=SC2034 # read by deploy.sh, which sources this file
SENTRY_ENABLED=""
# shellcheck disable=SC2034 # the same: SENTRY_ENABLED is set here for deploy.sh
guard_sentry_release() {
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local enabled
  enabled="$(printf 'var.sentry_enabled\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate sentry_enabled with terraform console (above); refusing to release on a guess"
  enabled="$(sed -n '1{s/"//g;p;}' <<<"${enabled}")"
  [[ "${enabled}" == "true" || "${enabled}" == "false" ]] \
    || die "terraform console gave '${enabled}' for sentry_enabled; refusing to release on a guess"
  SENTRY_ENABLED="${enabled}"

  if [[ "${SKIP_SENTRY_GUARD:-0}" == "1" ]]; then
    warn "Sentry release guard skipped (SKIP_SENTRY_GUARD=1)"
    return 0
  fi
  [[ "${enabled}" == "true" ]] && return 0

  local env_names err rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  env_names="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(spec.template.spec.containers[0].env[].name)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: nothing reports yet
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s env (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  [[ ";${env_names};" == *";SENTRY_DSN;"* ]] || return 0
  die "this checkout's sentry_enabled is false (or unset), but ${service} mounts SENTRY_DSN. This release would delete the DSN secret and stop error reports. Set sentry_enabled = true in this checkout's production.tfvars (git doesn't carry it), then release. SKIP_SENTRY_GUARD=1 only if you mean this release to turn reports off."
}

# MUT-359 (D22): refuse a release whose checkout doesn't say mailer = "resend" while the service already mounts
# RESEND_API_KEY. Like stripe_enabled and sentry_enabled, `mailer` lives in the git-ignored production.tfvars, so a
# checkout without the line releases with the default, noop: password notices (and, from MUT-366, every signup and
# recovery link) silently stop. Turning mail off is a deliberate apply, never a side effect of a release.
# SKIP_MAILER_GUARD=1 skips the check. Fails closed.

# guard_mailer_release <suffix> <service> <region> <project> <terraform args…>
guard_mailer_release() {
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local mailer
  mailer="$(printf 'var.mailer\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate mailer with terraform console (above); refusing to release on a guess"
  mailer="$(sed -n '1{s/"//g;p;}' <<<"${mailer}")"
  [[ "${mailer}" == "resend" || "${mailer}" == "noop" ]] \
    || die "terraform console gave '${mailer}' for mailer; refusing to release on a guess"

  if [[ "${SKIP_MAILER_GUARD:-0}" == "1" ]]; then
    warn "mail release guard skipped (SKIP_MAILER_GUARD=1)"
    return 0
  fi
  [[ "${mailer}" == "resend" ]] && return 0

  local env_names err rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  env_names="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" \
    --format='value(spec.template.spec.containers[0].env[].name)' 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: nothing sends yet
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s env (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  [[ ";${env_names};" == *";RESEND_API_KEY;"* ]] || return 0
  die "this checkout's mailer is ${mailer} (or unset), but ${service} mounts RESEND_API_KEY. This release would stop all mail. Set mailer = \"resend\" (with mail_reply_to and mail_daily_cap) in this checkout's production.tfvars (git doesn't carry it), then release. SKIP_MAILER_GUARD=1 only if you mean this release to turn mail off."
}

# guard_turnstile_site_key <terraform args…> (MUT-368, D6): once this checkout's mailer is "resend" the server mails
# signup and recovery links and checks Turnstile with a real secret, so the portal it ships must carry a real site key.
# Cloudflare's test keys (1x…, 2x…, 3x…) would fail every check there, and a missing one builds the test key in.
guard_turnstile_site_key() {
  guard_var_args "$@"
  local mailer
  mailer="$(printf 'var.mailer\n' | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate mailer with terraform console (above); refusing to release on a guess"
  mailer="$(sed -n '1{s/"//g;p;}' <<<"${mailer}")"
  [[ "${mailer}" == "resend" || "${mailer}" == "noop" ]] \
    || die "terraform console gave '${mailer}' for mailer; refusing to release on a guess"
  [[ "${mailer}" == "resend" ]] || return 0
  local key="${MUTABA3A_TURNSTILE_SITE_KEY:-}"
  [[ -n "${key}" && ! "${key}" =~ ^[123]x ]] && return 0
  die "mailer = \"resend\" mails signup and recovery links, but MUTABA3A_TURNSTILE_SITE_KEY is ${key:-unset}${key:+ (a Cloudflare test key)}. Put the production widget's site key in deploy.env (DEPLOYMENT.md §6f), then release."
}

# MUT-471: refuse a release whose checkout would change the phone minimum builds production serves (MUT-293 /
# MUT-457) without saying so. The floors, the recommended builds and min_build_check_disabled live in the git-ignored
# production.tfvars, so a copy that never got the lines drops the floors, and a copy that is behind can re-raise a bad
# floor after an incident lowered it, or switch the kill switch off while a bad floor still serves: the phones it hit
# are locked out again. Any difference between what this checkout's local.min_build_env would send and what the
# service's template has is refused unless ALLOW_MIN_BUILD_CHANGE names it (comma- or space-separated env names);
# a raise is named too, since a stale raise is exactly the lockout. A removed floor removes its recommended build
# (the precondition in main.tf), so both are named. SKIP_MIN_BUILD_GUARD=1 skips the guard, only for when it can't
# read terraform or Cloud Run itself. Fails closed. In a rollback, rollback_infra_gate has already refused any env
# change, so ALLOW_MIN_BUILD_CHANGE never helps one through.
MIN_BUILD_ENV_NAMES="IOS_MIN_BUILD ANDROID_MIN_BUILD IOS_RECOMMENDED_BUILD ANDROID_RECOMMENDED_BUILD MIN_BUILD_CHECK_DISABLED"

# guard_min_build_release <suffix> <service> <region> <project> <terraform args…>
guard_min_build_release() {
  if [[ "${SKIP_MIN_BUILD_GUARD:-0}" == "1" ]]; then
    warn "min-build release guard skipped (SKIP_MIN_BUILD_GUARD=1): use it only when the guard itself can't read terraform or Cloud Run; this release ships whatever minimum builds this checkout's production.tfvars says"
    return 0
  fi
  local suffix="$1" service="$2" region="$3" project="$4"; shift 4
  guard_var_args "$@"

  local name allowed=" "
  for name in $(tr ',' ' ' <<<"${ALLOW_MIN_BUILD_CHANGE:-}"); do
    [[ " ${MIN_BUILD_ENV_NAMES} " == *" ${name} "* ]] \
      || die "ALLOW_MIN_BUILD_CHANGE names '${name}', which isn't one of ${MIN_BUILD_ENV_NAMES}"
    allowed+="${name} "
  done

  # One expression: Terraform 1.15's console answers only the last of several lines (MUT-475).
  local keys="" plan
  for name in ${MIN_BUILD_ENV_NAMES}; do keys+="${keys:+, }\"${name}\""; done
  plan="$(printf 'join(" ", [for k in [%s] : lookup(local.min_build_env, k, "unset")])\n' "${keys}" \
    | terraform console ${GUARD_VAR_ARGS[@]+"${GUARD_VAR_ARGS[@]}"})" \
    || die "could not evaluate local.min_build_env with terraform console (above); refusing to release on a guess"
  plan="$(sed -n '1{s/"//g;p;}' <<<"${plan}")"
  [[ "${plan}" =~ ^(([1-9][0-9]*|unset)\ ){4}(true|unset)$ ]] \
    || die "terraform console gave '${plan}' for the minimum builds (${MIN_BUILD_ENV_NAMES}); refusing to release on a guess"

  local json err rc=0
  err="$(mktemp "${TMPDIR:-/tmp}/release-guard-XXXX")"
  json="$(gcloud run services describe "${service}" --region="${region}" --project="${project}" --format=json 2>"${err}")" || rc=$?
  if (( rc != 0 )); then
    if grep -qiE 'cannot find service|could not be found|NOT_FOUND' "${err}"; then
      rm -f "${err}"; return 0 # first deploy: no service, nothing to change
    fi
    cat "${err}" >&2; rm -f "${err}"
    die "could not read ${service}'s env (above); refusing to release on a guess"
  fi
  rm -f "${err}"
  # One word per name: its value, "unset" when the service doesn't have it, "?" when it isn't a plain word.
  local live
  live="$(printf '%s' "${json}" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      const env = JSON.parse(s).spec?.template?.spec?.containers?.[0]?.env ?? [];
      process.stdout.write(process.argv[1].split(" ").map((n) => {
        const e = env.find((x) => x.name === n);
        return !e ? "unset" : typeof e.value === "string" && /^[A-Za-z0-9._-]+$/.test(e.value) ? e.value : "?";
      }).join(" "));
    });' "${MIN_BUILD_ENV_NAMES}")" || die "could not parse ${service}'s env; refusing to release on a guess"

  local i=0 want have changes="" names="" unnamed=""
  local -a plan_v live_v
  read -r -a plan_v <<<"${plan}"
  read -r -a live_v <<<"${live}"
  for name in ${MIN_BUILD_ENV_NAMES}; do
    want="${plan_v[i]}"; have="${live_v[i]:-?}"; i=$((i + 1))
    [[ "${have}" == "?" || ( "${name}" != "MIN_BUILD_CHECK_DISABLED" && ! "${have}" =~ ^([1-9][0-9]*|unset)$ ) ]] \
      && die "could not read ${service}'s ${name} (not a whole number or plain value); refusing to release on a guess"
    [[ "${want}" == "${have}" ]] && continue
    changes+=$'\n'"  ${name}: production has ${have}, this checkout would set ${want} ($(tr '[:upper:]' '[:lower:]' <<<"${name}"))"
    names+="${names:+,}${name}"
    [[ "${allowed}" == *" ${name} "* ]] || unnamed+=" ${name}"
  done
  for name in ${allowed}; do
    [[ ",${names}," == *",${name},"* ]] || warn "ALLOW_MIN_BUILD_CHANGE names ${name}, which this release doesn't change"
  done
  [[ -z "${changes}" ]] && return 0
  if [[ -z "${unnamed}" ]]; then
    warn "this release changes the phone minimum builds, as ALLOW_MIN_BUILD_CHANGE allows:${changes}"
    return 0
  fi
  die "this release would change the phone minimum builds production serves:${changes}
production.tfvars is git-ignored, so a checkout that is behind (or never got these lines) would ship this silently and can lock phones out. If this checkout is stale, fix its production.tfvars, then release. If you mean every change above, release with ALLOW_MIN_BUILD_CHANGE=${names} (DEPLOYMENT.md \"Raise the minimum app build\"). SKIP_MIN_BUILD_GUARD=1 only if the guard itself can't read terraform or Cloud Run."
}
