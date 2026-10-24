// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * MUT-291 §3.2: the free web app opens the new address in a popup that answers
 * through window.opener. `Cross-Origin-Opener-Policy: same-origin` on Netlify
 * would null it and send every carry-over to the file fallback, so no header
 * rule may set it, in netlify.toml or a `_headers` file.
 */
const ROOT = resolve(__dirname, '..', '..');

describe('Netlify sends no Cross-Origin-Opener-Policy', () => {
  it.each(['netlify.toml', 'public/_headers'])('%s sets none', (file) => {
    const path = resolve(ROOT, file);
    if (!existsSync(path)) return;
    expect(readFileSync(path, 'utf8')).not.toMatch(/cross-origin-opener-policy/i);
  });
});
