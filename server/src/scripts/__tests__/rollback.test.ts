import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * MUT-347: deploy.sh's ROLLBACK_TO (scripts/lib/rollback.sh). Each helper is driven through fake gcloud,
 * terraform and npm on PATH, the way release-guard.test.ts drives the release guards. git is the real one, on
 * a throwaway repo (old commit with an annotated release tag, a "MUT-148" commit, HEAD), so a shallow CI clone
 * changes nothing; its fetch is stubbed.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/rollback.sh');
const GUARDS = resolve(process.cwd(), 'scripts/lib/release-guard.sh');
const OCR = resolve(process.cwd(), 'scripts/lib/receipt-ocr.sh');
const DEPLOY = resolve(process.cwd(), 'scripts/deploy.sh');
let dir: string;
let REPO_ROOT: string;
const git = (...args: string[]) => execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim();
const commit = (message: string) => {
  writeFileSync(join(REPO_ROOT, 'file.txt'), message);
  git('add', 'file.txt');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
};
let OLD: string;
let MUT148: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rollback-'));
  mkdirSync(join(dir, 'bin'));
  REPO_ROOT = join(dir, 'repo');
  mkdirSync(REPO_ROOT);
  git('init', '-q');
  OLD = commit('old release');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.com', 'tag', '-a', 'api-v0.0.1', '-m', 'release', OLD);
  MUT148 = commit('MUT-148');
  commit('head');
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
    `source "${LIB}"; ROLLBACK_MUT148_COMMIT="${MUT148}"`,
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
    it('resolves a short sha, or an annotated release tag, to the full commit, warning when origin can’t be fetched', () => {
      const r = run(`rollback_resolve ${OLD.slice(0, 7)}`);
      expect(r.status).toBe(0);
      expect(r.out).toBe(OLD);
      expect(r.err).toMatch(/could not fetch origin's tags/);
      expect(run('rollback_resolve api-v0.0.1').out).toBe(OLD); // the commit, not the tag object
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

    it('MUT-441 (F6): plans at the receipt-ocr tag that serves too, when there is one', () => {
      fake('terraform', 'exit 0');
      const r = run('rollback_infra_gate 5119667b 0cc0cc0');
      expect(r.status).toBe(0);
      expect(r.calls).toMatch(/-var image_tag=5119667b -var ocr_image_tag=0cc0cc0/);
      const none = run('rollback_infra_gate 5119667b ""').calls.trim().split('\n');
      expect(none.at(-1)).toMatch(/-var image_tag=5119667b$/); // the log holds both runs: the second names no OCR tag
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
      expect(run(`rollback_expects_error_reporting ${MUT148}`).status).toBe(0);
      expect(run(`rollback_expects_error_reporting ${OLD}`).status).not.toBe(0);
    });
  });
});

/**
 * rollback_main end to end, with deploy.sh's own helpers (tf_init, the proxy, apply_release, smoke_release) stubbed to
 * log their calls, and the real release guards' guard_sentry_release reading a fake `terraform console`.
 */
describe('rollback_main', { timeout: 30_000 }, () => {
  const TAG = 'abc1234';
  type Ocr = { enabled: boolean; image?: boolean; serving?: string };
  function rollback(o: { sentry?: 'true' | 'false'; deployed?: () => string; gate?: number; target?: () => string; ocr?: Ocr } = {}) {
    const log = join(dir, 'calls.log');
    rmSync(log, { force: true });
    const ocr = o.ocr ?? { enabled: false };
    fake('terraform', `[[ "$1" == console ]] && { in="$(cat)"; [[ "$in" == *server_ocr_enabled* ]] && echo '"${ocr.enabled}"' || echo '"${o.sentry ?? 'true'}"'; }\nexit 0`);
    const ocrDescribe = ocr.serving
      ? `echo me-west1-docker.pkg.dev/demo/mutaba3a/receipt-ocr:${ocr.serving}; exit 0`
      : 'echo "ERROR: (gcloud.run.services.describe) Cannot find service [receipt-ocr]" >&2; exit 1';
    fake('gcloud', `[[ "$*" == *"print-access-token"* ]] && { echo tok; exit 0; }\n[[ "$*" == *"describe receipt-ocr"* ]] && { ${ocrDescribe}; }\necho '{"spec":{"template":{"spec":{"containers":[{"env":[{"name":"SERVICE_VERSION","value":"${(o.deployed ?? (() => git('rev-parse', '--short', 'HEAD')))()}"}]}]}}}}'`);
    fake('npm', `case "$*" in *receipt-ocr*) ${ocr.image === false ? 'echo "[image] no image" >&2; exit 1' : `echo ${TAG}`} ;; *release-image*) echo ${TAG} ;; *rollback:check*) exit ${o.gate ?? 0} ;; esac\nexit 0`);
    const stubs = ['tf_init', 'start_proxy', 'stop_proxy', 'guard_release']
      .map((f) => `${f}() { echo "${f}" >> "${log}"; }`)
      .join('; ');
    return run(
      [
        `source "${GUARDS}"; source "${OCR}"`,
        `need() { :; }; tf_output() { echo "x"; }; ${stubs}`,
        `apply_release() { echo "apply_release \${TF_ARGS[*]}" >> "${log}"; }`,
        `smoke_release() { echo "smoke_release EXPECT=\${EXPECT_ERROR_REPORTING}" >> "${log}"; }`,
        'SUFFIX=""; REGISTRY=me-west1-docker.pkg.dev/demo/mutaba3a; AUTO_APPROVE=0; SERVICE_URL=https://svc',
        `touch "${dir}/production.tfvars"; ROLLBACK_TO=${(o.target ?? (() => MUT148))()}`,
        'rollback_main',
      ].join('\n'),
    );
  }
  const order = (calls: string, steps: string[]) => steps.map((step) => calls.indexOf(step));

  it('runs every gate before the apply, in order, and smoke expects error reporting on when Sentry is on', () => {
    const r = rollback();
    expect(r.status, r.err).toBe(0);
    const at = order(r.calls, ['terms:check-live -- --commit', 'release-image -- rollback', 'tf_init', 'terraform plan -detailed-exitcode', 'rollback:check -- --commit', 'apply_release', 'smoke_release EXPECT=on']);
    expect(at.every((i) => i > -1), r.calls).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(r.calls).toContain(`--commit ${MUT148}`);
  });

  it('expects error reporting off when this checkout’s sentry_enabled is false', () => {
    const r = rollback({ sentry: 'false' });
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toContain('smoke_release EXPECT=off');
  });

  it('checks no error reporting for a commit from before MUT-148', () => {
    const r = rollback({ target: () => OLD });
    expect(r.status, r.err).toBe(0);
    expect(r.calls).toContain('smoke_release EXPECT=');
    expect(r.calls).not.toMatch(/smoke_release EXPECT=o/);
    expect(r.err).toMatch(/predates MUT-148/);
  });

  it('stops before the apply when the migration gate refuses, and does nothing when the image already serves', () => {
    const refused = rollback({ gate: 1 });
    expect(refused.status).not.toBe(0);
    expect(refused.calls).not.toContain('apply_release');
    const serving = rollback({ deployed: () => TAG });
    expect(serving.status).toBe(0);
    expect(serving.err).toMatch(/already serves abc1234/);
    expect(serving.calls).not.toContain('terraform plan');
    expect(serving.calls).not.toContain('apply_release');
  });

  it('only goes back: refuses a commit newer than what serves, and warns when the deployed tag isn’t in the clone', () => {
    const newer = rollback({ deployed: () => OLD.slice(0, 7), target: () => MUT148 });
    expect(newer.status).not.toBe(0);
    expect(newer.err).toMatch(/is not older than what serves/);
    expect(newer.calls).not.toContain('apply_release');
    const unknown = rollback({ deployed: () => 'f00dfee' });
    expect(unknown.status, unknown.err).toBe(0);
    expect(unknown.err).toMatch(/can't check that .* is older/);
  });

  describe('MUT-441 (F6): receipt-ocr', () => {
    it('leaves it alone while server_ocr_enabled is off', () => {
      const r = rollback();
      expect(r.status, r.err).toBe(0);
      expect(r.calls).not.toMatch(/receipt-ocr|ocr_image_tag/);
      expect(r.calls).toMatch(/apply_release -input=false -var-file=production.tfvars -var image_tag=abc1234\n/);
    });

    it('pins it to the commit’s own image, and plans the gate at the receipt-ocr tag that serves', () => {
      const r = rollback({ ocr: { enabled: true, serving: 'f00dfee' } });
      expect(r.status, r.err).toBe(0);
      expect(r.calls).toContain('release-image -- rollback --repository me-west1-docker.pkg.dev/demo/mutaba3a/receipt-ocr --commit');
      expect(r.calls).toMatch(/terraform plan .*-var image_tag=\S+ -var ocr_image_tag=f00dfee/);
      expect(r.err).toMatch(/receipt-ocr rolls back with the API, to abc1234/);
      expect(r.calls).toMatch(/apply_release .*-var image_tag=abc1234 -var ocr_image_tag=abc1234/);
      const at = order(r.calls, ['repository me-west1-docker.pkg.dev/demo/mutaba3a/receipt-ocr', 'terraform plan -detailed-exitcode', 'apply_release']);
      expect([...at].sort((a, b) => a - b)).toEqual(at);
    });

    it('keeps the running image when the commit has none (older than MUT-441, or built with the flag off)', () => {
      const r = rollback({ ocr: { enabled: true, image: false, serving: 'f00dfee' } });
      expect(r.status, r.err).toBe(0);
      expect(r.err).toMatch(/has no usable receipt-ocr image .*keeping the running f00dfee/);
      expect(r.calls).toMatch(/apply_release .*-var image_tag=abc1234 -var ocr_image_tag=f00dfee/);
    });

    it('refuses when the commit has no image and no receipt-ocr service runs', () => {
      const r = rollback({ ocr: { enabled: true, image: false } });
      expect(r.status).not.toBe(0);
      expect(r.err).toMatch(/no receipt-ocr service runs/);
      expect(r.calls).not.toContain('apply_release');
    });
  });

  it('refuses HEAD (a normal deploy) and a dirty tree', () => {
    expect(rollback({ target: () => 'HEAD' }).err).toMatch(/is HEAD: that is a normal deploy/);
    writeFileSync(join(REPO_ROOT, 'stray.txt'), 'x');
    expect(rollback().err).toMatch(/uncommitted changes/);
  });
});

describe('deploy.sh PORTAL_CONFIG', () => {
  const line = readFileSync(DEPLOY, 'utf-8').split('\n').find((l) => l.startsWith('PORTAL_CONFIG='))!;
  const hash = (env: Record<string, string>) =>
    spawnSync('bash', ['-euo', 'pipefail', '-c', `ENVIRONMENT=production; ${line}; echo "$PORTAL_CONFIG"`], { encoding: 'utf-8', env: { PATH: process.env.PATH ?? '', ...env } });

  it('hashes even with no MUTABA3A_* setting (set -e must not kill deploy.sh there), and changes when one does', () => {
    const none = hash({});
    expect(none.status).toBe(0);
    expect(none.stdout.trim()).toMatch(/^[0-9a-f]{64}$/);
    const key = hash({ MUTABA3A_TURNSTILE_SITE_KEY: 'a' });
    expect(key.stdout.trim()).not.toBe(none.stdout.trim());
    expect(hash({ MUTABA3A_TURNSTILE_SITE_KEY: 'a' }).stdout).toBe(key.stdout);
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
