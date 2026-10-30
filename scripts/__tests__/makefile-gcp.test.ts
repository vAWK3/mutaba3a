// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * MUT-523: the Makefile takes each project's region from config/gcp.json (the old stack stays in me-west1 while the
 * new one is in europe-west1), and turns deploy.env's GCP_ACCOUNT / GCP_ADC_FILE into gcloud's and the client
 * libraries' own variables for its recipes only. Read through a throwaway makefile that includes the real one.
 */
const ROOT = resolve(process.cwd());
const dir = mkdtempSync(join(tmpdir(), 'makefile-gcp-'));
const probe = join(dir, 'probe.mk');
writeFileSync(probe, `include ${join(ROOT, 'Makefile')}\nprint-%: ; @echo "[$($*)]"\n`);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function value(name: string, ...vars: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOME: '/home/op' };
  for (const key of ['GCP_REGION', 'GCP_ACCOUNT', 'GCP_ADC_FILE', 'CLOUDSDK_CORE_ACCOUNT', 'GOOGLE_APPLICATION_CREDENTIALS', 'LEGACY_STACK']) delete env[key];
  const r = spawnSync('make', ['-s', '-f', probe, `print-${name}`, ...vars], { cwd: ROOT, encoding: 'utf8', env });
  return r.stdout.trim();
}

describe('Makefile GCP settings (MUT-523)', { timeout: 30_000 }, () => {
  it('the old project gets me-west1 and the new one europe-west1, from config/gcp.json', () => {
    expect(value('GCP_REGION', 'GCP_PROJECT_ID=malafat-production')).toBe('[me-west1]');
    expect(value('GCP_REGION', 'GCP_PROJECT_ID=mtb3a-production')).toBe('[europe-west1]');
  });

  it('an explicit GCP_REGION is passed on as it is (deploy.sh refuses it if it disagrees)', () => {
    expect(value('GCP_REGION', 'GCP_PROJECT_ID=mtb3a-production', 'GCP_REGION=me-west1')).toBe('[me-west1]');
  });

  it('maps GCP_ACCOUNT and GCP_ADC_FILE (a literal ~/ expanded) to CLOUDSDK_CORE_ACCOUNT and GOOGLE_APPLICATION_CREDENTIALS', () => {
    const vars = ['GCP_ACCOUNT=ops@example.com', 'GCP_ADC_FILE=~/.config/gcloud/adc-ops.json'];
    expect(value('CLOUDSDK_CORE_ACCOUNT', ...vars)).toBe('[ops@example.com]');
    expect(value('GOOGLE_APPLICATION_CREDENTIALS', ...vars)).toBe('[/home/op/.config/gcloud/adc-ops.json]');
  });

  it('sets neither when deploy.env names no account: the machine\'s defaults, as before', () => {
    // Empty on the command line, so an operator's own deploy.env in this checkout can't change the answer.
    expect(value('CLOUDSDK_CORE_ACCOUNT', 'GCP_ACCOUNT=', 'GCP_ADC_FILE=')).toBe('[]');
    expect(value('GOOGLE_APPLICATION_CREDENTIALS', 'GCP_ACCOUNT=', 'GCP_ADC_FILE=')).toBe('[]');
  });
});
