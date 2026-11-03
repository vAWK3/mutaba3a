// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Web release standard WX-4 (MUT-551): the website sends the basic security headers on every page. The release
 * gate's smoke list (release/gate.config.mjs) checks them on the draft and on production too.
 */
describe('netlify.toml security headers', () => {
  const toml = readFileSync(resolve(__dirname, '..', '..', 'netlify.toml'), 'utf8');
  const block = toml.split('[[headers]]').find((b) => /for\s*=\s*"\/\*"/.test(b)) ?? '';

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ])('sets %s on every page', (name, value) => {
    expect(block).toMatch(new RegExp(`^\\s*${name}\\s*=\\s*"${value}"`, 'm'));
  });
});
