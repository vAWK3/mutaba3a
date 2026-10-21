import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * MUT-381 (ADR-163): deploy.sh step 0 refuses a release that would move the database or reopen a closed
 * service. deploy.sh runs a full terraform apply, so a release whose tfvars disagree with what serves would
 * switch to an empty or unmigrated mutaba3a-pg2, or silently back to a frozen mutaba3a-pg (a stale
 * git-ignored tfvars in another checkout), and a release during a cutover would reopen ingress mid-copy.
 * Driven through a fake terraform and gcloud on PATH, the way deploy-bootstrap.test.ts drives ensure_bootstrap.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/release-guard.sh');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-guard-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function guard(opts: { tfvars: string; serving?: string | null; outputError?: boolean; live?: string }) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(dir, 'production.tfvars'), opts.tfvars);
  const output = opts.outputError
    ? 'echo "Error: Failed to load state: 503" >&2; exit 1'
    : opts.serving === null || opts.serving === undefined
      ? 'echo "Error: Output \\"cloud_sql_instance_name\\" not found" >&2; exit 1'
      : `printf '%s' '${opts.serving}'`;
  writeFileSync(join(bin, 'terraform'), `#!/bin/bash\necho "terraform $*" >> "${log}"\n[[ "$1" == output ]] && { ${output}; }\nexit 0\n`);
  writeFileSync(join(bin, 'gcloud'), `#!/bin/bash\necho "gcloud $*" >> "${log}"\necho "${opts.live ?? 'all'}"\n`);
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; source "${LIB}" && guard_cmek_release production.tfvars "" mutaba3a-api me-west1 demo-project`;
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], {
    cwd: dir,
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
  return { status: r.status, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('guard_cmek_release (deploy.sh step 0)', () => {
  it('lets a release through before MUT-381 was ever applied (no output, no stage)', () => {
    expect(guard({ tfvars: 'project_id = "p"\n', serving: null }).status).toBe(0);
  });

  it('lets a release through at prepared while mutaba3a-pg serves', () => {
    expect(guard({ tfvars: 'cmek_stage = "prepared"\n', serving: 'mutaba3a-pg' }).status).toBe(0);
  });

  it('lets a release through at active once mutaba3a-pg2 serves', () => {
    expect(guard({ tfvars: '  cmek_stage   =   "active"  # since the cutover\n', serving: 'mutaba3a-pg2' }).status).toBe(0);
  });

  it('refuses a release that would switch to mutaba3a-pg2 (off → active, or tfvars edited before the switch)', () => {
    const r = guard({ tfvars: 'cmek_stage = "active"\n', serving: 'mutaba3a-pg' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/serves mutaba3a-pg2, but production serves mutaba3a-pg/);
  });

  it('refuses a stale tfvars that would move the API back to the frozen mutaba3a-pg', () => {
    const r = guard({ tfvars: 'cmek_stage = "prepared"\n', serving: 'mutaba3a-pg2' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/serves mutaba3a-pg, but production serves mutaba3a-pg2/);
  });

  it('refuses when the state cannot be read, rather than guess', () => {
    const r = guard({ tfvars: 'cmek_stage = "active"\n', outputError: true });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/could not read cloud_sql_instance_name/);
  });

  it('refuses to reopen a service a cutover or restore has closed', () => {
    const r = guard({ tfvars: 'cmek_stage = "prepared"\n', serving: 'mutaba3a-pg', live: 'internal' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/closed to outside traffic/);
  });

  it('lets a deliberately closed release through when tfvars keeps ingress internal', () => {
    const r = guard({
      tfvars: 'cmek_stage = "prepared"\napi_ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"\n',
      serving: 'mutaba3a-pg',
      live: 'internal',
    });
    expect(r.status).toBe(0);
  });
});
