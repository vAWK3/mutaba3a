import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Guards the Tauri updater configuration we compile into every desktop build.
 *
 * `plugins.updater.pubkey` is the minisign public key the installed app uses to
 * verify `latest.json` signatures. It must be the public half of the key the
 * release pipeline signs with: the active `TAURI_SIGNING_PRIVATE_KEY` in
 * `release.env` (byte-identical to `~/.tauri/mutaba3a.key`) on the release
 * machine, and the GitHub Actions secret of the same name. Both are
 * BEDF931CA1D6C777, and so is every signature published up to v0.0.63.
 *
 * On 2026-10-05 the key was changed to AB7B64537B1DE22C. Its private half
 * exists only as a commented-out entry in `release.env`; it never signed a
 * published release and is not in CI (MUT-49, ADR-031). Had that shipped, no
 * later release could ever have been verified by that build. This test is
 * friction against a repeat: editing the key means editing this constant too,
 * and ADR-031 explains what a real rotation requires (ship the new public key
 * in a release signed by the old key, then switch signing).
 *
 * The identity check is the key bytes themselves: a minisign public-key file
 * is an "untrusted comment" line followed by base64 of `Ed` + 8-byte key id
 * (little-endian) + 32-byte key. The comment line is only used for readable
 * failure messages. Proving that the published signatures were made by this
 * key is a release-time check in shell (MUT-51), not a unit test.
 */

const CONFIG_PATH = resolve(process.cwd(), 'src-tauri/tauri.conf.json');

/** Fingerprint of the canonical updater signing key, as minisign prints it. */
const CANONICAL_KEY_ID = 'BEDF931CA1D6C777';

/**
 * The canonical updater public key: base64 of a minisign public-key file.
 * Decoded, its first line reads
 * "untrusted comment: minisign public key: BEDF931CA1D6C777".
 */
const CANONICAL_UPDATER_PUBKEY =
  'dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEJFREY5MzFDQTFENkM3NzcKUldSM3g5YWhISlBmdmcyb0dsWVRGZ0Q0bWNmTjJGZkFOQnRYZ3FIQTRNcy9XRnk3bFlPU1QxN3kK';

const MINISIGN_PUBKEY_BYTES = 42; // 'Ed' (2) + key id (8) + Ed25519 key (32)

interface UpdaterConfig {
  plugins?: { updater?: { pubkey?: unknown } };
}

function loadConfig(): UpdaterConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as UpdaterConfig;
}

function decodeBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

/** The key id minisign prints, derived from the key bytes on line 2. */
function keyIdFromPubkey(base64PubkeyFile: string): string {
  const lines = atob(base64PubkeyFile).split('\n');
  const bytes = decodeBase64(lines[1] ?? '');
  expect(bytes.length, 'minisign public key payload length').toBe(MINISIGN_PUBKEY_BYTES);
  expect(String.fromCharCode(bytes[0], bytes[1]), 'minisign algorithm tag').toBe('Ed');
  return Array.from(bytes.subarray(2, 10))
    .reverse()
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

/** Human-readable description for failure messages: comment line plus key id. */
function describeKey(base64PubkeyFile: string): string {
  try {
    const comment = atob(base64PubkeyFile).split('\n')[0] ?? '(empty)';
    return `${comment} [key bytes: ${keyIdFromPubkey(base64PubkeyFile)}]`;
  } catch {
    return '(not a minisign public key)';
  }
}

describe('src-tauri/tauri.conf.json updater key', () => {
  it('compiles in the public key the release pipeline signs with (BEDF931CA1D6C777)', () => {
    const pubkey = loadConfig().plugins?.updater?.pubkey;

    expect(typeof pubkey, 'plugins.updater.pubkey must be a string').toBe('string');
    expect(
      pubkey,
      `configured key is "${describeKey(pubkey as string)}", expected "${describeKey(CANONICAL_UPDATER_PUBKEY)}". See ADR-031 before changing the updater key.`
    ).toBe(CANONICAL_UPDATER_PUBKEY);
  });

  it('carries key id BEDF931CA1D6C777 in the key bytes, not only in the comment line', () => {
    const pubkey = loadConfig().plugins?.updater?.pubkey as string;

    expect(keyIdFromPubkey(pubkey)).toBe(CANONICAL_KEY_ID);
    expect(atob(pubkey).split('\n')[0]).toBe(
      `untrusted comment: minisign public key: ${CANONICAL_KEY_ID}`
    );
  });
});
