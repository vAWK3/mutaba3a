import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * deploy.sh step 0 (scripts/lib/tf-bootstrap.sh). The targeted apply exists
 * for a first run on an empty project: the registry must exist before
 * `docker push`, the database before the migration. Once those resources are
 * in state the step is skipped, because a targeted plan refuses any pending
 * `moved` block and a release must never be what walks a state rename
 * (MUT-328 blocked api v0.3.18, 2026-10-20). These tests drive the helper
 * through a fake `terraform` on PATH and read back what it was asked to do.
 */

const LIB = resolve(process.cwd(), 'scripts/lib/tf-bootstrap.sh');
const TARGETS = [
  'google_artifact_registry_repository.images',
  'google_sql_user.api',
  'google_sql_database.mutaba3a',
  'google_secret_manager_secret_version.database_url',
];

let dir: string;

function fakeTerraform(stateList: string[] | null) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  const state = join(dir, 'state.txt');
  spawnSync('mkdir', ['-p', bin]);
  if (stateList) writeFileSync(state, stateList.join('\n') + '\n');
  const script = [
    '#!/usr/bin/env bash',
    `echo "$*" >> "${log}"`,
    'if [[ "$1" == "state" && "$2" == "list" ]]; then',
    `  [[ -f "${state}" ]] || { echo "No state file was found!" >&2; exit 1; }`,
    `  cat "${state}"; exit 0`,
    'fi',
    'exit 0',
  ].join('\n');
  writeFileSync(join(bin, 'terraform'), script + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  return { bin, log };
}

function run(bin: string, ...applyArgs: string[]) {
  const cmd = `source "${LIB}" && ensure_bootstrap ${applyArgs.map((a) => `'${a}'`).join(' ')}`;
  return spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

function calls(log: string): string[] {
  return existsSync(log) ? readFileSync(log, 'utf-8').trim().split('\n') : [];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tf-bootstrap-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ensure_bootstrap (deploy.sh step 0)', () => {
  it('skips the targeted apply when every bootstrap resource is already in state', () => {
    const { bin, log } = fakeTerraform([...TARGETS, 'google_cloud_run_v2_service.api']);

    const result = run(bin, '-input=false');

    expect(result.status).toBe(0);
    expect(calls(log)).toEqual(['state list']);
    expect(result.stdout).toContain('skipping');
  });

  it('applies only the four bootstrap targets when one is missing', () => {
    const { bin, log } = fakeTerraform(TARGETS.filter((t) => t !== 'google_sql_database.mutaba3a'));

    const result = run(bin, '-input=false', '-var-file=production.tfvars');

    expect(result.status).toBe(0);
    const apply = calls(log).find((c) => c.startsWith('apply '));
    expect(apply).toBe(
      `apply -input=false -var-file=production.tfvars ${TARGETS.map((t) => `-target=${t}`).join(' ')}`,
    );
    expect(result.stdout).toContain('google_sql_database.mutaba3a');
  });

  it('applies on an empty project, where there is no state to list yet', () => {
    const { bin, log } = fakeTerraform(null);

    const result = run(bin, '-input=false');

    expect(result.status).toBe(0);
    expect(calls(log).some((c) => c.startsWith('apply ') && c.includes('-target='))).toBe(true);
  });

  it('never treats a longer address as a match', () => {
    // `google_sql_user.api` must not be satisfied by `google_sql_user.api_readonly`.
    const { bin, log } = fakeTerraform([
      ...TARGETS.filter((t) => t !== 'google_sql_user.api'),
      'google_sql_user.api_readonly',
    ]);

    const result = run(bin, '-input=false');

    expect(result.status).toBe(0);
    expect(calls(log).some((c) => c.startsWith('apply '))).toBe(true);
  });
});
