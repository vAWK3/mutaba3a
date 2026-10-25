import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * MUT-347: deploy.sh's ROLLBACK_TO (scripts/lib/rollback.sh). Each helper is driven through fake gcloud,
 * terraform and npm on PATH, the way release-guard.test.ts drives the release guards; git is the real one
 * (its fetch is stubbed), against this clone.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/rollback.sh');
const DEPLOY = resolve(process.cwd(), 'scripts/deploy.sh');
const REPO_ROOT = resolve(process.cwd(), '..');
const git = (...args: string[]) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rollback-'));
  mkdirSync(join(dir, 'bin'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function fake(name: string, body: string) {
  const path = join(dir, 'bin', name);
  writeFileSync(path, `#!/bin/bash\necho "${name} $*" >> "${join(dir, 'calls.log')}"\n${body}\n`);
  chmodSync(path, 0o755);
}

function run(call: string, o: { input?: string; env?: Record<string, string> } = {}) {
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  fake('git', `[[ " $* " == *" fetch "* ]] && exit 1\nexec "${realGit}" "$@"`);
  const cmd = [
    'info() { echo "INFO $*" >&2; }; die() { echo "DIE $*" >&2; exit 1; }; warn() { echo "WARN $*" >&2; }',
    `REPO_ROOT="${REPO_ROOT}"; SERVER_DIR="${process.cwd()}"; TF_DIR="${dir}"; ENVIRONMENT=production`,
    'SERVICE_NAME=mutaba3a-api; GCP_REGION=me-west1; GCP_PROJECT_ID=demo; LOCAL_DATABASE_URL=postgres://proxy',
    `source "${LIB}"`,
    call,
  ].join('\n');
  const env = { ...process.env, ...o.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env, input: o.input ?? '' });
  const log = join(dir, 'calls.log');
  return { status: r.status, out: r.stdout.trim(), err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

// Each case spawns bash and fake CLIs; under the full suite's parallel load one can pass 5 s.
describe('scripts/lib/rollback.sh', { timeout: 30_000 }, () => {
  describe('rollback_resolve', () => {
    it('resolves a short sha or a tag to the full commit, warning when origin can’t be fetched', () => {
      const r = run(`rollback_resolve "$(git -C "${REPO_ROOT}" rev-parse --short HEAD~1)"`);
      expect(r.status).toBe(0);
      expect(r.out).toBe(git('rev-parse', 'HEAD~1'));
      expect(r.err).toMatch(/could not fetch origin's tags/);
    });

    it('refuses a ref this clone doesn’t have', () => {
      const r = run('rollback_resolve no-such-ref-mut347');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/ROLLBACK_TO=no-such-ref-mut347 is not a commit in this clone/);
    });
  });

  describe('rollback_deployed_tag', () => {
    it('reads the live service’s SERVICE_VERSION', () => {
      fake('gcloud', `echo '{"spec":{"template":{"spec":{"containers":[{"env":[{"name":"NODE_ENV","value":"production"},{"name":"SERVICE_VERSION","value":"5119667b"}]}]}}}}'`);
      const r = run('rollback_deployed_tag');
      expect(r).toMatchObject({ status: 0, out: '5119667b' });
      expect(r.calls).toMatch(/gcloud run services describe mutaba3a-api --region=me-west1 --project=demo --format=json/);
    });

    it('refuses when the service can’t be read, or names no version', () => {
      fake('gcloud', 'echo "ERROR: auth" >&2; exit 1');
      expect(run('rollback_deployed_tag').status).not.toBe(0);
      fake('gcloud', `echo '{"spec":{"template":{"spec":{"containers":[{"env":[]}]}}}}'`);
      const r = run('rollback_deployed_tag');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/has no SERVICE_VERSION/);
    });
  });

  describe('rollback_infra_gate', () => {
    it('plans this checkout’s terraform at the deployed tag and passes when nothing would change', () => {
      fake('terraform', 'exit 0');
      const r = run('rollback_infra_gate 5119667b');
      expect(r.status).toBe(0);
      expect(r.calls).toMatch(/terraform plan -detailed-exitcode -input=false -no-color -var-file=production.tfvars -var image_tag=5119667b/);
    });

    it('refuses when the plan has changes: the rollback would ship this checkout’s infrastructure too', () => {
      fake('terraform', 'echo "  # google_cloud_run_v2_service.api will be updated in-place"; echo "Plan: 0 to add, 1 to change, 0 to destroy."; exit 2');
      const r = run('rollback_infra_gate 5119667b');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/google_cloud_run_v2_service.api will be updated/);
      expect(r.err).toMatch(/infrastructure differs from what is deployed/);
    });

    it('refuses when the plan fails, rather than guess', () => {
      fake('terraform', 'echo "Error: state lock" >&2; exit 1');
      const r = run('rollback_infra_gate 5119667b');
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/terraform plan failed/);
    });
  });

  describe('rollback_migration_gate', () => {
    const COMMIT = 'abc1234def5678900000000000000000000000000';

    it('passes without asking when nothing is rolled back past, through the proxy URL', () => {
      fake('npm', 'echo "DATABASE_URL=$DATABASE_URL"; exit 0');
      const r = run(`rollback_migration_gate ${COMMIT}`);
      expect(r.status).toBe(0);
      expect(r.out).toBe('DATABASE_URL=postgres://proxy');
      expect(r.calls).toContain(`run --silent rollback:check -- --commit ${COMMIT}`);
    });

    it('asks for the short sha when migrations are rolled past, and goes on only when it is typed', () => {
      fake('npm', 'exit 2');
      expect(run(`rollback_migration_gate ${COMMIT}`, { input: 'abc1234\n' }).status).toBe(0);
      const wrong = run(`rollback_migration_gate ${COMMIT}`, { input: 'yes\n' });
      expect(wrong.status).not.toBe(0);
      expect(wrong.err).toMatch(/not confirmed/);
      expect(run(`rollback_migration_gate ${COMMIT}`).status).not.toBe(0); // no answer at all
    });

    it('refuses when the gate refuses (a "Roll back past" count above 0)', () => {
      fake('npm', 'exit 1');
      const r = run(`rollback_migration_gate ${COMMIT}`, { input: 'abc1234\n' });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/migration gate refused/);
    });
  });

  describe('rollback_expects_error_reporting', () => {
    it('is true from MUT-148 on, false before it', () => {
      expect(run('rollback_expects_error_reporting HEAD').status).toBe(0);
      expect(run(`rollback_expects_error_reporting "$ROLLBACK_MUT148_COMMIT~1"`).status).not.toBe(0);
    });
  });
});

describe('deploy.sh ROLLBACK_TO', { timeout: 30_000 }, () => {
  it('refuses ROLLBACK_TO with IMAGE_TAG before touching anything (the Makefile exports IMAGE_TAG)', () => {
    const env = { ...process.env, GCP_PROJECT_ID: 'demo', TF_STATE_BUCKET: 'b', ROLLBACK_TO: 'HEAD~1', IMAGE_TAG: 'hotfix', PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
    fake('gcloud', 'exit 1');
    fake('terraform', 'exit 1');
    const r = spawnSync('bash', [DEPLOY], { encoding: 'utf-8', env });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/ROLLBACK_TO and IMAGE_TAG are both set/);
    expect(existsSync(join(dir, 'calls.log'))).toBe(false);
  });
});
