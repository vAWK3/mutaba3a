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
const NO_FILE = join(tmpdir(), 'no-such-before-release.md');
const dirs: string[] = [];

interface RunOptions {
  runbook?: string;
  today?: string;
}

function run(target: string, file?: string, { runbook = NO_FILE, today }: RunOptions = {}) {
  const env = {
    ...process.env,
    ...(file ? { BEFORE_RELEASE_FILE: file } : {}),
    RESTORE_DRILL_RUNBOOK: runbook,
    ...(today ? { BEFORE_RELEASE_TODAY: today } : {}),
  };
  return spawnSync('bash', [SCRIPT, target], { env, encoding: 'utf8' });
}

function list(text: string, name = 'before-release.md'): string {
  const dir = mkdtempSync(join(tmpdir(), 'before-release-'));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

/** A runbook whose "Drill results" section holds one block per drill date ('' = the empty template). */
function runbook(...dates: string[]): string {
  const blocks = dates.map((date) => `| | |\n|---|---|\n| Drill date (UTC) | ${date} |\n| Operator | Basel |\n`);
  return list(
    `# Runbook\n\n## 8. The restore drill\n\n| Drill date (UTC) | 2020-01-01 |\n\n` +
      `## 10. Drill results\n\n${blocks.join('\n')}\n` +
      `| Cutover date (UTC) | 2026-10-22 |\n\n` +
      `## 11. Retire a currency\n\n| Drill date (UTC) | 2099-01-01 |\n`,
    'pilot-runbook.md',
  );
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
    const out = run('server', NO_FILE);
    expect(out.status).toBe(0);
    expect(out.stdout).toBe('');
  });

  describe('restore drill age (server only)', () => {
    const NOTHING_OWED = '## server\n\n## web\n';

    it('says the drill has never run while the results table is empty', () => {
      const out = run('server', list(NOTHING_OWED), { runbook: runbook(''), today: '2026-10-23' });
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('1 open operator step(s)');
      expect(out.stdout).toContain('never been run against production');
    });

    it('stays quiet when the newest drill is 60 days old or less', () => {
      const out = run('server', list(NOTHING_OWED), { runbook: runbook('2026-08-24'), today: '2026-10-23' });
      expect(out.status).toBe(0);
      expect(out.stdout).toBe('');
    });

    it('reminds once the newest drill is more than 60 days old, naming its date', () => {
      const out = run('server', list(NOTHING_OWED), { runbook: runbook('2026-08-23'), today: '2026-10-23' });
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('2026-08-23 (61 days ago;');
    });

    it('takes the newest of several drills, whatever their order', () => {
      const out = run('server', list(NOTHING_OWED), {
        runbook: runbook('2026-01-05', '2026-10-01', '2026-03-09'),
        today: '2026-10-23',
      });
      expect(out.stdout).toBe('');
    });

    it('reads only the Drill results section, not other dates in the runbook', () => {
      const out = run('server', list(NOTHING_OWED), { runbook: runbook(''), today: '2026-10-23' });
      expect(out.stdout).toContain('never been run');
      expect(out.stdout).not.toContain('2099-01-01');
      expect(out.stdout).not.toContain('2020-01-01');
    });

    it('counts the drill with the listed steps', () => {
      const out = run('server', list('## server\n\n- apply the bucket\n'), {
        runbook: runbook('2026-01-01'),
        today: '2026-10-23',
      });
      expect(out.stdout).toContain('2 open operator step(s)');
      expect(out.stdout).toContain('apply the bucket');
      expect(out.stdout).toContain('2026-01-01');
    });

    it('is not a web release step', () => {
      const out = run('web', list(NOTHING_OWED), { runbook: runbook(''), today: '2026-10-23' });
      expect(out.stdout).toBe('');
    });

    it('never blocks: no runbook prints nothing for the drill', () => {
      const out = run('server', list(NOTHING_OWED), { today: '2026-10-23' });
      expect(out.status).toBe(0);
      expect(out.stdout).toBe('');
    });

    it("finds the real runbook's results table", () => {
      const real = readFileSync(resolve(ROOT, 'docs/operations/pilot-runbook.md'), 'utf8');
      const section = real.slice(real.search(/^## \d+\. Drill results$/m));
      expect(section).toMatch(/^\| Drill date \(UTC\) \|/m);
    });
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
