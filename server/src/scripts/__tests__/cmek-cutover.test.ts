import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * MUT-381 (ADR-163): the CMEK cutover copies production into mutaba3a-pg2 while the API is closed, so only
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

const fakes: Record<string, string> = {
  gcloud: `#!/bin/bash
echo "gcloud $*" >> "${calls}"
args="$*"
case "$args" in
  "config get-value account"*) echo "ops@example.com" ;;
  "sql instances describe mutaba3a-pg2 "*"connectionName"*)
    if [[ -n "$FAKE_NO_KEY" ]]; then printf ',%s,demo-project:me-west1:mutaba3a-pg2,\\n' "\${FAKE_TARGET_GB:-10}";
    else printf '%s,%s,demo-project:me-west1:mutaba3a-pg2,%s/cryptoKeyVersions/1\\n' "${KEY}" "\${FAKE_TARGET_GB:-10}" "${KEY}"; fi ;;
  "sql instances describe mutaba3a-pg "*) printf '%s\\tdemo-project:me-west1:mutaba3a-pg\\n' "\${FAKE_SOURCE_GB:-10}" ;;
  "sql backups create"*) ;;
  "sql backups list"*) echo "1700000000000" ;;
  "sql backups restore"*) exit "\${FAKE_RESTORE_EXIT:-0}" ;;
  "run services update"*) ;;
  "run services describe"*"image"*) echo "me-west1-docker.pkg.dev/demo-project/mutaba3a/mutaba3a-api:abc1234" ;;
  "run services describe"*) printf '%s\\t100\\t%s\\t%s\\t%s\\n' mutaba3a-api-00042-xyz mutaba3a-api-00042-xyz "\${FAKE_INGRESS:-internal}" https://mutaba3a-api.example.run.app ;;
  "run revisions describe"*) echo "\${FAKE_REVISION_SQL:-demo-project:me-west1:mutaba3a-pg2}" ;;
  *) echo "unexpected gcloud call: $args" >&2; exit 98 ;;
esac
`,
  terraform: `#!/bin/bash
echo "terraform $*" >> "${calls}"
case "$1 $3" in
  "init "*) exit 0 ;;
  "output cloud_sql_instance_name") printf '%s' "\${FAKE_ACTIVE:-mutaba3a-pg}" ;;
  "output local_database_url") printf '%s' "postgresql://mutaba3a_api:s3cret@127.0.0.1:5440/mutaba3a" ;;
  *) exit 1 ;;
esac
`,
  'cloud-sql-proxy': `#!/bin/bash
echo "cloud-sql-proxy $*" >> "${calls}"
exec sleep 60
`,
  psql: `#!/bin/bash
args="$*"
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
exit "\${FAKE_READY_EXIT:-0}"
`,
};
for (const [tool, body] of Object.entries(fakes)) {
  const path = join(bin, tool);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

const servers: Server[] = [];
const ports: number[] = [];
beforeAll(async () => {
  for (let i = 0; i < 2; i++) {
    const server = createServer((socket) => socket.end());
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    servers.push(server);
    ports.push((server.address() as { port: number }).port);
  }
});
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((done) => s.close(done))));
  rmSync(bin, { recursive: true, force: true });
});

function cutover(env: Record<string, string>, ...args: string[]) {
  rmSync(calls, { force: true });
  const run = spawnSync('bash', [SCRIPT, ...args, ...(args.includes('--dry-run') ? [] : ['--yes'])], {
    encoding: 'utf8',
    env: {
      PATH: `${bin}:/usr/bin:/bin`,
      HOME: bin,
      TF_STATE_BUCKET: 'demo-state',
      PROXY_PORT_SOURCE: String(ports[0]),
      PROXY_PORT_TARGET: String(ports[1]),
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

describe('cmek-cutover.sh', () => {
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

  it('verify fails while terraform still serves from mutaba3a-pg', () => {
    const r = cutover({}, 'verify', '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('cmek_stage = "active"');
  });
});
