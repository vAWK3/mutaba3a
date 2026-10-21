import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * MUT-381 (ADR-164): deploy.sh refuses a release that would move the database or reopen a closed service.
 * deploy.sh runs a full terraform apply, so a release whose effective cmek_stage disagrees with what serves
 * would switch to an empty or unmigrated mutaba3a-pg2, or silently back to a frozen mutaba3a-pg (a stale
 * git-ignored tfvars in another checkout), and a release during a cutover would reopen ingress mid-copy.
 * Driven through a fake terraform (output, state list, console) and gcloud on PATH, the way
 * deploy-bootstrap.test.ts drives ensure_bootstrap.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/release-guard.sh');
const DEPLOY = resolve(process.cwd(), 'scripts/deploy.sh');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'release-guard-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

type Opts = {
  stage?: string; // what `terraform console` evaluates var.cmek_stage to
  ingress?: string; // ... and var.api_ingress
  serving?: string | null; // terraform output cloud_sql_instance_name; null = no such output
  outputError?: boolean;
  outputEmpty?: boolean;
  keyInState?: boolean;
  live?: string; // ingress-status of the live service
  serviceMissing?: boolean;
  gcloudError?: boolean;
  mounts?: string; // what every serving revision mounts
  env?: Record<string, string | undefined>; // undefined = unset; SKIP_CMEK_GUARD defaults to 0 (guard on)
};

function guard(o: Opts) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  const output = o.outputError
    ? 'echo "Error: Failed to load state: 503" >&2; exit 1'
    : o.outputEmpty
      ? 'exit 0'
      : o.serving === null || o.serving === undefined
        ? 'echo "Error: Output \\"cloud_sql_instance_name\\" not found" >&2; exit 1'
        : `printf '%s' '${o.serving}'`;
  writeFileSync(
    join(bin, 'terraform'),
    [
      '#!/bin/bash',
      `echo "terraform $*" >> "${log}"`,
      'case "$1" in',
      `  output) ${output} ;;`,
      `  state) ${o.keyInState ? "printf 'google_kms_crypto_key.data[0]\\ngoogle_sql_database_instance.postgres\\n'" : "printf 'google_sql_database_instance.postgres\\n'"} ;;`,
      `  console) cat >/dev/null; printf '"%s"\\n"%s"\\n' '${o.stage ?? 'off'}' '${o.ingress ?? 'INGRESS_TRAFFIC_ALL'}' ;;`,
      'esac',
      'exit 0',
    ].join('\n') + '\n',
  );
  const describe = o.gcloudError
    ? 'echo "ERROR: (gcloud.run.services.describe) There was a problem refreshing your current auth tokens" >&2; exit 1'
    : o.serviceMissing
      ? 'echo "ERROR: (gcloud.run.services.describe) Cannot find service [mutaba3a-api]" >&2; exit 1'
      : `echo "${o.live ?? 'all'}"`;
  writeFileSync(
    join(bin, 'gcloud'),
    [
      '#!/bin/bash',
      `echo "gcloud $*" >> "${log}"`,
      'case "$*" in',
      `  *"run services describe"*"ingress-status"*) ${describe} ;;`,
      '  *"run services describe"*"traffic"*) echo "mutaba3a-api-00042-xyz;mutaba3a-api-00043-new" ;;',
      `  *"run revisions describe"*) echo "${o.mounts ?? `demo-project:me-west1:${o.serving ?? 'mutaba3a-pg'}`}" ;;`,
      'esac',
    ].join('\n') + '\n',
  );
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_cmek_release "" mutaba3a-api me-west1 demo-project -input=false -var-file=production.tfvars -var image_tag=abc`;
  const env: NodeJS.ProcessEnv = { ...process.env, SKIP_CMEK_GUARD: '0', ...o.env, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(env)) if (v === undefined) delete env[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env });
  return { status: r.status, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

// Each case spawns bash and fake CLIs; under the full suite's parallel load one can pass 5 s.
describe('guard_cmek_release (deploy.sh steps 0, 3 and 4)', { timeout: 30_000 }, () => {
  it('lets a release through before MUT-381 was ever applied (no output, stage off)', () => {
    expect(guard({ serving: null }).status).toBe(0);
  });

  it('lets a release through at prepared while mutaba3a-pg serves', () => {
    expect(guard({ stage: 'prepared', serving: 'mutaba3a-pg', keyInState: true }).status).toBe(0);
  });

  it('lets a release through at active once mutaba3a-pg2 serves', () => {
    expect(guard({ stage: 'active', serving: 'mutaba3a-pg2', keyInState: true }).status).toBe(0);
  });

  it('evaluates the stage the apply will use (terraform console with the same var files), not a grep of one file', () => {
    const r = guard({ stage: 'prepared', serving: 'mutaba3a-pg' });
    expect(r.calls).toMatch(/terraform console -var-file=production.tfvars -var image_tag=abc/);
    expect(r.calls).not.toContain('console -input');
  });

  it('refuses a release that would switch to mutaba3a-pg2 (off → active, or tfvars edited before the switch)', () => {
    const r = guard({ stage: 'active', serving: 'mutaba3a-pg' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/serves mutaba3a-pg2, but production serves mutaba3a-pg/);
  });

  it('refuses a stale tfvars that would move the API back to the frozen mutaba3a-pg', () => {
    const r = guard({ stage: 'prepared', serving: 'mutaba3a-pg2', keyInState: true });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/serves mutaba3a-pg, but production serves mutaba3a-pg2/);
  });

  it('refuses stage off once the key exists, rather than plan its destroy after migrating', () => {
    const r = guard({ stage: 'off', serving: 'mutaba3a-pg', keyInState: true });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/cmek_stage = "off" but the KMS key exists/);
  });

  it('refuses when the state cannot be read, or is empty, rather than guess', () => {
    const unreadable = guard({ stage: 'active', outputError: true });
    expect(unreadable.status).not.toBe(0);
    expect(unreadable.err).toMatch(/could not read cloud_sql_instance_name/);
    const empty = guard({ stage: 'prepared', outputEmpty: true });
    expect(empty.status).not.toBe(0);
    expect(empty.err).toMatch(/cloud_sql_instance_name is empty/);
  });

  it('refuses when a serving revision mounts another instance than the one terraform names', () => {
    const r = guard({ stage: 'prepared', serving: 'mutaba3a-pg', keyInState: true, mounts: 'demo-project:me-west1:mutaba3a-pg2' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/mutaba3a-api-00042-xyz mounts demo-project:me-west1:mutaba3a-pg2/);
  });

  it('refuses to reopen a service a cutover or restore has closed', () => {
    const cases: Array<[string, string]> = [
      ['prepared', 'mutaba3a-pg'],
      ['active', 'mutaba3a-pg2'], // between the tfvars edit (4.4) and the reopen (4.5)
    ];
    for (const [stage, serving] of cases) {
      const r = guard({ stage, serving, keyInState: true, live: 'internal' });
      expect(r.status, stage).not.toBe(0);
      expect(r.err).toMatch(/closed to outside traffic/);
    }
  });

  it('lets a deliberately closed release through when api_ingress keeps it internal', () => {
    const r = guard({ stage: 'prepared', ingress: 'INGRESS_TRAFFIC_INTERNAL_ONLY', serving: 'mutaba3a-pg', keyInState: true, live: 'internal' });
    expect(r.status).toBe(0);
  });

  it('refuses when gcloud cannot say whether the service is closed', () => {
    const r = guard({ stage: 'prepared', serving: 'mutaba3a-pg', keyInState: true, gcloudError: true });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/could not read mutaba3a-api's ingress/);
  });

  it('lets a first deploy through when the service does not exist yet', () => {
    expect(guard({ serving: null, serviceMissing: true }).status).toBe(0);
  });

  it('is off by default (until MUT-385): says so, and touches neither terraform nor gcloud', () => {
    // The worst case: a release the guard would refuse, with state unreadable and gcloud failing.
    for (const value of [undefined, '', '1']) {
      const r = guard({ stage: 'active', outputError: true, gcloudError: true, env: { SKIP_CMEK_GUARD: value } });
      expect(r.status, String(value)).toBe(0);
      expect(r.err).toMatch(/CMEK release guard off \(the default until MUT-385; SKIP_CMEK_GUARD=0 turns it on\)/);
      expect(r.calls).toBe('');
    }
  });

  it('SKIP_CMEK_GUARD=0 turns it on', () => {
    const r = guard({ stage: 'active', serving: 'mutaba3a-pg', env: { SKIP_CMEK_GUARD: '0' } });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/production serves mutaba3a-pg/);
  });
});

describe('deploy.sh calls the guard before every step that can move or reopen anything', () => {
  it('guards before the bootstrap apply, before the migration and before the full apply', () => {
    const src = readFileSync(DEPLOY, 'utf-8');
    // Calls only: `guard_cmek_release "…` at step 0, and the `guard_release` wrapper (not its definition).
    const guardAt = [...src.matchAll(/^(?:guard_cmek_release "|guard_release(?!\(\)))/gm)].map((m) => m.index ?? -1);
    const bootstrap = src.indexOf('ensure_bootstrap "');
    const migrate = src.indexOf('npx prisma migrate deploy');
    const apply = src.indexOf('terraform apply "${TF_ARGS[@]}"');
    expect(guardAt.length).toBeGreaterThanOrEqual(3);
    expect(guardAt.some((g) => g < bootstrap)).toBe(true);
    expect(guardAt.some((g) => g > bootstrap && g < migrate)).toBe(true);
    expect(guardAt.some((g) => g > migrate && g < apply)).toBe(true);
  });
});
