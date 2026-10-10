import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the Tauri updater configuration we compile into every desktop build.
 *
 * `plugins.updater.pubkey` is the minisign public key the installed app uses to
 * verify `latest.json` signatures. It must be the public half of the key the
 * release pipeline signs with: `~/.tauri/mutaba3a.key` on the release machine
 * and the `TAURI_SIGNING_PRIVATE_KEY` GitHub Actions secret. Both are
 * BEDF931CA1D6C777, and so is every signature published up to v0.0.63.
 *
 * On 2026-10-05 the key was changed to AB7B64537B1DE22C, whose private half
 * exists nowhere (MUT-49). Had that shipped, no later release could ever have
 * been verified by that build. This test is friction against a repeat: editing
 * the key means editing this constant too, and ADR-030 explains what a real
 * rotation requires (ship the new public key in a release signed by the old
 * key, then switch signing).
 *
 * A string compare is enough: the base64 string is the key's identity. The
 * failure message decodes the first line of each side so the fingerprints are
 * readable without a tool. Proving that the published signatures were made by
 * this key is a release-time check in shell (MUT-51), not a unit test.
 */

const CONFIG_PATH = resolve(process.cwd(), 'src-tauri/tauri.conf.json');

/**
 * The canonical updater public key: base64 of a minisign public-key file.
 * Decoded, its first line reads
 * "untrusted comment: minisign public key: BEDF931CA1D6C777".
 */
const CANONICAL_UPDATER_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJFREY5MzFDQTFENkM3NzcKUldSM3g5YWhISlBmdmcyb0dsWVRGZ0Q0bWNmTjJGZkFOQnRYZ3FIQTRNcy9XRnk3bFlPU1QxN3kK';

interface UpdaterConfig {
  plugins?: { updater?: { pubkey?: unknown } };
}

function loadConfig(): UpdaterConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as UpdaterConfig;
}

/** First line of a base64-encoded minisign file, e.g. the fingerprint comment. */
function describeKey(base64: string): string {
  try {
    return atob(base64).split('\n')[0] ?? '(empty)';
  } catch {
    return '(not valid base64)';
  }
}

describe('src-tauri/tauri.conf.json updater key', () => {
  it('compiles in the public key the release pipeline signs with (BEDF931CA1D6C777)', () => {
    const pubkey = loadConfig().plugins?.updater?.pubkey;

    expect(typeof pubkey, 'plugins.updater.pubkey must be a string').toBe('string');
    expect(
      pubkey,
      `configured key is "${describeKey(pubkey as string)}", expected "${describeKey(CANONICAL_UPDATER_PUBKEY)}". See ADR-030 before changing the updater key.`
    ).toBe(CANONICAL_UPDATER_PUBKEY);
  });

  it('names BEDF931CA1D6C777 in the canonical key fixture itself', () => {
    expect(describeKey(CANONICAL_UPDATER_PUBKEY)).toBe(
      'untrusted comment: minisign public key: BEDF931CA1D6C777'
    );
  });
});
