import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Release tags are release-qa's baseline: it scopes a QA run to what changed
 * since the newest `web-v*` (web app) or `api-v*` (API + hosted portal) tag.
 * Until these existed it fell back to the last desktop tag, v0.0.67, and put
 * every feature in scope. These tests pin how scripts/tag-release.sh writes
 * the tags, and that the Makefile and qa/qa.config.mjs agree on their names.
 */

// Each test spawns many real git/node subprocesses; under full-suite
// parallel load that chain can outrun the 5s default (TD-158-adjacent flake).
vi.setConfig({ testTimeout: 15_000 });

const ROOT = process.cwd();
const SCRIPT = resolve(ROOT, 'scripts/tag-release.sh');

let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
}

function commit(subject: string, date: string): string {
  writeFileSync(join(repo, 'file.txt'), subject);
  git('add', 'file.txt');
  execFileSync('git', ['commit', '-q', '-m', subject], {
    cwd: repo,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  return git('rev-parse', 'HEAD');
}

function tagRelease(...args: string[]) {
  return spawnSync('bash', [SCRIPT, ...args], { cwd: repo, encoding: 'utf-8' });
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'tag-release-'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'qa@example.test');
  git('config', 'user.name', 'QA');
  git('config', 'tag.gpgSign', 'false');
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe('tag-release.sh <app> <version>', () => {
  it('creates an annotated <app>-v<version> tag on HEAD', () => {
    const head = commit('release: web v1.2.3', '2026-10-01T10:00:00Z');

    const result = tagRelease('web', '1.2.3');

    expect(result.status).toBe(0);
    expect(git('rev-parse', 'web-v1.2.3^{commit}')).toBe(head);
    expect(git('cat-file', '-t', 'web-v1.2.3')).toBe('tag');
  });

  it('names API tags api-v<version>', () => {
    const head = commit('release: api v0.3.8', '2026-10-01T10:00:00Z');

    expect(tagRelease('api', '0.3.8').status).toBe(0);
    expect(git('rev-parse', 'api-v0.3.8^{commit}')).toBe(head);
  });

  it('is a no-op when the tag already points at HEAD', () => {
    commit('release: web v1.2.3', '2026-10-01T10:00:00Z');
    tagRelease('web', '1.2.3');

    const again = tagRelease('web', '1.2.3');

    expect(again.status).toBe(0);
    expect(git('tag', '-l', 'web-v*')).toBe('web-v1.2.3');
  });

  it('never moves a tag that already points at another commit', () => {
    const first = commit('release: web v1.2.3', '2026-10-01T10:00:00Z');
    tagRelease('web', '1.2.3');
    commit('fix: something', '2026-10-02T10:00:00Z');

    const result = tagRelease('web', '1.2.3');

    expect(result.status).toBe(0);
    expect(result.stderr).toMatch(/already points at/);
    expect(git('rev-parse', 'web-v1.2.3^{commit}')).toBe(first);
  });

  it('rejects an unknown app or a missing version', () => {
    commit('init', '2026-10-01T10:00:00Z');

    expect(tagRelease('desktop', '1.0.0').status).toBe(2);
    expect(tagRelease('web').status).toBe(2);
  });
});

describe('web tags carry the release notes (MUT-24)', () => {
  const NOTES = {
    '1.2.3': { en: ['First change', 'Second change'], ar: ['التغيير الأول', 'التغيير الثاني'] },
  };

  function commitNotes(subject: string, date: string) {
    writeFileSync(join(repo, 'release-notes.json'), JSON.stringify(NOTES));
    git('add', 'release-notes.json');
    return commit(subject, date);
  }

  const message = (tag: string) => git('tag', '-l', '--format=%(contents)', tag);

  it("writes the version's English lines under the subject", () => {
    commitNotes('release: web v1.2.3', '2026-10-01T10:00:00Z');
    expect(tagRelease('web', '1.2.3').status).toBe(0);
    expect(message('web-v1.2.3')).toBe('Release web v1.2.3\n\n- First change\n- Second change');
  });

  it('keeps the subject alone when the version has no notes, or there is no notes file', () => {
    commitNotes('release: web v1.2.4', '2026-10-01T10:00:00Z');
    tagRelease('web', '1.2.4');
    expect(message('web-v1.2.4')).toBe('Release web v1.2.4');

    rmSync(join(repo, 'release-notes.json'));
    git('add', '-A');
    commit('release: web v1.2.5', '2026-10-02T10:00:00Z');
    tagRelease('web', '1.2.5');
    expect(message('web-v1.2.5')).toBe('Release web v1.2.5');
  });

  it('reads the notes of the commit it tags, so a backfilled tag gets that release’s notes', () => {
    commitNotes('release: web v1.2.3', '2026-10-01T10:00:00Z');
    writeFileSync(join(repo, 'release-notes.json'), '{}');
    git('add', 'release-notes.json');
    commit('docs: drop notes', '2026-10-02T10:00:00Z');
    expect(tagRelease('--backfill').status).toBe(0);
    expect(message('web-v1.2.3')).toContain('- First change');
  });

  it('never puts notes on an API tag', () => {
    commitNotes('release: api v1.2.3', '2026-10-01T10:00:00Z');
    tagRelease('api', '1.2.3');
    expect(message('api-v1.2.3')).toBe('Release api v1.2.3');
  });
});

describe('tag-release.sh --backfill', () => {
  it('tags every past release commit, dated like the commit so the newest sorts first', () => {
    const web1 = commit('release: web v0.1.0', '2026-10-01T10:00:00Z');
    const api1 = commit('release: api v0.3.0', '2026-10-02T10:00:00Z');
    commit('feat: unrelated', '2026-10-03T10:00:00Z');
    const web2 = commit('release: web v0.1.1', '2026-10-04T10:00:00Z');

    const result = tagRelease('--backfill');

    expect(result.status).toBe(0);
    expect(git('rev-parse', 'web-v0.1.0^{commit}')).toBe(web1);
    expect(git('rev-parse', 'web-v0.1.1^{commit}')).toBe(web2);
    expect(git('rev-parse', 'api-v0.3.0^{commit}')).toBe(api1);
    // release-qa picks the baseline with `git tag --sort=-creatordate`
    expect(git('tag', '--sort=-creatordate', '-l', 'web-v*').split('\n')[0]).toBe('web-v0.1.1');
  });

  it('can run twice without changing anything', () => {
    commit('release: web v0.1.0', '2026-10-01T10:00:00Z');
    tagRelease('--backfill');

    const again = tagRelease('--backfill');

    expect(again.status).toBe(0);
    expect(git('tag', '-l')).toBe('web-v0.1.0');
  });
});

describe('release tags are wired end to end', () => {
  const makefile = readFileSync(resolve(ROOT, 'Makefile'), 'utf-8');
  const qaConfig = readFileSync(resolve(ROOT, 'qa/qa.config.mjs'), 'utf-8');

  function recipe(target: string): string {
    const start = makefile.indexOf(`\n${target}:`);
    if (start === -1) throw new Error(`Makefile has no ${target} target`);
    const end = makefile.indexOf('\n# ----', start);
    return makefile.slice(start, end === -1 ? undefined : end);
  }

  it('make release web tags the web release and pushes the tag', () => {
    expect(recipe('release-web')).toMatch(/scripts\/tag-release\.sh web "\$\$version" --push/);
  });

  it('make release web refuses a version without release notes, after the bump and before the build (MUT-24)', () => {
    const body = recipe('release-web');
    expect(body).toMatch(/npm run --silent release:notes -- "\$\$version"/);
    expect(body.indexOf('release:notes')).toBeGreaterThan(body.indexOf('scripts/bump-version.sh web'));
    expect(body.indexOf('release:notes')).toBeLessThan(body.indexOf('test:bundles'));
  });

  it('make release server tags the API release after deploy.sh succeeds', () => {
    const body = recipe('release-server');
    expect(body).toMatch(/scripts\/tag-release\.sh api "\$\$version" --push/);
    expect(body.indexOf('tag-release.sh')).toBeGreaterThan(body.indexOf('./scripts/deploy.sh'));
  });

  it('release-qa reads the web app from web-v* and the portal from api-v*', () => {
    expect(qaConfig).toMatch(/web: \{[\s\S]*?release: \{ strategy: 'tag', pattern: 'web-v\*'/);
    expect(qaConfig).toMatch(/portal: \{[\s\S]*?release: \{ strategy: 'tag', pattern: 'api-v\*'/);
  });
});
