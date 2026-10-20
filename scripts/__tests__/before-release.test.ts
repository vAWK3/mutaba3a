import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * TD-190 follow-up: operator steps still owed before a release (an infra change to approve, a
 * tfvars value to set) are listed in docs/operations/before-release.md, and `make release`
 * prints the open items for its target before it asks to deploy. A reminder, never a gate.
 */

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts/before-release.sh');
const dirs: string[] = [];

function run(target: string, file?: string) {
  const env = { ...process.env, ...(file ? { BEFORE_RELEASE_FILE: file } : {}) };
  return spawnSync('bash', [SCRIPT, target], { env, encoding: 'utf8' });
}

function list(text: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'before-release-'));
  dirs.push(dir);
  const file = join(dir, 'before-release.md');
  writeFileSync(file, text);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('scripts/before-release.sh', () => {
  it("prints only the target's items, and counts them", () => {
    const file = list('# x\n\n## server\n\n- apply the bucket\n- set alert_email\n\n## web\n\n- web only\n');
    const out = run('server', file);
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('2 open operator step(s)');
    expect(out.stdout).toContain('apply the bucket');
    expect(out.stdout).toContain('set alert_email');
    expect(out.stdout).not.toContain('web only');
  });

  it('prints nothing for a target with no items, or no section', () => {
    const file = list('## server\n\n- something\n\n## web\n\nNothing owed.\n');
    for (const target of ['web', 'desktop']) {
      const out = run(target, file);
      expect(out.status).toBe(0);
      expect(out.stdout).toBe('');
    }
  });

  it('never blocks a release, even without the file', () => {
    const out = run('server', join(tmpdir(), 'no-such-before-release.md'));
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('');
  });

  it('runs in both release targets, before the deploy confirmation', () => {
    const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf8');
    for (const target of ['web', 'server']) {
      const reminder = makefile.indexOf(`scripts/before-release.sh ${target};`);
      expect(reminder).toBeGreaterThan(-1);
      expect(makefile.indexOf('scripts/confirm.sh', reminder)).toBeGreaterThan(reminder);
    }
  });

});
