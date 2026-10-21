import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * MUT-381 (ADR-164): the CMEK cutover copies production into mutaba3a-pg2 while the API is closed, so only
 * the operator runs it. What we prove here with fake gcloud, terraform, psql and proxy on PATH: the only
 * instance it changes is mutaba3a-pg2; it closes ingress before the backup and reopens it on every failure
 * (C4); it refuses a target smaller than the source (C2), a target without a key, and a second run once
 * pg2 serves; it prints a switch apply that keeps ingress internal (D2); and verify checks the serving
 * revision really mounts mutaba3a-pg2. The fake psql answers the table counts; the test listens on the two
 * proxy ports itself, so the fake proxy only has to stay alive.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/cmek-cutover.sh');
const bin = mkdtempSync(join(tmpdir(), 'cmek-cutover-'));
const calls = join(bin, 'calls.log');
const KEY = 'projects/demo-project/locations/me-west1/keyRings/mutaba3a/cryptoKeys/mutaba3a-data';

const NODE = process.execPath;
const fakes: Record<string, string> = {
  gcloud: `#!/bin/bash
echo "gcloud $*" >> "${calls}"
args="$*"
case "$args" in
  "config get-value account"*) echo "ops@example.com" ;;
  "sql instances describe mutaba3a-pg2 "*"connectionName"*)
    if [[ -n "$FAKE_LOSE_KEY" ]] && grep -q 'backups restore' "${calls}"; then printf '%s,10,demo-project:me-west1:mutaba3a-pg2,\\n' "${KEY}";
    elif [[ -n "$FAKE_NO_KEY" ]]; then printf ',%s,demo-project:me-west1:mutaba3a-pg2,\\n' "\${FAKE_TARGET_GB:-10}";
    else printf '%s,%s,demo-project:me-west1:mutaba3a-pg2,%s/cryptoKeyVersions/1\\n' "${KEY}" "\${FAKE_TARGET_GB:-10}" "${KEY}"; fi ;;
  "sql instances describe mutaba3a-pg "*) printf '%s\\tdemo-project:me-west1:mutaba3a-pg\\n' "\${FAKE_SOURCE_GB:-10}" ;;
  "sql backups create"*) ;;
  "sql backups list"*) echo "1700000000000" ;;
  "sql backups restore"*) exit "\${FAKE_RESTORE_EXIT:-0}" ;;
  "run services update"*"--ingress=all"*) exit "\${FAKE_REOPEN_EXIT:-0}" ;;
  "run services update"*) ;;
  "run services describe"*"value(metadata.annotations"*)
    live=all
    grep -q -- '--ingress=internal' "${calls}" && live=internal
    [[ -n "$FAKE_INGRESS_STUCK" ]] && live=all
    [[ -n "$FAKE_REOPENED_MIDCOPY" ]] && grep -q 'backups restore' "${calls}" && live=all
    echo "$live" ;;
  "secrets versions access"*)
    [[ -n "$FAKE_SECRET_DENIED" ]] && { echo "PERMISSION_DENIED: secretmanager.versions.access" >&2; exit 1; }
    if [[ -n "$FAKE_SECRET_RAW" ]]; then printf '%s' "$FAKE_SECRET_RAW";
    else printf 'postgresql://u:p@localhost/mutaba3a?host=/cloudsql/%s&connection_limit=10' "\${FAKE_SECRET_CONN:-demo-project:me-west1:mutaba3a-pg2}"; fi ;;
  "run services describe"*"image"*) echo "\${FAKE_IMAGE:-me-west1-docker.pkg.dev/demo-project/mutaba3a/mutaba3a-api:abc1234}" ;;
  "run services describe"*"status.traffic[].revisionName"*) echo "\${FAKE_TRAFFIC_REVS:-mutaba3a-api-00042-xyz}" ;;
  "run services describe"*) printf '%s\\t%s\\t%s\\t%s\\t%s\\n' mutaba3a-api-00042-xyz "\${FAKE_PERCENT:-100}" mutaba3a-api-00042-xyz "\${FAKE_INGRESS:-internal}" https://mutaba3a-api.example.run.app ;;
  "run revisions describe rev-b "*) echo "\${FAKE_SPLIT_REV_SQL:-demo-project:me-west1:mutaba3a-pg}" ;;
  "run revisions describe"*) echo "\${FAKE_REVISION_SQL:-demo-project:me-west1:\${FAKE_ACTIVE:-mutaba3a-pg}}" ;;
  *) echo "unexpected gcloud call: $args" >&2; exit 98 ;;
esac
`,
  terraform: `#!/bin/bash
echo "terraform $*" >> "${calls}"
case "$1 $3" in
  "init "*) exit 0 ;;
  "output cloud_sql_instance_name")
    [[ -n "$FAKE_TF_OUTPUT_ERR" ]] && { echo 'Error: Failed to load state: storage: 503' >&2; exit 1; }
    [[ -n "$FAKE_TF_NO_OUTPUT" ]] && { echo 'Error: Output "cloud_sql_instance_name" not found' >&2; exit 1; }
    [[ -n "$FAKE_TF_EMPTY" ]] && exit 0
    printf '%s' "\${FAKE_ACTIVE:-mutaba3a-pg}" ;;
  "output local_database_url") printf '%s' "postgresql://mutaba3a_api:s3cret@127.0.0.1:5440/mutaba3a" ;;
  *) exit 1 ;;
esac
`,
  // A real listener on the --port it is given, like the proxy: the script refuses a port that already listens.
  'cloud-sql-proxy': `#!/bin/bash
echo "cloud-sql-proxy $*" >> "${calls}"
exec "${NODE}" -e "require('net').createServer((s) => s.end()).listen(Number(process.argv[1]), '127.0.0.1')" "$3"
`,
  psql: `#!/bin/bash
args="$*"
if [[ "$args" == *pg_stat_database* ]]; then
  [[ -n "$FAKE_STATS_FAIL" ]] && exit 2
  w="\${FAKE_COUNTERS:-10,5,0}"
  [[ -n "$FAKE_WRITE_DURING" && -f "${bin}/writes.mark" ]] && w=10,6,0
  touch "${bin}/writes.mark"
  printf '%s,%s\\n' "\${FAKE_TRACK_COUNTS:-on}" "$w"; exit 0
fi
if [[ "$args" == *pg_tables* ]]; then printf 'audit_events\\nusers\\n'; exit 0; fi
if [[ "$args" == *"count(*)"* ]]; then
  users=1
  [[ -n "$FAKE_MISMATCH" && "$PGPORT" == "$PROXY_PORT_TARGET" ]] && users=2
  printf 'audit_events|5\\nusers|%s\\n' "$users"; exit 0
fi
exit 97
`,
  curl: `#!/bin/bash
echo "curl $*" >> "${calls}"
if [[ "$*" == *http_code* ]]; then printf '%s' "\${FAKE_HEALTH_CODE:-404}"; exit 0; fi
exit "\${FAKE_READY_EXIT:-0}"
`,
};
for (const [tool, body] of Object.entries(fakes)) {
  const path = join(bin, tool);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

// Two free ports for the proxies: the script refuses one that already listens, so the fake proxy opens them.
const ports: number[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    ports.push((server.address() as { port: number }).port);
    await new Promise((done) => server.close(done));
  }
});
afterAll(() => {
  spawnSync('pkill', ['-f', `listen\\(Number\\(process.argv\\[1\\]\\)`]);
  rmSync(bin, { recursive: true, force: true });
});

function cutover(env: Record<string, string>, ...args: string[]) {
  return run(env, args, !args.includes('--dry-run'));
}

function run(env: Record<string, string>, args: string[], yes: boolean) {
  rmSync(calls, { force: true });
  rmSync(join(bin, 'writes.mark'), { force: true });
  // setsid: a new session with no controlling terminal, so a prompt can never block on the developer's keyboard.
  const run = spawnSync('perl', ['-MPOSIX', '-e', 'POSIX::setsid(); exec @ARGV', 'bash', SCRIPT, ...args, ...(yes ? ['--yes'] : [])], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: bin,
      TF_STATE_BUCKET: 'demo-state',
      PROXY_PORT_SOURCE: String(ports[0]),
      PROXY_PORT_TARGET: String(ports[1]),
      DRAIN_SECONDS: '0',
      ...env,
    },
    input: '',
    timeout: 60_000,
  });
  const log = existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n') : [];
  return { status: run.status, out: run.stdout, err: run.stderr, calls: log };
}

const dry = (...args: string[]) => cutover({}, ...args, '--project', 'demo-project', '--dry-run');

const mutatingLines = (out: string) =>
  out.split('\n').filter((l) => /^\+ gcloud sql (instances (create|clone|patch|delete)|backups restore|users set-password)/.test(l));

// Each case spawns the script and a few dozen fake-CLI processes; under the full suite's load one can take
// several seconds (spawnSync itself is capped at 60 s above).
describe('cmek-cutover.sh', { timeout: 30_000 }, () => {
  it('prints usage and exits 2 without a subcommand or --project', () => {
    expect(cutover({}, '--dry-run').status).toBe(2);
    expect(cutover({}, 'cutover', '--dry-run').status).toBe(2);
  });

  it('rehearse copies a fresh backup of mutaba3a-pg into mutaba3a-pg2 and never touches ingress', () => {
    const r = dry('rehearse');
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toEqual([]);
    expect(r.out).toMatch(/\+ gcloud sql backups create --instance=mutaba3a-pg --project=demo-project /);
    expect(r.out).toMatch(/\+ gcloud sql backups restore <backup-id> --restore-instance=mutaba3a-pg2 --backup-instance=mutaba3a-pg /);
    expect(r.out).not.toContain('--ingress');
    expect(r.out).toContain('| Step | Seconds |');
  });

  it('cutover closes ingress before the backup and prints a switch apply that keeps it closed', () => {
    const r = dry('cutover');
    expect(r.status, r.err).toBe(0);
    const close = r.out.indexOf('--ingress=internal');
    const backup = r.out.indexOf('gcloud sql backups create');
    expect(close).toBeGreaterThan(-1);
    expect(close).toBeLessThan(backup);
    expect(r.out).toMatch(/terraform apply .*-var cmek_stage=active .*-var api_ingress=INGRESS_TRAFFIC_INTERNAL_ONLY/);
    expect(r.out).toContain('scripts/cmek-cutover.sh verify --project demo-project');
  });

  it('names only mutaba3a-pg2 as the target of a command that creates, changes or deletes an instance', () => {
    for (const sub of ['rehearse', 'cutover']) {
      const lines = mutatingLines(dry(sub).out);
      expect(lines.length, sub).toBeGreaterThanOrEqual(1);
      for (const line of lines) {
        const target = line.match(/^\+ gcloud sql (?:instances (?:create|patch|delete) (\S+)|instances clone \S+ (\S+)|backups restore \S+ --restore-instance=(\S+)|users set-password \S+ --instance=(\S+))/);
        expect(target?.slice(1).find(Boolean), line).toBe('mutaba3a-pg2');
      }
    }
  });

  it('a whole cutover ends with ingress still closed and the switch apply printed with the live image tag', () => {
    const r = cutover({}, 'cutover', '--project', 'demo-project');
    expect(r.status, r.err).toBe(0);
    expect(r.calls.filter((c) => c.includes('--ingress='))).toEqual([
      expect.stringContaining('gcloud run services update mutaba3a-api --region=me-west1 --project=demo-project --ingress=internal'),
    ]);
    expect(r.calls).toContainEqual(expect.stringMatching(/^gcloud sql backups restore 1700000000000 --restore-instance=mutaba3a-pg2 --backup-instance=mutaba3a-pg /));
    expect(r.out).toMatch(/terraform apply .*-var image_tag=abc1234 .*-var cmek_stage=active .*-var api_ingress=INGRESS_TRAFFIC_INTERNAL_ONLY/);
    expect(r.out).toContain('every table matches');
  });

  it('reopens ingress on mutaba3a-pg when the restore fails, and prints no switch', () => {
    const r = cutover({ FAKE_RESTORE_EXIT: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.calls.at(-1)).toContain('gcloud run services update mutaba3a-api --region=me-west1 --project=demo-project --ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('reopens ingress and stops when a table count differs between mutaba3a-pg and mutaba3a-pg2', () => {
    const r = cutover({ FAKE_MISMATCH: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/users/);
    expect(r.calls.at(-1)).toContain('--ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('refuses a target with less storage than the source before closing anything (C2)', () => {
    const r = cutover({ FAKE_SOURCE_GB: '25', FAKE_TARGET_GB: '10' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('--storage-size=25GB');
    expect(r.calls.some((c) => c.includes('--ingress') || c.includes('backups create') || c.includes('backups restore'))).toBe(false);
  });

  it('refuses when mutaba3a-pg2 has no key yet (cmek_stage prepared not applied)', () => {
    const r = cutover({ FAKE_NO_KEY: '1' }, 'rehearse', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('cmek_stage = "prepared"');
    expect(r.calls.some((c) => c.includes('backups'))).toBe(false);
  });

  it('refuses to copy over mutaba3a-pg2 once the API serves from it', () => {
    for (const sub of ['rehearse', 'cutover']) {
      const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2' }, sub, '--project', 'demo-project');
      expect(r.status, sub).not.toBe(0);
      expect(r.err).toMatch(/already serves from mutaba3a-pg2/);
      expect(r.calls.some((c) => c.startsWith('gcloud sql'))).toBe(false);
    }
  });

  it('verify passes when the serving revision mounts mutaba3a-pg2, and asks for the second apply while ingress is internal', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2' }, 'verify', '--project', 'demo-project');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('mutaba3a-api-00042-xyz serves 100%');
    expect(r.out).toMatch(/second apply/);
    expect(r.calls.some((c) => c.startsWith('curl'))).toBe(false);
  });

  it('verify checks /ready once ingress is open again', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_INGRESS: 'all' }, 'verify', '--project', 'demo-project');
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toContainEqual(expect.stringContaining('curl -fsS https://mutaba3a-api.example.run.app/ready'));
  });

  it('verify fails when the serving revision still mounts mutaba3a-pg', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_REVISION_SQL: 'demo-project:me-west1:mutaba3a-pg' }, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/mounts demo-project:me-west1:mutaba3a-pg\b/);
  });

  it('reopens ingress when the restored target no longer reports a key version', () => {
    const r = cutover({ FAKE_LOSE_KEY: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/after the restore mutaba3a-pg2 reports key/);
    expect(r.calls.at(-1)).toContain('--ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('a failed rehearse never touches ingress', () => {
    const r = cutover({ FAKE_RESTORE_EXIT: '1' }, 'rehearse', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.calls.some((c) => c.includes('--ingress'))).toBe(false);
  });

  it('refuses a digest-pinned image and reopens, rather than print an apply with a tag that does not exist', () => {
    const r = cutover({ FAKE_IMAGE: 'me-west1-docker.pkg.dev/demo-project/mutaba3a/mutaba3a-api@sha256:abc' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('digest-pinned');
    expect(r.calls.at(-1)).toContain('--ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('refuses any ENVIRONMENT but production before touching anything', () => {
    const r = cutover({ ENVIRONMENT: 'staging' }, 'rehearse', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('ENVIRONMENT=staging');
    expect(r.calls).toEqual([]);
  });

  it('verify fails while the rollout has not moved all traffic to the latest revision', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_PERCENT: '50' }, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/traffic is not 100% on the latest ready revision/);
  });

  it('verify fails when /ready does not answer once ingress is open', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_INGRESS: 'all', FAKE_READY_EXIT: '22' }, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('/ready did not answer 200');
  });

  // Fix 1 (review, 2026-10-21): never copy over a mutaba3a-pg2 that serves.
  it('stops when terraform state cannot be read, rather than assume mutaba3a-pg serves', () => {
    for (const sub of ['rehearse', 'cutover']) {
      const r = cutover({ FAKE_TF_OUTPUT_ERR: '1' }, sub, '--project', 'demo-project');
      expect(r.status, sub).not.toBe(0);
      expect(r.err).toMatch(/could not read cloud_sql_instance_name/);
      expect(r.calls.some((c) => c.startsWith('gcloud sql') || c.includes('--ingress')), sub).toBe(false);
    }
  });

  it('falls back to mutaba3a-pg only when the state predates the output', () => {
    const r = cutover({ FAKE_TF_NO_OUTPUT: '1' }, 'rehearse', '--project', 'demo-project');
    expect(r.status, r.err).toBe(0);
    expect(r.err).toContain('no cloud_sql_instance_name output yet');
  });

  it('refuses when the serving Cloud Run revision already mounts mutaba3a-pg2, whatever terraform says', () => {
    for (const sub of ['rehearse', 'cutover']) {
      const r = cutover({ FAKE_REVISION_SQL: 'demo-project:me-west1:mutaba3a-pg2' }, sub, '--project', 'demo-project');
      expect(r.status, sub).not.toBe(0);
      expect(r.err).toMatch(/serves from demo-project:me-west1:mutaba3a-pg2/);
      expect(r.calls.some((c) => c.includes('backups') || c.includes('--ingress')), sub).toBe(false);
    }
  });

  it('rehearse asks before overwriting mutaba3a-pg2, and stops without a terminal or --yes', () => {
    const r = run({}, ['rehearse', '--project', 'demo-project'], false);
    expect(r.status).not.toBe(0);
    // No controlling terminal: /dev/tty is missing (needs a terminal) or unreadable (the read fails).
    expect(r.err).toMatch(/needs a terminal|stopped before copying anything/);
    expect(r.calls.some((c) => c.includes('backups'))).toBe(false);
  });

  // Fix 2 (review, 2026-10-21): the copy is only good if mutaba3a-pg really was frozen.
  it('stops and reopens when mutaba3a-pg recorded a write during the copy (an UPDATE the counts cannot see)', () => {
    const r = cutover({ FAKE_WRITE_DURING: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/recorded writes during the copy/);
    expect(r.calls.at(-1)).toContain('--ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('stops when the ingress close has not taken effect, before any backup', () => {
    const r = cutover({ FAKE_INGRESS_STUCK: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/ingress still reports all/);
    expect(r.calls.some((c) => c.includes('backups create'))).toBe(false);
    expect(r.calls.at(-1)).toContain('--ingress=all');
  });

  it('declares nothing ready when ingress was reopened during the copy', () => {
    const r = cutover({ FAKE_REOPENED_MIDCOPY: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/ingress still reports all/);
    expect(r.out).not.toContain('terraform apply');
  });

  // Fix 3 (review, 2026-10-21): the stage moves only through the printed applies, in a safe order.
  it('prints the tfvars edit after verify, and both applies pin cmek_stage=active', () => {
    const r = dry('cutover');
    const lines = r.out.split('\n');
    const applies = lines.filter((l) => l.includes('terraform apply') && l.includes('cmek_stage=active'));
    expect(applies).toHaveLength(2);
    for (const a of applies) expect(a).toContain('-var cmek_stage=active');
    expect(applies[0]).toContain('-var api_ingress=INGRESS_TRAFFIC_INTERNAL_ONLY');
    expect(applies[1]).not.toContain('api_ingress');
    const verify = r.out.indexOf('cmek-cutover.sh verify');
    const tfvars = r.out.indexOf('cmek_stage = "active"');
    expect(verify).toBeGreaterThan(-1);
    expect(tfvars).toBeGreaterThan(verify);
  });

  it('verify fails when the DATABASE_URL secret does not point at mutaba3a-pg2', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_SECRET_CONN: 'demo-project:me-west1:mutaba3a-pg' }, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/DATABASE_URL secret points at demo-project:me-west1:mutaba3a-pg\b/);
    expect(r.out + r.err).not.toContain('postgresql://');
  });

  // Cycle 2 of the review (2026-10-21).
  it('stops when terraform state is empty (a wrong bucket or prefix), before touching anything', () => {
    const r = cutover({ FAKE_TF_EMPTY: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/cloud_sql_instance_name is empty/);
    expect(r.calls.some((c) => c.startsWith('gcloud sql') || c.includes('--ingress'))).toBe(false);
  });

  it('stops and reopens when mutaba3a-pg\'s write counters cannot be read', () => {
    const r = cutover({ FAKE_STATS_FAIL: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/could not read mutaba3a-pg's write counters/);
    expect(r.calls.at(-1)).toContain('--ingress=all');
    expect(r.out).not.toContain('terraform apply');
  });

  it('stops when Postgres is not counting writes (track_counts off), since the freeze check would be blind', () => {
    const r = cutover({ FAKE_TRACK_COUNTS: 'off' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/track_counts/);
    expect(r.calls.at(-1)).toContain('--ingress=all');
  });

  it('refuses when any revision taking traffic mounts mutaba3a-pg2, not only the first', () => {
    const r = cutover({ FAKE_TRAFFIC_REVS: 'mutaba3a-api-00042-xyz;rev-b', FAKE_SPLIT_REV_SQL: 'demo-project:me-west1:mutaba3a-pg2' }, 'rehearse', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/serves from demo-project:me-west1:mutaba3a-pg2 \(revision rev-b\)/);
    expect(r.calls.some((c) => c.includes('backups'))).toBe(false);
  });

  it('refuses a proxy port something already listens on, so it never counts the wrong database', async () => {
    const busy = createServer((sock) => sock.end());
    await new Promise<void>((done) => busy.listen(0, '127.0.0.1', done));
    const port = String((busy.address() as { port: number }).port);
    const r = cutover({ PROXY_PORT_TARGET: port }, 'rehearse', '--project', 'demo-project');
    await new Promise((done) => busy.close(done));
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(new RegExp(`already listens on 127.0.0.1:${port}`));
  });

  it('refuses the same port for both proxies', () => {
    const r = cutover({ PROXY_PORT_TARGET: String(ports[0]) }, 'rehearse', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/PROXY_PORT_SOURCE and PROXY_PORT_TARGET must differ/);
    expect(r.calls).toEqual([]);
  });

  it('stops when the service still answers from outside after the close', () => {
    const r = cutover({ FAKE_HEALTH_CODE: '200' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/still answers from outside/);
    expect(r.calls.some((c) => c.includes('backups create'))).toBe(false);
    expect(r.calls.at(-1)).toContain('--ingress=all');
  });

  it('checks the operator can read the DATABASE_URL secret before anything is copied or closed', () => {
    for (const sub of ['rehearse', 'cutover']) {
      const r = cutover({ FAKE_SECRET_DENIED: '1' }, sub, '--project', 'demo-project');
      expect(r.status, sub).not.toBe(0);
      expect(r.err).toMatch(/cannot read the DATABASE_URL secret/);
      expect(r.calls.some((c) => c.includes('backups') || c.includes('--ingress')), sub).toBe(false);
    }
  });

  it('tries the reopen three times before giving up and printing the command', () => {
    const r = cutover({ FAKE_RESTORE_EXIT: '1', FAKE_REOPEN_EXIT: '1' }, 'cutover', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.calls.filter((c) => c.includes('--ingress=all'))).toHaveLength(3);
    expect(r.err).toMatch(/could not reopen: run {2}gcloud run services update mutaba3a-api/);
  });

  it('prints mutaba3a-pg\'s counters for verify, pg2\'s first backup, and a rollback that names step 4.1', () => {
    const r = cutover({}, 'cutover', '--project', 'demo-project');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('scripts/cmek-cutover.sh verify --project demo-project --source-writes 10,5,0');
    expect(r.out).toContain('gcloud sql backups create --instance=mutaba3a-pg2');
    expect(r.out).toMatch(/Roll back before 4\.1/);
    expect(r.out).toMatch(/After 4\.1 and before the reopen/);
  });

  it('verify --source-writes passes while mutaba3a-pg is still frozen', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2' }, 'verify', '--project', 'demo-project', '--source-writes', '10,5,0');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('mutaba3a-pg recorded no writes since the copy');
  });

  it('verify --source-writes fails when mutaba3a-pg took writes after the copy', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_COUNTERS: '11,5,0' }, 'verify', '--project', 'demo-project', '--source-writes', '10,5,0');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/recorded writes after the copy/);
  });

  it('verify never prints a DATABASE_URL secret it cannot parse', () => {
    const r = cutover({ FAKE_ACTIVE: 'mutaba3a-pg2', FAKE_SECRET_RAW: 'postgresql://u:hunter2@10.0.0.5:5432/mutaba3a' }, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/names no \/cloudsql\/ host/);
    expect(r.out + r.err).not.toContain('hunter2');
  });

  it('verify fails while terraform still serves from mutaba3a-pg', () => {
    const r = cutover({}, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('cmek_stage = "active"');
  });
});
