// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * MUT-558: `make release server` runs the MUT-565 read-only Stripe product-tier check before it asks to deploy,
 * with the API's own key read from Secret Manager (or STRIPE_SECRET_KEY). gcloud and npm are stubs here: nothing
 * reaches Google or Stripe.
 */
const ROOT = resolve(process.cwd());
const SCRIPT = resolve(ROOT, 'scripts/stripe-product-tiers-check.sh');
const dir = mkdtempSync(join(tmpdir(), 'product-tiers-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const LIVE = 'rk_live_FAKEFAKEFAKE';
const TEST = 'rk_test_FAKEFAKEFAKE';

function stub(name: string, body: string): string {
  const file = join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

/** gcloud prints `secret` (or fails when null) and logs its argv; npm logs its argv and env key, then exits `npmExit`. */
function run({ secret = LIVE as string | null, npmExit = 0, env = {} as Record<string, string> } = {}) {
  const log = join(dir, `log-${Math.random().toString(36).slice(2)}`);
  writeFileSync(log, '');
  const gcloud = stub('gcloud', secret === null ? `echo "gcloud $*" >> '${log}'; exit 1` : `echo "gcloud $*" >> '${log}'; printf '%s' '${secret}'`);
  const npm = stub('npm', `echo "npm $* key=$STRIPE_SECRET_KEY" >> '${log}'; exit ${npmExit}`);
  const base: NodeJS.ProcessEnv = { ...process.env, GCLOUD: gcloud, NPM: npm, GCP_PROJECT_ID: 'mtb3a-production', ENVIRONMENT: 'production' };
  for (const key of ['STRIPE_SECRET_KEY', 'SKIP_PRODUCT_TIERS', 'CLOUDSDK_CORE_ACCOUNT']) delete base[key];
  const r = spawnSync('bash', [SCRIPT], { env: { ...base, ...env }, encoding: 'utf8' });
  return { ...r, calls: readFileSync(log, 'utf8') };
}

describe('scripts/stripe-product-tiers-check.sh (MUT-558)', () => {
  it("reads the API's live key from Secret Manager and passes it to the check through the environment only", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.calls).toContain('gcloud secrets versions access latest --secret=mutaba3a-api-stripe-secret-key --project=mtb3a-production');
    expect(r.calls).toMatch(/npm --prefix \S+\/server run --silent billing:product-tiers key=rk_live_FAKEFAKEFAKE/);
    expect(r.stdout + r.stderr).not.toContain(LIVE);
  });

  it('stops the release when the check finds an untagged product', () => {
    const r = run({ npmExit: 1 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Nothing was committed, pushed or deployed');
    expect(r.stderr).toContain('SKIP_PRODUCT_TIERS=1');
  });

  it('fails closed when the key cannot be read', () => {
    const r = run({ secret: null });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('could not read mutaba3a-api-stripe-secret-key in mtb3a-production');
    expect(r.calls).not.toContain('npm');
  });

  it('refuses a test-mode key for a production release', () => {
    const r = run({ secret: TEST });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('test-mode key');
    expect(r.calls).not.toContain('npm');
  });

  it('a non-production environment reads its own suffixed secret and may use a test key', () => {
    const r = run({ secret: TEST, env: { ENVIRONMENT: 'staging' } });
    expect(r.status).toBe(0);
    expect(r.calls).toContain('--secret=mutaba3a-api-stripe-secret-key-staging');
  });

  it('uses STRIPE_SECRET_KEY from the shell without asking Secret Manager', () => {
    const r = run({ env: { STRIPE_SECRET_KEY: LIVE } });
    expect(r.status).toBe(0);
    expect(r.calls).not.toContain('gcloud');
    expect(r.stdout).toContain('key from STRIPE_SECRET_KEY');
  });

  it('SKIP_PRODUCT_TIERS=1 skips it with a warning and touches nothing', () => {
    const r = run({ env: { SKIP_PRODUCT_TIERS: '1' } });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('skipped (SKIP_PRODUCT_TIERS=1)');
    expect(r.calls).toBe('');
  });

  it('runs in make release server before the deploy confirmation, and stops the release when it fails', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8');
    const recipe = makefile.slice(makefile.indexOf('release-server: preflight-server'));
    const check = recipe.indexOf('if ! scripts/stripe-product-tiers-check.sh; then');
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(recipe.indexOf("scripts/confirm.sh 'Deploy to Cloud Run now?'"));
    expect(recipe.slice(check, recipe.indexOf('token=', check))).toContain('  exit 1; \\\n\tfi; \\');
  });
});
