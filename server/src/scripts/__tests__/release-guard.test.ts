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
    // MUT-347: step 4 is `apply_release`, shared with the rollback, which runs `guard_release` before its apply.
    const guardAt = [...src.matchAll(/^(?:guard_cmek_release "|guard_release(?!\(\))|apply_release$)/gm)].map((m) => m.index ?? -1);
    const bootstrap = src.indexOf('ensure_bootstrap "');
    const migrate = src.indexOf('npx prisma migrate deploy');
    const applyRelease = /^apply_release\(\) \{\n[\s\S]*?\n\}/m.exec(src)?.[0] ?? '';
    expect(applyRelease.indexOf('guard_release')).toBeGreaterThan(-1);
    expect(applyRelease.indexOf('guard_release')).toBeLessThan(applyRelease.indexOf('terraform apply "${TF_ARGS[@]}"'));
    expect(guardAt.length).toBeGreaterThanOrEqual(3);
    expect(guardAt.some((g) => g < bootstrap)).toBe(true);
    expect(guardAt.some((g) => g > bootstrap && g < migrate)).toBe(true);
    expect(guardAt.some((g) => g > migrate)).toBe(true); // the top-level apply_release
  });
});


/** MUT-360 review: guard_stripe_release keeps a checkout without stripe_enabled from switching Stripe off. */
type StripeOpts = {
  enabled?: string; // what `terraform console` gives for var.stripe_enabled ('true' | 'false' | garbage)
  consoleFails?: boolean;
  consoleNotice?: boolean; // a notice line after the value
  job?: 'missing' | 'error' | 'ENABLED' | 'PAUSED';
  env?: 'missing' | 'error' | string; // ;-separated env names on the service template
  skip?: string; // SKIP_STRIPE_GUARD
};

function stripeGuard(o: StripeOpts) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'terraform'), [
    '#!/bin/bash',
    `echo "terraform $*" >> "${log}"`,
    `case "$1" in console) cat >/dev/null; ${o.consoleFails ? 'echo "Error: boom" >&2; exit 1' : `printf '%s\\n' '${o.enabled ?? 'false'}'${o.consoleNotice ? "; echo 'Note: provider upgrade available'" : ''}`} ;; esac`,
    'exit 0',
  ].join('\n') + '\n');
  const job = o.job ?? 'missing';
  const env = o.env ?? 'PORT;DATABASE_URL';
  writeFileSync(join(bin, 'gcloud'), [
    '#!/bin/bash',
    `echo "gcloud $*" >> "${log}"`,
    'case "$*" in',
    `  *"scheduler jobs describe"*) ${job === 'missing' ? 'echo "ERROR: (gcloud.scheduler.jobs.describe) NOT_FOUND: Job not found." >&2; exit 1' : job === 'error' ? 'echo "ERROR: auth tokens" >&2; exit 1' : `echo ${job}`} ;;`,
    `  *"run services describe"*"env[].name"*) ${env === 'missing' ? 'echo "ERROR: Cannot find service [mutaba3a-api]" >&2; exit 1' : env === 'error' ? 'echo "ERROR: PERMISSION_DENIED" >&2; exit 1' : `echo '${env}'`} ;;`,
    '  *) echo "unexpected gcloud call: $*" >&2; exit 98 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_stripe_release "" mutaba3a-api me-west1 demo-project -input=false -var-file=production.tfvars -var image_tag=abc`;
  const e: NodeJS.ProcessEnv = { ...process.env, SKIP_STRIPE_GUARD: o.skip, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env: e });
  return { status: r.status, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('guard_stripe_release (deploy.sh steps 0, 3 and 4)', { timeout: 30_000 }, () => {
  it('lets a release through when the checkout keeps Stripe on, and warns while the job is paused', () => {
    expect(stripeGuard({ enabled: 'true', job: 'ENABLED' }).status).toBe(0);
    const paused = stripeGuard({ enabled: 'true', job: 'PAUSED' });
    expect(paused.status).toBe(0);
    expect(paused.err).toMatch(/is paused: the nightly Stripe reconcile/);
    expect(stripeGuard({ enabled: 'true', job: 'error' }).status).toBe(0); // only the warning needs the job
  });

  it('lets stripe_enabled false through while production runs no Stripe, and on a first deploy', () => {
    expect(stripeGuard({ enabled: 'false' }).status).toBe(0);
    expect(stripeGuard({ enabled: 'false', env: 'missing' }).status).toBe(0);
    expect(stripeGuard({ enabled: 'false', env: 'PORT;STRIPE_SECRET_KEY_OLD' }).status).toBe(0);
  });

  it('refuses stripe_enabled false (or unset) while the reconcile job exists, paused or not', () => {
    for (const job of ['ENABLED', 'PAUSED'] as const) {
      const r = stripeGuard({ enabled: 'false', job });
      expect(r.status, job).not.toBe(0);
      expect(r.err).toMatch(/stripe_enabled is false \(or unset\), but production runs Stripe: the Scheduler job mutaba3a-stripe-reconcile exists/);
    }
  });

  it('refuses stripe_enabled false while the service mounts STRIPE_SECRET_KEY, even with no job', () => {
    const r = stripeGuard({ enabled: 'false', env: 'PORT;STRIPE_SECRET_KEY;STRIPE_WEBHOOK_SECRET' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/mutaba3a-api mounts STRIPE_SECRET_KEY/);
  });

  it('refuses rather than guess when it cannot read the job, the service, or the variable', () => {
    expect(stripeGuard({ enabled: 'false', job: 'error' }).err).toMatch(/could not read the Scheduler job/);
    expect(stripeGuard({ enabled: 'false', env: 'error' }).err).toMatch(/could not read mutaba3a-api's env/);
    expect(stripeGuard({ consoleFails: true }).err).toMatch(/could not evaluate stripe_enabled/);
    expect(stripeGuard({ enabled: 'maybe' }).err).toMatch(/gave 'maybe' for stripe_enabled/);
  });

  it('reads only the first line of terraform console, so a notice after it can\'t refuse a release', () => {
    expect(stripeGuard({ enabled: 'true', job: 'ENABLED', consoleNotice: true }).status).toBe(0);
    expect(stripeGuard({ enabled: 'false', job: 'ENABLED', consoleNotice: true }).err).toMatch(/stripe_enabled is false/);
  });

  it('evaluates stripe_enabled with the release\'s own var files', () => {
    expect(stripeGuard({ enabled: 'true' }).calls).toMatch(/terraform console -var-file=production.tfvars -var image_tag=abc/);
  });

  it('SKIP_STRIPE_GUARD=1 skips it: says so, and touches neither terraform nor gcloud', () => {
    const r = stripeGuard({ enabled: 'false', job: 'ENABLED', skip: '1' });
    expect(r.status).toBe(0);
    expect(r.err).toMatch(/Stripe release guard skipped \(SKIP_STRIPE_GUARD=1\)/);
    expect(r.calls).toBe('');
  });
});

describe('deploy.sh wires the Stripe guard (MUT-360 review)', () => {
  it('runs guard_stripe_release before bootstrap, and guard_release() runs both guards', () => {
    const deploy = readFileSync(DEPLOY, 'utf-8');
    expect(deploy.indexOf('guard_stripe_release "')).toBeGreaterThan(-1);
    expect(deploy.indexOf('guard_stripe_release "')).toBeLessThan(deploy.indexOf('ensure_bootstrap "'));
    const wrapper = /guard_release\(\)\s*\{[\s\S]*?\n\}/.exec(deploy)?.[0] ?? '';
    expect(wrapper).toMatch(/guard_cmek_release/);
    expect(wrapper).toMatch(/guard_stripe_release/);
  });
});

/** MUT-148: guard_sentry_release keeps a checkout without sentry_enabled from switching error reports off. */
type SentryOpts = {
  enabled?: string; // what `terraform console` gives for var.sentry_enabled
  consoleFails?: boolean;
  env?: 'missing' | 'error' | string; // ;-separated env names on the service template
  skip?: string; // SKIP_SENTRY_GUARD
};

function sentryGuard(o: SentryOpts) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'terraform'), [
    '#!/bin/bash',
    `echo "terraform $*" >> "${log}"`,
    `case "$1" in console) cat >/dev/null; ${o.consoleFails ? 'echo "Error: boom" >&2; exit 1' : `printf '%s\\n' '${o.enabled ?? 'false'}'`} ;; esac`,
    'exit 0',
  ].join('\n') + '\n');
  const env = o.env ?? 'PORT;DATABASE_URL';
  writeFileSync(join(bin, 'gcloud'), [
    '#!/bin/bash',
    `echo "gcloud $*" >> "${log}"`,
    'case "$*" in',
    `  *"run services describe"*"env[].name"*) ${env === 'missing' ? 'echo "ERROR: Cannot find service [mutaba3a-api]" >&2; exit 1' : env === 'error' ? 'echo "ERROR: PERMISSION_DENIED" >&2; exit 1' : `echo '${env}'`} ;;`,
    '  *) echo "unexpected gcloud call: $*" >&2; exit 98 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_sentry_release "" mutaba3a-api me-west1 demo-project -input=false -var-file=production.tfvars -var image_tag=abc && echo "SENTRY_ENABLED=\${SENTRY_ENABLED}"`;
  const e: NodeJS.ProcessEnv = { ...process.env, SKIP_SENTRY_GUARD: o.skip, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env: e });
  return { status: r.status, out: r.stdout, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('guard_sentry_release (MUT-148, deploy.sh steps 0, 3 and 4)', { timeout: 30_000 }, () => {
  it('lets a release through with sentry_enabled true, and tells deploy.sh so', () => {
    const r = sentryGuard({ enabled: 'true', env: 'PORT;SENTRY_DSN' });
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/SENTRY_ENABLED=true/);
  });

  it('lets sentry_enabled false through while production reports nothing, and on a first deploy', () => {
    expect(sentryGuard({ enabled: 'false' }).out).toMatch(/SENTRY_ENABLED=false/);
    expect(sentryGuard({ enabled: 'false', env: 'missing' }).status).toBe(0);
    expect(sentryGuard({ enabled: 'false', env: 'PORT;SENTRY_DSN_OLD' }).status).toBe(0);
  });

  it('refuses sentry_enabled false (or unset) while the service mounts SENTRY_DSN', () => {
    const r = sentryGuard({ enabled: 'false', env: 'PORT;SENTRY_DSN;SENTRY_ENVIRONMENT' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/sentry_enabled is false \(or unset\), but mutaba3a-api mounts SENTRY_DSN/);
  });

  it('refuses rather than guess when it cannot read the service or the variable', () => {
    expect(sentryGuard({ enabled: 'false', env: 'error' }).err).toMatch(/could not read mutaba3a-api's env/);
    expect(sentryGuard({ consoleFails: true }).err).toMatch(/could not evaluate sentry_enabled/);
    expect(sentryGuard({ enabled: 'maybe' }).err).toMatch(/gave 'maybe' for sentry_enabled/);
  });

  it('SKIP_SENTRY_GUARD=1 skips the check but still reads sentry_enabled, which the smoke needs', () => {
    const r = sentryGuard({ enabled: 'false', env: 'PORT;SENTRY_DSN', skip: '1' });
    expect(r.status).toBe(0);
    expect(r.err).toMatch(/Sentry release guard skipped \(SKIP_SENTRY_GUARD=1\)/);
    expect(r.out).toMatch(/SENTRY_ENABLED=false/);
    expect(r.calls).not.toMatch(/gcloud/);
  });
});

describe('deploy.sh wires error reporting (MUT-148)', () => {
  const deploy = readFileSync(DEPLOY, 'utf-8');

  it('runs guard_sentry_release before bootstrap, and guard_release() runs it too', () => {
    expect(deploy.indexOf('guard_sentry_release "')).toBeGreaterThan(-1);
    expect(deploy.indexOf('guard_sentry_release "')).toBeLessThan(deploy.indexOf('ensure_bootstrap "'));
    const wrapper = /guard_release\(\)\s*\{[\s\S]*?\n\}/.exec(deploy)?.[0] ?? '';
    expect(wrapper).toMatch(/guard_sentry_release/);
  });

  it('asks the smoke to check /health errorReporting on every smoke run', () => {
    // MUT-347: smoke_release passes it when EXPECT_ERROR_REPORTING is set; a deploy always sets it (a rollback to a
    // commit from before MUT-148 leaves it empty: rollback.test.ts).
    const smokes = [...deploy.matchAll(/^\s*npm run --silent smoke -- .*$/gm)].map((m) => m[0]);
    expect(smokes.length).toBeGreaterThan(0);
    for (const line of smokes) expect(line).toContain('"${expect[@]+"${expect[@]}"}"');
    expect(deploy).toContain('[[ -n "${EXPECT_ERROR_REPORTING}" ]] && expect=(--expect-error-reporting "${EXPECT_ERROR_REPORTING}")');
    const set = deploy.indexOf('EXPECT_ERROR_REPORTING="off"; [[ "${SENTRY_ENABLED}" == "true" ]] && EXPECT_ERROR_REPORTING="on"');
    expect(set).toBeGreaterThan(-1);
    expect(set).toBeLessThan(deploy.lastIndexOf('\nsmoke_release'));
  });

  it('hands pre-roll and post-roll the DSN and release, so their crashes are reported', () => {
    for (const step of ['pre-roll', 'post-roll']) {
      const line = deploy.split('\n').find((l) => l.includes(`npm run --silent ${step}`)) ?? '';
      expect(line, step).toMatch(/\$\{SCRIPT_SENTRY_ENV\[@\]\}/);
    }
  });
});


/** MUT-359 (D22): guard_mailer_release keeps a checkout without mailer = "resend" from switching mail off. */
type MailerOpts = { mailer?: string; consoleFails?: boolean; env?: string; skip?: string };

function mailerGuard(o: MailerOpts) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'terraform'), [
    '#!/bin/bash',
    `echo "terraform $*" >> "${log}"`,
    `case "$1" in console) cat >/dev/null; ${o.consoleFails ? 'echo "Error: boom" >&2; exit 1' : `printf '"%s"\\n' '${o.mailer ?? 'noop'}'`} ;; esac`,
    'exit 0',
  ].join('\n') + '\n');
  const env = o.env ?? 'PORT;DATABASE_URL;MAILER';
  writeFileSync(join(bin, 'gcloud'), [
    '#!/bin/bash',
    `echo "gcloud $*" >> "${log}"`,
    'case "$*" in',
    `  *"run services describe"*"env[].name"*) ${env === 'missing' ? 'echo "ERROR: Cannot find service [mutaba3a-api]" >&2; exit 1' : env === 'error' ? 'echo "ERROR: PERMISSION_DENIED" >&2; exit 1' : `echo '${env}'`} ;;`,
    '  *) echo "unexpected gcloud call: $*" >&2; exit 98 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_mailer_release "" mutaba3a-api me-west1 demo-project -input=false -var-file=production.tfvars -var image_tag=abc && echo PASSED`;
  const e: NodeJS.ProcessEnv = { ...process.env, SKIP_MAILER_GUARD: o.skip, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env: e });
  return { status: r.status, out: r.stdout, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('guard_mailer_release (MUT-359, deploy.sh steps 0, 3 and 4)', { timeout: 30_000 }, () => {
  it('lets mailer = "resend" through without asking the service', () => {
    const r = mailerGuard({ mailer: 'resend', env: 'PORT;RESEND_API_KEY' });
    expect(r.status).toBe(0);
    expect(r.calls).not.toMatch(/gcloud/);
  });

  it('lets noop through while production sends nothing, and on a first deploy', () => {
    expect(mailerGuard({ mailer: 'noop' }).out).toMatch(/PASSED/);
    expect(mailerGuard({ mailer: 'noop', env: 'missing' }).status).toBe(0);
  });

  it('refuses noop (or unset) while the service mounts RESEND_API_KEY', () => {
    const r = mailerGuard({ mailer: 'noop', env: 'PORT;MAILER;RESEND_API_KEY;RESEND_WEBHOOK_SECRET' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/mailer is noop \(or unset\), but mutaba3a-api mounts RESEND_API_KEY/);
  });

  it('refuses rather than guess when it cannot read the service or the variable', () => {
    expect(mailerGuard({ mailer: 'noop', env: 'error' }).err).toMatch(/could not read mutaba3a-api's env/);
    expect(mailerGuard({ consoleFails: true }).err).toMatch(/could not evaluate mailer/);
    expect(mailerGuard({ mailer: 'maybe' }).err).toMatch(/gave 'maybe' for mailer/);
  });

  it('SKIP_MAILER_GUARD=1 skips the check', () => {
    const r = mailerGuard({ mailer: 'noop', env: 'PORT;RESEND_API_KEY', skip: '1' });
    expect(r.status).toBe(0);
    expect(r.err).toMatch(/mail release guard skipped \(SKIP_MAILER_GUARD=1\)/);
    expect(r.calls).not.toMatch(/gcloud/);
  });
});

describe('deploy.sh wires the mail guard (MUT-359)', () => {
  const deploy = readFileSync(DEPLOY, 'utf-8');
  it('runs guard_mailer_release before bootstrap, and guard_release() runs it too', () => {
    expect(deploy.indexOf('guard_mailer_release "')).toBeGreaterThan(-1);
    expect(deploy.indexOf('guard_mailer_release "')).toBeLessThan(deploy.indexOf('ensure_bootstrap "'));
    const wrapper = /guard_release\(\)\s*\{[\s\S]*?\n\}/.exec(deploy)?.[0] ?? '';
    expect(wrapper).toMatch(/guard_mailer_release/);
  });
});

/** MUT-368 (D6): once the server mails links, the portal it ships must carry a real Turnstile site key. */
function siteKeyGuard(o: { mailer?: string; consoleFails?: boolean; key?: string | undefined }) {
  const bin = join(dir, 'bin');
  spawnSync('mkdir', ['-p', bin]);
  writeFileSync(join(bin, 'terraform'), [
    '#!/bin/bash',
    `case "$1" in console) cat >/dev/null; ${o.consoleFails ? 'echo "Error: boom" >&2; exit 1' : `printf '"%s"\\n' '${o.mailer ?? 'noop'}'`} ;; esac`,
    'exit 0',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_turnstile_site_key -input=false -var-file=production.tfvars -var image_tag=abc && echo PASSED`;
  const e: NodeJS.ProcessEnv = { ...process.env, MUTABA3A_TURNSTILE_SITE_KEY: o.key, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env: e });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

describe('guard_turnstile_site_key (MUT-368 D6, deploy.sh step 0)', { timeout: 30_000 }, () => {
  it('lets any key (or none) through while the server mails nothing: the portal offers no door then', () => {
    expect(siteKeyGuard({ mailer: 'noop' }).out).toMatch(/PASSED/);
    expect(siteKeyGuard({ mailer: 'noop', key: '1x00000000000000000000AA' }).out).toMatch(/PASSED/);
  });

  it('takes a real site key once mailer = "resend"', () => {
    expect(siteKeyGuard({ mailer: 'resend', key: '0x4AAAAAAAB1cDeFgHiJkLmN' }).out).toMatch(/PASSED/);
  });

  it.each([undefined, '', '1x00000000000000000000AA', '2x00000000000000000000AB', '3x00000000000000000000FF'])(
    'refuses %j once mailer = "resend": signup and recovery would fail every check',
    (key) => {
      const r = siteKeyGuard({ mailer: 'resend', key });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/MUTABA3A_TURNSTILE_SITE_KEY/);
    },
  );

  it('refuses rather than guess when it cannot read mailer', () => {
    expect(siteKeyGuard({ consoleFails: true }).err).toMatch(/could not evaluate mailer/);
    expect(siteKeyGuard({ mailer: 'maybe' }).err).toMatch(/gave 'maybe' for mailer/);
  });
});

describe('deploy.sh wires the site-key guard (MUT-368)', () => {
  it('runs guard_turnstile_site_key before the bootstrap and the portal build', () => {
    const deploy = readFileSync(DEPLOY, 'utf-8');
    const at = deploy.indexOf('guard_turnstile_site_key "');
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(deploy.indexOf('ensure_bootstrap "'));
    expect(at).toBeLessThan(deploy.indexOf('npm run --silent build:hosted'));
  });
});

/**
 * MUT-471: guard_min_build_release keeps a checkout's git-ignored production.tfvars from silently changing the phone
 * minimum builds production serves (MUT-293 / MUT-457). Any difference between what the checkout would send
 * (local.min_build_env) and what the service has is refused unless ALLOW_MIN_BUILD_CHANGE names it: a stale copy can
 * drop a floor, re-raise a bad one after an incident, or switch the kill switch off or on.
 */
const MIN_BUILD_NAMES = ['IOS_MIN_BUILD', 'ANDROID_MIN_BUILD', 'IOS_RECOMMENDED_BUILD', 'ANDROID_RECOMMENDED_BUILD', 'MIN_BUILD_CHECK_DISABLED'] as const;
type MinBuildValues = Partial<Record<(typeof MIN_BUILD_NAMES)[number], string>>;
type MinBuildOpts = {
  plan?: MinBuildValues; // what local.min_build_env holds in this checkout (absent = not sent)
  planWords?: string; // raw console answer instead of plan
  consoleFails?: boolean;
  live?: MinBuildValues | 'missing' | 'error'; // the service template's env
  liveExtra?: object[]; // more env entries on the service
  allow?: string; // ALLOW_MIN_BUILD_CHANGE
  skip?: string; // SKIP_MIN_BUILD_GUARD
};

function minBuildGuard(o: MinBuildOpts) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'calls.log');
  spawnSync('mkdir', ['-p', bin]);
  const words = o.planWords ?? MIN_BUILD_NAMES.map((n) => o.plan?.[n] ?? 'unset').join(' ');
  // Like Terraform 1.15's console: several lines on stdin answer only the last one.
  writeFileSync(join(bin, 'terraform'), [
    '#!/bin/bash',
    `echo "terraform $*" >> "${log}"`,
    'case "$1" in console)',
    '  last=""; while IFS= read -r line || [[ -n "$line" ]]; do [[ -n "$line" ]] && last="$line"; done',
    `  echo "console> $last" >> "${log}"`,
    `  ${o.consoleFails ? 'echo "Error: boom" >&2; exit 1' : `if [[ "$last" == *local.min_build_env* ]]; then printf '"%s"\\n' '${words}'; else echo '"something else"'; fi`} ;;`,
    'esac',
    'exit 0',
  ].join('\n') + '\n');
  const live = o.live ?? {};
  const env = typeof live === 'string' ? [] : [
    { name: 'PORT', value: '8080' },
    { name: 'DATABASE_URL', valueSource: { secretKeyRef: { secret: 'db', version: 'latest' } } },
    ...Object.entries(live).map(([name, value]) => ({ name, value })),
    ...(o.liveExtra ?? []),
  ];
  const service = JSON.stringify({ spec: { template: { spec: { containers: [{ image: 'x', env }] } } } });
  writeFileSync(join(dir, 'service.json'), service);
  writeFileSync(join(bin, 'gcloud'), [
    '#!/bin/bash',
    `echo "gcloud $*" >> "${log}"`,
    'case "$*" in',
    `  *"run services describe"*"--format=json"*) ${live === 'missing' ? 'echo "ERROR: (gcloud.run.services.describe) Cannot find service [mutaba3a-api]" >&2; exit 1' : live === 'error' ? 'echo "ERROR: (gcloud.run.services.describe) There was a problem refreshing your current auth tokens" >&2; exit 1' : `cat "${join(dir, 'service.json')}"`} ;;`,
    '  *) echo "unexpected gcloud call: $*" >&2; exit 98 ;;',
    'esac',
  ].join('\n') + '\n');
  chmodSync(join(bin, 'terraform'), 0o755);
  chmodSync(join(bin, 'gcloud'), 0o755);
  const cmd = `die() { echo "$*" >&2; exit 1; }; warn() { echo "$*" >&2; }; source "${LIB}" && guard_min_build_release "" mutaba3a-api me-west1 demo-project -input=false -var-file=production.tfvars -var image_tag=abc && echo PASSED`;
  const e: NodeJS.ProcessEnv = { ...process.env, ALLOW_MIN_BUILD_CHANGE: o.allow, SKIP_MIN_BUILD_GUARD: o.skip, PATH: `${bin}:${process.env.PATH}` };
  for (const [k, v] of Object.entries(e)) if (v === undefined) delete e[k];
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env: e });
  return { status: r.status, out: r.stdout, err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('guard_min_build_release (MUT-471, deploy.sh steps 0, 3 and 4)', { timeout: 30_000 }, () => {
  it('lets a release through when the checkout sends what production has', () => {
    expect(minBuildGuard({}).out).toMatch(/PASSED/);
    const same = { ANDROID_MIN_BUILD: '12', ANDROID_RECOMMENDED_BUILD: '13', MIN_BUILD_CHECK_DISABLED: 'true' };
    const r = minBuildGuard({ plan: same, live: same });
    expect(r.out).toMatch(/PASSED/);
    expect(r.err).toBe('');
  });

  it.each([
    ['drops a floor', { live: { IOS_MIN_BUILD: '8' }, plan: {} }, 'IOS_MIN_BUILD', 'ios_min_build', '8', 'unset'],
    ['lowers a floor', { live: { ANDROID_MIN_BUILD: '12' }, plan: { ANDROID_MIN_BUILD: '11' } }, 'ANDROID_MIN_BUILD', 'android_min_build', '12', '11'],
    ['raises a floor (a stale copy re-raising a bad one)', { live: { ANDROID_MIN_BUILD: '10' }, plan: { ANDROID_MIN_BUILD: '12' } }, 'ANDROID_MIN_BUILD', 'android_min_build', '10', '12'],
    ['adds a floor production lacks', { live: {}, plan: { IOS_MIN_BUILD: '8' } }, 'IOS_MIN_BUILD', 'ios_min_build', 'unset', '8'],
    ['drops a recommended build', { live: { ANDROID_MIN_BUILD: '12', ANDROID_RECOMMENDED_BUILD: '13' }, plan: { ANDROID_MIN_BUILD: '12' } }, 'ANDROID_RECOMMENDED_BUILD', 'android_recommended_build', '13', 'unset'],
    ['drops the kill switch', { live: { IOS_MIN_BUILD: '9', MIN_BUILD_CHECK_DISABLED: 'true' }, plan: { IOS_MIN_BUILD: '9' } }, 'MIN_BUILD_CHECK_DISABLED', 'min_build_check_disabled', 'true', 'unset'],
    ['turns the kill switch on', { live: {}, plan: { MIN_BUILD_CHECK_DISABLED: 'true' } }, 'MIN_BUILD_CHECK_DISABLED', 'min_build_check_disabled', 'unset', 'true'],
  ] as const)('refuses a release that %s unless it is named, and names the variable', (_what, values, name, tfvar, from, to) => {
    const r = minBuildGuard(values);
    expect(r.status).not.toBe(0);
    expect(r.err).toContain(`${name}: production has ${from}, this checkout would set ${to} (${tfvar})`);
    expect(r.err).toContain(`ALLOW_MIN_BUILD_CHANGE=${name}`);
    const named = minBuildGuard({ ...values, allow: name });
    expect(named.out).toMatch(/PASSED/);
    expect(named.err).toContain(`${name}: production has ${from}, this checkout would set ${to}`);
  });

  it('counts a live MIN_BUILD_CHECK_DISABLED="false" as a value the release would remove', () => {
    const r = minBuildGuard({ live: { MIN_BUILD_CHECK_DISABLED: 'false' } });
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('MIN_BUILD_CHECK_DISABLED: production has false, this checkout would set unset');
  });

  it('lists every change and prints the whole override when only some are named', () => {
    const r = minBuildGuard({ live: { IOS_MIN_BUILD: '8', MIN_BUILD_CHECK_DISABLED: 'true' }, plan: {}, allow: 'MIN_BUILD_CHECK_DISABLED' });
    expect(r.status).not.toBe(0);
    expect(r.err).toContain('IOS_MIN_BUILD: production has 8');
    expect(r.err).toContain('MIN_BUILD_CHECK_DISABLED: production has true');
    expect(r.err).toContain('ALLOW_MIN_BUILD_CHANGE=IOS_MIN_BUILD,MIN_BUILD_CHECK_DISABLED');
  });

  it('removing a floor with its recommended build needs both names (the precondition removes them together)', () => {
    const values = { live: { ANDROID_MIN_BUILD: '12', ANDROID_RECOMMENDED_BUILD: '13' }, plan: {} };
    expect(minBuildGuard({ ...values, allow: 'ANDROID_MIN_BUILD' }).status).not.toBe(0);
    expect(minBuildGuard({ ...values, allow: 'ANDROID_MIN_BUILD,ANDROID_RECOMMENDED_BUILD' }).out).toMatch(/PASSED/);
    expect(minBuildGuard({ ...values, allow: 'ANDROID_MIN_BUILD ANDROID_RECOMMENDED_BUILD' }).out).toMatch(/PASSED/);
  });

  it('refuses a name that is not one of the five, so a typo never passes', () => {
    const r = minBuildGuard({ live: { IOS_MIN_BUILD: '8' }, plan: {}, allow: 'IOS_MIN_BUILD,IOS_MINBUILD' });
    expect(r.status).not.toBe(0);
    expect(r.err).toMatch(/ALLOW_MIN_BUILD_CHANGE names 'IOS_MINBUILD'/);
  });

  it('warns about a named value this release does not change', () => {
    const r = minBuildGuard({ allow: 'IOS_MIN_BUILD' });
    expect(r.out).toMatch(/PASSED/);
    expect(r.err).toMatch(/ALLOW_MIN_BUILD_CHANGE names IOS_MIN_BUILD, which this release doesn't change/);
  });

  it('reads local.min_build_env with one expression and the release\'s own var files', () => {
    const r = minBuildGuard({});
    expect(r.calls).toMatch(/terraform console -var-file=production.tfvars -var image_tag=abc/);
    expect(r.calls).toMatch(/console> .*local\.min_build_env/);
  });

  it('lets a first deploy through: no service yet, nothing to change', () => {
    expect(minBuildGuard({ live: 'missing', plan: { IOS_MIN_BUILD: '8' } }).out).toMatch(/PASSED/);
  });

  it('refuses rather than guess when it cannot read either side', () => {
    expect(minBuildGuard({ live: 'error' }).err).toMatch(/could not read mutaba3a-api's env/);
    expect(minBuildGuard({ consoleFails: true }).err).toMatch(/could not evaluate local\.min_build_env/);
    expect(minBuildGuard({ planWords: 'unset unset unset unset' }).err).toMatch(/terraform console gave 'unset unset unset unset'/);
    expect(minBuildGuard({ planWords: 'tonumber(null) unset unset unset unset' }).err).toMatch(/terraform console gave/);
    expect(minBuildGuard({ planWords: '8 unset unset unset false' }).err).toMatch(/terraform console gave/);
    expect(minBuildGuard({ live: { IOS_MIN_BUILD: 'eight' } }).err).toMatch(/could not read mutaba3a-api's IOS_MIN_BUILD/);
    expect(minBuildGuard({ live: {}, liveExtra: [{ name: 'IOS_MIN_BUILD', valueSource: { secretKeyRef: { secret: 's' } } }] }).err)
      .toMatch(/could not read mutaba3a-api's IOS_MIN_BUILD/);
  });

  it('SKIP_MIN_BUILD_GUARD=1 skips it for a broken read: says so, and touches neither terraform nor gcloud', () => {
    const r = minBuildGuard({ live: { IOS_MIN_BUILD: '8' }, plan: {}, skip: '1' });
    expect(r.out).toMatch(/PASSED/);
    expect(r.err).toMatch(/min-build release guard skipped \(SKIP_MIN_BUILD_GUARD=1\)/);
    expect(r.calls).toBe('');
  });
});

describe('deploy.sh wires the min-build guard (MUT-471)', () => {
  const deploy = readFileSync(DEPLOY, 'utf-8');
  it('runs guard_min_build_release before bootstrap, and guard_release() runs it too', () => {
    expect(deploy.indexOf('guard_min_build_release "')).toBeGreaterThan(-1);
    expect(deploy.indexOf('guard_min_build_release "')).toBeLessThan(deploy.indexOf('ensure_bootstrap "'));
    const wrapper = /guard_release\(\)\s*\{[\s\S]*?\n\}/.exec(deploy)?.[0] ?? '';
    expect(wrapper).toMatch(/guard_min_build_release/);
  });
});
