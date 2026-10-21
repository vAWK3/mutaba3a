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

# db_start_proxy <connection name> <port>: start cloud-sql-proxy in the background and wait up to 30 s for
# it to listen. Sets DB_PROXY_PID; the caller kills it.
db_start_proxy() {
  local connection="$1" port="$2" _
  cloud-sql-proxy "${connection}" --port "${port}" --quiet &
  # shellcheck disable=SC2034 # read by the caller
  DB_PROXY_PID=$!
  for _ in $(seq 1 30); do (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null && break; sleep 1; done
  (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null || die "cloud-sql-proxy did not open 127.0.0.1:${port} within 30 s (is the port free? is gcloud authenticated?)"
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

# tf_output <terraform dir> <name>: one output from the state tf_init loaded; fails when there is none.
tf_output() { (cd "$1" && terraform output -raw "$2" 2>/dev/null); }

# tf_active_instance <terraform dir> <environment>: the Cloud SQL instance the API serves from (MUT-381:
# mutaba3a-pg, or mutaba3a-pg2 once cmek_stage is active). A state last applied before MUT-381 has no such
# output; pg2 can't be active then, so that means mutaba3a-pg.
tf_active_instance() {
  local name
  tf_init "$1" "$2"
  if name="$(tf_output "$1" cloud_sql_instance_name)" && [[ -n "${name}" ]]; then
    printf '%s\n' "${name}"
  else
    warn "terraform state has no cloud_sql_instance_name output yet (no apply since MUT-381); using mutaba3a-pg"
    printf 'mutaba3a-pg\n'
  fi
}
