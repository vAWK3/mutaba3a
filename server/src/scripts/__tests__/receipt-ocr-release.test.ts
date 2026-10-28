import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * MUT-441 (F6): the receipt-ocr image in a release (scripts/lib/receipt-ocr.sh), driven through fake terraform,
 * gcloud, npm and docker on PATH the way rollback.test.ts drives rollback.sh. Its rollback half
 * (ocr_rollback_tag inside rollback_main) is covered there.
 */
const LIB = resolve(process.cwd(), 'scripts/lib/receipt-ocr.sh');
const GUARDS = resolve(process.cwd(), 'scripts/lib/release-guard.sh');
const DEPLOY = resolve(process.cwd(), 'scripts/deploy.sh');
const IMAGE = 'me-west1-docker.pkg.dev/demo/mutaba3a/receipt-ocr:abc1234';
const HEAD = 'abc1234def5678900000000000000000000000000';
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'receipt-ocr-'));
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

function run(call: string) {
  const cmd = [
    'info() { echo "INFO $*" >&2; }; die() { echo "DIE $*" >&2; exit 1; }; warn() { echo "WARN $*" >&2; }',
    `SERVER_DIR="${process.cwd()}"`,
    `source "${GUARDS}"; source "${LIB}"`,
    call,
  ].join('\n');
  const env = { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}` };
  const r = spawnSync('bash', ['-euo', 'pipefail', '-c', cmd], { cwd: dir, encoding: 'utf-8', env });
  const log = join(dir, 'calls.log');
  return { status: r.status, out: r.stdout.trim(), err: r.stderr, calls: existsSync(log) ? readFileSync(log, 'utf-8') : '' };
}

describe('scripts/lib/receipt-ocr.sh', { timeout: 30_000 }, () => {
  describe('ocr_read_enabled', () => {
    it('reads server_ocr_enabled with the apply’s own variables', () => {
      fake('terraform', `[[ "$1" == console ]] && { cat >/dev/null; echo '"true"'; }\nexit 0`);
      const r = run('ocr_read_enabled -input=false -var-file=production.tfvars -var image_tag=abc1234; echo "$OCR_ENABLED"');
      expect(r).toMatchObject({ status: 0, out: 'true' });
      expect(r.calls).toContain('terraform console -var-file=production.tfvars -var image_tag=abc1234');
    });

    it('refuses on anything but true or false, or a failed console', () => {
      fake('terraform', `cat >/dev/null; echo 'Error: nope'`);
      expect(run('ocr_read_enabled').err).toMatch(/gave 'Error: nope' for server_ocr_enabled/);
      fake('terraform', 'exit 1');
      expect(run('ocr_read_enabled').err).toMatch(/could not evaluate server_ocr_enabled/);
    });
  });

  describe('ocr_deployed_tag', () => {
    it('prints the running image’s tag, or nothing when the service doesn’t exist yet', () => {
      fake('gcloud', `echo ${IMAGE}`);
      const r = run('ocr_deployed_tag receipt-ocr me-west1 demo');
      expect(r).toMatchObject({ status: 0, out: 'abc1234' });
      expect(r.calls).toContain('gcloud run services describe receipt-ocr --region=me-west1 --project=demo');
      fake('gcloud', 'echo "ERROR: Cannot find service [receipt-ocr]" >&2; exit 1');
      expect(run('ocr_deployed_tag receipt-ocr me-west1 demo')).toMatchObject({ status: 0, out: '' });
    });

    it('refuses on any other failure, or an image with no tag', () => {
      fake('gcloud', 'echo "ERROR: auth" >&2; exit 1');
      expect(run('ocr_deployed_tag receipt-ocr me-west1 demo').err).toMatch(/could not read receipt-ocr's image/);
      fake('gcloud', 'echo me-west1-docker.pkg.dev/demo/mutaba3a/receipt-ocr@sha256');
      expect(run('ocr_deployed_tag receipt-ocr me-west1 demo').err).toMatch(/names no tag/);
    });
  });

  describe('ocr_release_image', () => {
    beforeEach(() => {
      fake('gcloud', `[[ "$*" == *print-access-token* ]] && echo tok\nexit 0`);
      fake('docker', 'exit 0');
    });

    it('builds the runtime target from server/ocr with the API image’s labels, then pushes', () => {
      fake('npm', 'echo build');
      const r = run(`ocr_release_image ${IMAGE} ${HEAD} false "${process.cwd()}"`);
      expect(r.status, r.err).toBe(0);
      const config = run('ocr_build_config').out;
      expect(config).toMatch(/^[0-9a-f]{64}$/);
      expect(r.calls).toContain(`release-image -- deploy-plan --image ${IMAGE} --head ${HEAD} --dirty 0 --config ${config}`);
      expect(r.calls).toContain(
        `docker build --platform linux/amd64 --target runtime --build-arg TESSDATA_VARIANT=fast --label org.opencontainers.image.revision=${HEAD} --label dirty=false --label portal-config=${config} -t ${IMAGE} ${process.cwd()}/ocr`,
      );
      expect(r.calls).toContain(`docker push ${IMAGE}`);
      expect(r.calls).toContain('gcloud auth configure-docker me-west1-docker.pkg.dev --quiet');
    });

    it('reuses a tag that already holds this HEAD: no build, no push', () => {
      fake('npm', 'echo reuse');
      const r = run(`ocr_release_image ${IMAGE} ${HEAD} false "${process.cwd()}"`);
      expect(r.status, r.err).toBe(0);
      expect(r.calls).not.toMatch(/docker (build|push)/);
    });

    it('refuses a tag that holds anything else, before docker', () => {
      fake('npm', 'echo "[image] taken" >&2; exit 1');
      const r = run(`ocr_release_image ${IMAGE} ${HEAD} true "${process.cwd()}"`);
      expect(r.status).not.toBe(0);
      expect(r.calls).toContain('--dirty 1');
      expect(r.calls).not.toMatch(/^docker /m);
    });
  });
});

describe('deploy.sh and receipt-ocr', () => {
  const deploy = readFileSync(DEPLOY, 'utf-8');

  it('reads the flag at step 0, passes the same tag to terraform, and builds only while it is on', () => {
    expect(deploy).toContain('source "${SERVER_DIR}/scripts/lib/receipt-ocr.sh"');
    expect(deploy).toContain('[[ "${OCR_ENABLED}" == "true" ]] && TF_ARGS+=(-var "ocr_image_tag=${SHORT_SHA}")');
    expect(deploy).toMatch(/if \[\[ "\$\{OCR_ENABLED\}" == "true" \]\]; then\n\s+ocr_release_image "\$\{OCR_IMAGE\}" "\$\{HEAD_SHA\}"/);
    expect(deploy.indexOf('ocr_read_enabled "${TF_ARGS[@]}"')).toBeLessThan(deploy.indexOf('ensure_bootstrap'));
  });
});
