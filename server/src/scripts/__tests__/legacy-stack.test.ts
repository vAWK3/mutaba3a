import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * lib/legacy-stack.sh (MUT-487, ADR-232): until the cutover, config/gcp.json says `"cutover": "pending"` and every
 * server release acts on MTB3A's old project (LEGACY_STACK=1) without the operator remembering to say so. The old
 * stack's legacy.tfvars is made from production.tfvars the first time, but only while production.tfvars still names
 * the old project; after C1 moved production.tfvars to the new one, a missing legacy.tfvars is an error.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/legacy-stack.sh');
const DEPLOY = resolve(process.cwd(), 'scripts/deploy.sh');
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legacy-stack-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function gcpConfig(production: Record<string, string>) {
  const file = join(dir, 'gcp.json');
  writeFileSync(file, JSON.stringify({ production }));
  return file;
}

function run(script: string) {
  return spawnSync('bash', ['-c', `die() { echo "DIE: $*" >&2; exit 1; }; info() { echo "INFO: $*"; }; source "${LIB}"; ${script}`], {
    encoding: 'utf8',
  });
}

describe('cutover_pending', () => {
  it('is true while config/gcp.json says the cutover is pending', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    expect(run(`cutover_pending "${cfg}" production && echo yes || echo no`).stdout.trim()).toBe('yes');
  });

  it('is false once the cutover is done', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'done' });
    expect(run(`cutover_pending "${cfg}" production && echo yes || echo no`).stdout.trim()).toBe('no');
  });

  it('is false when the key, the environment or the file is missing', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production' });
    expect(run(`cutover_pending "${cfg}" production && echo yes || echo no`).stdout.trim()).toBe('no');
    expect(run(`cutover_pending "${cfg}" staging && echo yes || echo no`).stdout.trim()).toBe('no');
    expect(run(`cutover_pending "${join(dir, 'nope.json')}" production && echo yes || echo no`).stdout.trim()).toBe('no');
  });
});

describe('default_legacy_stack', () => {
  it('prints 1 while the cutover is pending and 0 after', () => {
    const pending = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    expect(run(`default_legacy_stack "${pending}" production`).stdout.trim()).toBe('1');
    const done = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'done' });
    expect(run(`default_legacy_stack "${done}" production`).stdout.trim()).toBe('0');
  });
});

describe('ensure_legacy_tfvars', () => {
  const production = ['project_id          = "malafat-production"', 'db_tier             = "db-g1-small"', 'stripe_enabled      = true', ''].join('\n');

  it('makes legacy.tfvars from production.tfvars with legacy_stack = true, readable by the owner only', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    writeFileSync(join(dir, 'production.tfvars'), production);
    const out = run(`ensure_legacy_tfvars "${dir}" production "${cfg}"`);
    expect(out.status).toBe(0);
    const made = readFileSync(join(dir, 'legacy.tfvars'), 'utf8');
    expect(made).toContain('project_id          = "malafat-production"');
    expect(made).toContain('stripe_enabled      = true');
    expect(made).toMatch(/^legacy_stack = true$/m);
    expect(statSync(join(dir, 'legacy.tfvars')).mode & 0o077).toBe(0);
    expect(out.stdout).toContain('legacy.tfvars');
  });

  it('replaces a legacy_stack line production.tfvars already carries instead of setting it twice', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    writeFileSync(join(dir, 'production.tfvars'), `${production}legacy_stack = false\n`);
    expect(run(`ensure_legacy_tfvars "${dir}" production "${cfg}"`).status).toBe(0);
    const made = readFileSync(join(dir, 'legacy.tfvars'), 'utf8');
    expect(made.match(/^\s*legacy_stack\s*=/gm)).toHaveLength(1);
    expect(made).toMatch(/^legacy_stack = true$/m);
  });

  it('leaves an existing legacy.tfvars alone', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    writeFileSync(join(dir, 'production.tfvars'), production);
    writeFileSync(join(dir, 'legacy.tfvars'), 'project_id = "malafat-production"\nlegacy_forwarder = true\n');
    expect(run(`ensure_legacy_tfvars "${dir}" production "${cfg}"`).status).toBe(0);
    expect(readFileSync(join(dir, 'legacy.tfvars'), 'utf8')).toBe('project_id = "malafat-production"\nlegacy_forwarder = true\n');
  });

  it('refuses when production.tfvars already names the new project (C1 moved it): legacy.tfvars must be made by hand', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    writeFileSync(join(dir, 'production.tfvars'), 'project_id = "mtb3a-production"\n');
    const out = run(`ensure_legacy_tfvars "${dir}" production "${cfg}"`);
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain('DIE:');
    expect(out.stderr).toContain('mtb3a-production');
    expect(existsSync(join(dir, 'legacy.tfvars'))).toBe(false);
  });

  it('refuses when production.tfvars is missing', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    const out = run(`ensure_legacy_tfvars "${dir}" production "${cfg}"`);
    expect(out.status).not.toBe(0);
    expect(existsSync(join(dir, 'legacy.tfvars'))).toBe(false);
  });
});

describe('deploy.sh', { timeout: 30_000 }, () => {
  // ROLLBACK_TO with IMAGE_TAG is refused right after the project guard, before anything is touched: a run that gets
  // that far chose its stack and passed the guard.
  function deploy(cfg: string, extra: Record<string, string>) {
    const env: Record<string, string | undefined> = { ...process.env, GCP_CONFIG: cfg, TF_STATE_BUCKET: 'b', ROLLBACK_TO: 'HEAD~1', IMAGE_TAG: 'hotfix', ...extra };
    if (!('LEGACY_STACK' in extra)) delete env.LEGACY_STACK;
    return spawnSync('bash', [DEPLOY], { encoding: 'utf-8', env });
  }

  it('acts on the old project on its own while the cutover is pending', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    const r = deploy(cfg, { GCP_PROJECT_ID: 'mtb3a-production' });
    expect(r.stderr).toContain('LEGACY_STACK=1 is for the old project malafat-production');
  });

  it('lets an explicit LEGACY_STACK=0 win while the cutover is pending', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'pending' });
    const r = deploy(cfg, { GCP_PROJECT_ID: 'mtb3a-production', LEGACY_STACK: '0' });
    expect(r.stderr).not.toContain('LEGACY_STACK=1 is for the old project');
    expect(r.stderr).toMatch(/ROLLBACK_TO and IMAGE_TAG are both set/);
  });

  it('acts on the new project once the cutover is done', () => {
    const cfg = gcpConfig({ project: 'mtb3a-production', legacyProject: 'malafat-production', cutover: 'done' });
    const r = deploy(cfg, { GCP_PROJECT_ID: 'mtb3a-production' });
    expect(r.stderr).toMatch(/ROLLBACK_TO and IMAGE_TAG are both set/);
  });
});
