// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MUT-291 (T-U14): the landing's "Open app" links point to the portal (`hostedPortalUrl()`), never to the free web
 * app at /app, which is being retired and now opens on its carry-over screen. Read from source, so a new link to
 * /app anywhere in the landing fails here before it ships.
 */
const LANDING = resolve(__dirname, '..');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('the landing never links to the old web app (MUT-291)', () => {
  it.each(sources(LANDING).map((path) => [path.slice(LANDING.length + 1), path]))('%s has no link to /app', (_name, path) => {
    const code = readFileSync(path, 'utf8');
    expect(code).not.toMatch(/(href|to)=\{?["'`]\/app(\/|["'`?#])/);
  });
});
