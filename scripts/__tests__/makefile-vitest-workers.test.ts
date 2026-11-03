// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The release and check gates run vitest with at most 3 workers unless someone asks for more: uncapped on a shared
 * Mac, the short test timeouts failed two api-v0.15.0 gate runs. Read what a recipe's shell sees, through a
 * throwaway makefile that includes the real one.
 */
const ROOT = resolve(process.cwd());
const dir = mkdtempSync(join(tmpdir(), 'makefile-vitest-'));
const probe = join(dir, 'probe.mk');
writeFileSync(probe, `include ${join(ROOT, 'Makefile')}\nrecipe-env: ; @echo "[$$VITEST_MAX_WORKERS]"\n`);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function recipeWorkers(fromEnv: string | undefined, ...vars: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.VITEST_MAX_WORKERS;
  if (fromEnv !== undefined) env.VITEST_MAX_WORKERS = fromEnv;
  const r = spawnSync('make', ['-s', '-f', probe, 'recipe-env', ...vars], { cwd: ROOT, encoding: 'utf8', env });
  return r.stdout.trim();
}

describe('Makefile vitest worker cap', { timeout: 30_000 }, () => {
  it('recipes run vitest with 3 workers by default', () => {
    expect(recipeWorkers(undefined)).toBe('[3]');
  });

  it('a VITEST_MAX_WORKERS in the environment wins', () => {
    expect(recipeWorkers('6')).toBe('[6]');
  });

  it('a VITEST_MAX_WORKERS on the make command line wins', () => {
    expect(recipeWorkers('6', 'VITEST_MAX_WORKERS=2')).toBe('[2]');
  });
});
