import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * MUT-327: the restore drill runs against production backups, so it is only
 * ever run by the operator. What we can prove here without a cloud: a dry run
 * prints the whole sequence and calls nothing, and every command that creates,
 * changes or deletes an instance refuses anything but a drill scratch name.
 * A fake `gcloud` (and proxy, and psql) on PATH fails the run if touched.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../scripts/restore-drill.sh');
const bin = mkdtempSync(join(tmpdir(), 'restore-drill-'));
const touched = join(bin, 'touched');
for (const tool of ['gcloud', 'cloud-sql-proxy', 'psql']) {
  const path = join(bin, tool);
  writeFileSync(path, `#!/bin/sh\necho "$0 $*" >> "${touched}"\nexit 99\n`);
  chmodSync(path, 0o755);
}
afterAll(() => rmSync(bin, { recursive: true, force: true }));

function drill(...args: string[]) {
  return drillWith({}, ...args);
}

function drillWith(env: Record<string, string>, ...args: string[]) {
  rmSync(touched, { force: true });
  const run = spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: `${bin}:/usr/bin:/bin`, HOME: bin, ...env },
    input: '',
  });
  return { status: run.status, out: run.stdout, err: run.stderr, touched: existsSync(touched) };
}

/**
 * MUT-381: without --instance the drill asks terraform state which instance the API serves from. A fake
 * `terraform` answers init with $FAKE_TF_INIT (default 0) and `output -raw cloud_sql_instance_name` with
 * $FAKE_TF_INSTANCE (no output, exit 1, when empty). The fake gcloud then stops the run at its first call.
 */
const tfBin = mkdtempSync(join(tmpdir(), 'restore-drill-tf-'));
writeFileSync(
  join(tfBin, 'terraform'),
  [
    '#!/bin/sh',
    'case "$1" in',
    '  init) exit "${FAKE_TF_INIT:-0}" ;;',
    '  output) [ -z "$FAKE_TF_OUTPUT_ERR" ] || { echo "Error: Failed to load state: 503" >&2; exit 1; }',
    '          [ -n "$FAKE_TF_INSTANCE" ] || { echo "Error: Output \\"cloud_sql_instance_name\\" not found" >&2; exit 1; }',
    '          printf "%s" "$FAKE_TF_INSTANCE"; exit 0 ;;',
    'esac',
    'exit 0',
  ].join('\n') + '\n',
);
chmodSync(join(tfBin, 'terraform'), 0o755);
afterAll(() => rmSync(tfBin, { recursive: true, force: true }));

function drillFromState(env: Record<string, string>, ...args: string[]) {
  return drillWith({ PATH: `${tfBin}:${bin}:/usr/bin:/bin`, TF_STATE_BUCKET: 'demo-state', ...env }, ...args);
}

const mutatingLines = (out: string) =>
  out.split('\n').filter((l) => /^\+ gcloud sql (instances (create|clone|patch|delete)|backups restore|users set-password)/.test(l));

describe('restore-drill.sh', () => {
  it('prints usage and exits 2 without --project', () => {
    const r = drill('--dry-run');
    expect(r.status).toBe(2);
    expect(r.err).toContain('usage:');
    expect(r.touched).toBe(false);
  });

  it('dry run prints the backup restore, the point-in-time clone, the checks and the teardown, and calls nothing', () => {
    const r = drill('--project', 'demo-project', '--dry-run');
    expect(r.status, r.err).toBe(0);
    expect(r.touched).toBe(false);
    expect(r.out).toContain('+ terraform output -raw cloud_sql_instance_name');
    expect(r.out).toMatch(/\+ gcloud sql backups list --instance=<active-instance> --project=demo-project .*type=AUTOMATED/);
    expect(r.out).toMatch(/\+ gcloud sql instances create mutaba3a-pg-drill-\d{8}t\d{6}-b /);
    expect(r.out).toMatch(/--no-deletion-protection/);
    expect(r.out).toMatch(/\+ gcloud sql backups restore <backup-id> --restore-instance=mutaba3a-pg-drill-\d{8}t\d{6}-b --backup-instance=<active-instance> /);
    expect(r.out).toMatch(/\+ gcloud sql instances clone <active-instance> mutaba3a-pg-drill-\d{8}t\d{6}-p --point-in-time=\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000Z /);
    expect(r.out).toMatch(/\+ gcloud storage objects describe gs:\/\/demo-project-mutaba3a-attachments\//);
    expect(r.out).toMatch(/\+ gcloud sql instances delete mutaba3a-pg-drill-\d{8}t\d{6}-b /);
    expect(r.out).toMatch(/\+ gcloud sql instances delete mutaba3a-pg-drill-\d{8}t\d{6}-p /);
    expect(r.out).toContain('| Step | Seconds |');
  });

  it('names only drill scratch instances as the target of a command that creates, changes or deletes', () => {
    const lines = mutatingLines(drill('--project', 'demo-project', '--dry-run').out);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    for (const line of lines) {
      const target = line.match(/^\+ gcloud sql (?:instances (?:create|patch|delete) (\S+)|instances clone \S+ (\S+)|backups restore \S+ --restore-instance=(\S+)|users set-password \S+ --instance=(\S+))/);
      const name = target?.slice(1).find(Boolean);
      expect(name, line).toMatch(/^mutaba3a-pg-drill-\d{8}t\d{6}-[bp]$/);
    }
  });

  it('--instance names the source, and terraform is not asked', () => {
    const r = drill('--project', 'demo-project', '--dry-run', '--instance', 'mutaba3a-pg');
    expect(r.status, r.err).toBe(0);
    expect(r.out).not.toContain('terraform output');
    expect(r.out).toMatch(/\+ gcloud sql backups list --instance=mutaba3a-pg --project=demo-project /);
  });

  it('creates the backup scratch instance under the source\'s key when it has one (MUT-381)', () => {
    const r = drill('--project', 'demo-project', '--dry-run');
    expect(r.out).toMatch(/\+ gcloud sql instances create mutaba3a-pg-drill-\d{8}t\d{6}-b .* --disk-encryption-key=<source-kms-key> --quiet/);
    expect(r.out).toContain('diskEncryptionConfiguration.kmsKeyName');
  });

  it('without --instance, drills the instance terraform says the API serves from (MUT-381)', () => {
    const r = drillFromState({ FAKE_TF_INSTANCE: 'mutaba3a-pg2' }, '--project', 'demo-project');
    expect(r.out).toContain('source mutaba3a-pg2 (read-only)');
  });

  it('falls back to mutaba3a-pg when the state predates the output, and says so', () => {
    const r = drillFromState({ FAKE_TF_INSTANCE: '' }, '--project', 'demo-project');
    expect(r.err).toContain('no cloud_sql_instance_name output yet');
    expect(r.out).toContain('source mutaba3a-pg (read-only)');
  });

  it('stops when the output cannot be read, rather than drilling the frozen instance', () => {
    const r = drillFromState({ FAKE_TF_OUTPUT_ERR: '1', FAKE_TF_INSTANCE: 'mutaba3a-pg2' }, '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/could not read cloud_sql_instance_name/);
    expect(r.out).not.toContain('(read-only)');
  });

  it('stops when terraform state cannot be read, rather than guessing the source', () => {
    const r = drillFromState({ FAKE_TF_INIT: '1', FAKE_TF_INSTANCE: 'mutaba3a-pg2' }, '--project', 'demo-project');
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('terraform init failed');
    expect(r.out).not.toContain('(read-only)');
    expect(r.touched).toBe(false);
  });

  it('--only pitr skips the backup restore', () => {
    const r = drill('--project', 'demo-project', '--dry-run', '--only', 'pitr');
    expect(r.status, r.err).toBe(0);
    expect(r.out).not.toContain('gcloud sql backups restore');
    expect(r.out).toContain('gcloud sql instances clone');
  });

  it('refuses to tear down the production instance or any name outside the drill pattern', () => {
    for (const name of ['mutaba3a-pg', 'mutaba3a-pg-restore-1', 'mutaba3a-pg-drill-x']) {
      const r = drill('teardown', '--project', 'demo-project', '--name', name, '--dry-run');
      expect(r.status, name).not.toBe(0);
      expect(r.err).toMatch(/refusing/i);
      expect(r.touched).toBe(false);
    }
  });

  it('tears down a named drill instance in a dry run', () => {
    const r = drill('teardown', '--project', 'demo-project', '--name', 'mutaba3a-pg-drill-20261020t180000-b', '--dry-run');
    expect(r.status, r.err).toBe(0);
    expect(r.out).toContain('+ gcloud sql instances delete mutaba3a-pg-drill-20261020t180000-b --project=demo-project --quiet');
  });

  it('refuses a drill scratch name as the source instance', () => {
    const r = drill('--project', 'demo-project', '--instance', 'mutaba3a-pg-drill-20261020t180000-b', '--dry-run');
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/refusing/i);
  });

  it('refuses a point in time older than the 7 days of logs, or not in the past', () => {
    expect(drill('--project', 'demo-project', '--dry-run', '--pitr-minutes', '20000').status).not.toBe(0);
    expect(drill('--project', 'demo-project', '--dry-run', '--pitr-minutes', '0').status).not.toBe(0);
  });
});
