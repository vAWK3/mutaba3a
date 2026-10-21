# shellcheck shell=bash
# Read-only database helpers shared by scripts/restore-drill.sh (MUT-327) and scripts/cmek-cutover.sh
# (MUT-381). Sourced, never run. Bash 3.2 compatible (macOS /bin/bash).
#
# The caller defines die and warn, and sets PG* (PGHOST, PGPORT, PGUSER, PGDATABASE, PGPASSWORD) before
# db_sql or db_table_counts.

# db_sql <psql args…>: unaligned, tuples only, stop on the first error.
db_sql() { psql -X -A -t -q -v ON_ERROR_STOP=1 "$@"; }

# db_table_counts <file>: "table|rows" for every table in public, exact counts, sorted by table name.
db_table_counts() {
  local out="$1" tables query t
  tables="$(db_sql -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1")"
  query=""
  for t in ${tables}; do query+="${query:+ UNION ALL }SELECT '${t}', count(*) FROM \"${t}\""; done
  [[ -n "${query}" ]] || die "no tables in the public schema"
  db_sql -F '|' -c "${query} ORDER BY 1" >"${out}"
}

# db_write_counters: "inserted,updated,deleted" rows since the stats were last reset, for the whole database.
# Reads (row counts included) never move them; any INSERT, UPDATE or DELETE does. Backends flush them on idle
# (up to ~10 s after a write on Postgres 15+), so callers wait before a read that must see every write. Dies
# unless track_counts is on (the counters would never move) and the row is well formed.
db_write_counters() {
  local row
  row="$(db_sql -c "SELECT current_setting('track_counts') || ',' || tup_inserted || ',' || tup_updated || ',' || tup_deleted FROM pg_stat_database WHERE datname = current_database()")" \
    || die "could not read the write counters (pg_stat_database)"
  [[ "${row}" == on,* ]] || die "track_counts is not on (${row%%,*}): the write counters never move, so they can't prove a freeze"
  row="${row#on,}"
  [[ "${row}" =~ ^[0-9]+,[0-9]+,[0-9]+$ ]] || die "unexpected write counters: ${row}"
  printf '%s\n' "${row}"
}

# db_start_proxy <connection name> <port>: start cloud-sql-proxy in the background and wait up to 30 s for
# it to listen. Sets DB_PROXY_PID; the caller kills it.
db_start_proxy() {
  local connection="$1" port="$2" _
  # A listener already on the port (an old `npm run db:proxy`?) would answer instead of this proxy and send
  # every query to whichever instance it points at.
  if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    die "something already listens on 127.0.0.1:${port} (an old cloud-sql-proxy?); stop it or pick another port"
  fi
  cloud-sql-proxy "${connection}" --port "${port}" --quiet &
  # shellcheck disable=SC2034 # read by the caller
  DB_PROXY_PID=$!
  for _ in $(seq 1 30); do (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && break; sleep 1; done
  if ! (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
    # The caller hasn't recorded the PID yet: stop the proxy here so the exit trap has nothing to miss.
    kill "${DB_PROXY_PID}" 2>/dev/null || true
    die "cloud-sql-proxy did not open 127.0.0.1:${port} within 30 s (is the port free? is gcloud authenticated?)"
  fi
  kill -0 "${DB_PROXY_PID}" 2>/dev/null || die "cloud-sql-proxy for ${connection} exited, yet 127.0.0.1:${port} answers: something else is listening there"
}

# tf_init <terraform dir> <environment>: point the terraform dir at the remote state (TF_STATE_BUCKET), the
# same init scripts/db.sh does. Dies when it can't (auth, bucket, network).
tf_init() {
  : "${TF_STATE_BUCKET:?set TF_STATE_BUCKET (the GCS bucket holding terraform state)}"
  (cd "$1" && terraform init -reconfigure -input=false \
    -backend-config="bucket=${TF_STATE_BUCKET}" \
    -backend-config="prefix=mutaba3a-api/$2" >/dev/null) \
    || die "terraform init failed in $1 (is TF_STATE_BUCKET right? is gcloud authenticated?)"
}

# tf_output <terraform dir> <name>: print one output from the state tf_init loaded. Returns 3 when the state
# has no such output; any other failure (state unreadable, network, auth) dies. Callers that can fall back
# must only do it on 3: guessing on an unreadable state is how a copy lands on the live database.
tf_output() {
  local err rc=0 out
  err="$(mktemp "${TMPDIR:-/tmp}/tf-output-XXXX")"
  out="$(cd "$1" && terraform output -raw "$2" 2>"${err}")" || rc=$?
  if (( rc == 0 )); then
    rm -f "${err}"
    # An empty state (a wrong bucket or prefix) answers every output with nothing and exit 0.
    [[ -n "${out}" ]] || die "terraform output $2 is empty: is TF_STATE_BUCKET (and the prefix) right?"
    printf '%s' "${out}"; return 0
  fi
  if grep -q "Output \"$2\" not found" "${err}"; then rm -f "${err}"; return 3; fi
  warn "$(cat "${err}")"
  rm -f "${err}"
  die "could not read $2 from terraform state (above); stopping rather than guess"
}

# tf_active_instance <terraform dir> <environment>: the Cloud SQL instance the API serves from (MUT-381:
# mutaba3a-pg, or mutaba3a-pg2 once cmek_stage is active). A state last applied before MUT-381 has no such
# output; pg2 can't be active then, so that alone means mutaba3a-pg.
tf_active_instance() {
  local name rc=0
  tf_init "$1" "$2"
  name="$(tf_output "$1" cloud_sql_instance_name)" || rc=$?
  case "${rc}" in
    0) printf '%s\n' "${name}" ;;
    3) warn "terraform state has no cloud_sql_instance_name output yet (no apply since MUT-381); using mutaba3a-pg"
       printf 'mutaba3a-pg\n' ;;
    *) exit 1 ;;
  esac
}
