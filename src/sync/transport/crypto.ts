/**
 * Sync Encryption
 *
 * Provides encryption/decryption for sync bundles using AES-256-GCM.
 * In web browsers, uses WebCrypto with PBKDF2.
 * In Tauri, can optionally use Rust backend with Argon2id.
 *
 * Bundle format:
 * [4 bytes: magic "MSYN"]
 * [4 bytes: version (1)]
 * [4 bytes: KDF identifier (0=PBKDF2, 1=Argon2id)]
 * [16 bytes: salt]
 * [12 bytes: nonce/IV]
 * [variable: encrypted payload]
 * [16 bytes: auth tag (included in WebCrypto ciphertext)]
 */

import type { MsyncBundle } from '../core/ops-types';
import { SyncError } from '../core/ops-types';

// Magic bytes: "MSYN" in ASCII
const MAGIC = new Uint8Array([0x4d, 0x53, 0x59, 0x4e]);
const VERSION = 1;
const KDF_PBKDF2 = 0;
// const KDF_ARGON2ID = 1; // For Tauri backend

const SALT_LENGTH = 16;
const NONCE_LENGTH = 12;
const PBKDF2_ITERATIONS = 600000; // OWASP 2023 recommendation

// ============================================================================
// Key Derivation
// ============================================================================

/**
 * Derive an AES-256 key from a passphrase using PBKDF2.
 */
async function deriveKeyPBKDF2(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passphraseKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  // Create a new ArrayBuffer from the salt to ensure correct type
  const saltBuffer = new Uint8Array(salt).buffer;

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: saltBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    passphraseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// ============================================================================
// Encryption
// ============================================================================

/**
 * Encrypt a sync bundle with a passphrase.
 */
export async function encryptBundle(bundle: MsyncBundle, passphrase: string): Promise<ArrayBuffer> {
  // Serialize bundle to JSON
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(bundle));

  // Generate random salt and nonce
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  // Derive key
  const key = await deriveKeyPBKDF2(passphrase, salt);

  // Encrypt
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext
  );

  // Assemble output
  // Header: magic (4) + version (4) + kdf (4) + salt (16) + nonce (12) = 40 bytes
  const headerSize = 4 + 4 + 4 + SALT_LENGTH + NONCE_LENGTH;
  const output = new Uint8Array(headerSize + ciphertext.byteLength);

  let offset = 0;

  // Magic
  output.set(MAGIC, offset);
  offset += 4;

  // Version (little-endian)
  new DataView(output.buffer).setUint32(offset, VERSION, true);
  offset += 4;

  // KDF identifier
  new DataView(output.buffer).setUint32(offset, KDF_PBKDF2, true);
  offset += 4;

  // Salt
  output.set(salt, offset);
  offset += SALT_LENGTH;

  // Nonce
  output.set(nonce, offset);
  offset += NONCE_LENGTH;

  // Ciphertext
  output.set(new Uint8Array(ciphertext), offset);

  return output.buffer;
}

// ============================================================================
// Decryption
// ============================================================================

/**
 * Decrypt a sync bundle with a passphrase.
 */
export async function decryptBundle(data: ArrayBuffer, passphrase: string): Promise<MsyncBundle> {
  const view = new DataView(data);
  const bytes = new Uint8Array(data);

  let offset = 0;

  // Verify magic
  const magic = bytes.slice(offset, offset + 4);
  if (!arraysEqual(magic, MAGIC)) {
    throw new SyncError('BUNDLE_CORRUPT', 'Invalid bundle file - not a valid .msync file');
  }
  offset += 4;

  // Read version
  const version = view.getUint32(offset, true);
  if (version !== VERSION) {
    throw new SyncError('BUNDLE_CORRUPT', `Unsupported bundle version: ${version}`);
  }
  offset += 4;

  // Read KDF identifier
  const kdf = view.getUint32(offset, true);
  if (kdf !== KDF_PBKDF2) {
    throw new SyncError('BUNDLE_CORRUPT', 'Unsupported key derivation function');
  }
  offset += 4;

  // Read salt
  const salt = bytes.slice(offset, offset + SALT_LENGTH);
  offset += SALT_LENGTH;

  // Read nonce
  const nonce = bytes.slice(offset, offset + NONCE_LENGTH);
  offset += NONCE_LENGTH;

  // Read ciphertext
  const ciphertext = bytes.slice(offset);

  // Derive key
  const key = await deriveKeyPBKDF2(passphrase, salt);

  // Decrypt
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce },
      key,
      ciphertext
    );
  } catch {
    throw new SyncError('BUNDLE_BAD_PASSPHRASE', 'Wrong passphrase or corrupted bundle');
  }

  // Parse JSON
  const decoder = new TextDecoder();
  const json = decoder.decode(plaintext);

  try {
    const bundle = JSON.parse(json) as MsyncBundle;

    // Validate structure
    if (!bundle.manifest || !Array.isArray(bundle.ops)) {
      throw new SyncError('BUNDLE_CORRUPT', 'Invalid bundle structure');
    }

    return bundle;
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError('BUNDLE_CORRUPT', 'Failed to parse bundle contents');
  }
}

// ============================================================================
// Passphrase Utilities
// ============================================================================

/**
 * Validate passphrase strength.
 * Returns an object with validation result and feedback.
 */
export function validatePassphrase(passphrase: string): {
  valid: boolean;
  strength: 'weak' | 'fair' | 'strong';
  feedback: string[];
} {
  const feedback: string[] = [];
  let score = 0;

  // Length check
  if (passphrase.length < 8) {
    feedback.push('At least 8 characters');
  } else if (passphrase.length >= 12) {
    score += 2;
  } else {
    score += 1;
  }

  // Character variety
  if (/[a-z]/.test(passphrase)) score += 1;
  if (/[A-Z]/.test(passphrase)) score += 1;
  if (/[0-9]/.test(passphrase)) score += 1;
  if (/[^a-zA-Z0-9]/.test(passphrase)) score += 1;

  if (!/[a-z]/.test(passphrase) || !/[A-Z]/.test(passphrase)) {
    feedback.push('Mix of upper and lowercase letters');
  }
  if (!/[0-9]/.test(passphrase)) {
    feedback.push('At least one number');
  }

  // Common patterns to avoid
  const commonPatterns = [
    /^123/,
    /password/i,
    /qwerty/i,
    /admin/i,
  ];
  for (const pattern of commonPatterns) {
    if (pattern.test(passphrase)) {
      score -= 1;
      feedback.push('Avoid common patterns');
      break;
    }
  }

  // Determine strength
  let strength: 'weak' | 'fair' | 'strong';
  if (score < 3) {
    strength = 'weak';
  } else if (score < 5) {
    strength = 'fair';
  } else {
    strength = 'strong';
  }

  return {
    valid: passphrase.length >= 8 && score >= 3,
    strength,
    feedback,
  };
}

/**
 * Generate a random passphrase using word list.
 * Returns a human-readable passphrase like "apple-sunset-mountain-river"
 */
export function generatePassphrase(wordCount = 4): string {
  // Simple word list for passphrase generation
  const words = [
    'apple', 'baker', 'candy', 'delta', 'eagle', 'frost', 'green', 'happy',
    'index', 'joker', 'karma', 'lemon', 'maple', 'north', 'ocean', 'piano',
    'queen', 'river', 'solar', 'tiger', 'ultra', 'vivid', 'water', 'xenon',
    'yacht', 'zebra', 'amber', 'blaze', 'coral', 'dusk', 'ember', 'flame',
    'grove', 'haven', 'ivory', 'jade', 'kayak', 'lunar', 'marble', 'nova',
    'opal', 'prism', 'quartz', 'ridge', 'storm', 'tide', 'unity', 'valley',
    'wave', 'axis', 'bloom', 'cloud', 'drift', 'echo', 'fern', 'glow',
    'haze', 'iris', 'jewel', 'knot', 'leaf', 'mist', 'nest', 'orbit',
  ];

  const selectedWords: string[] = [];
  const randomValues = new Uint32Array(wordCount);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < wordCount; i++) {
    const index = randomValues[i] % words.length;
    selectedWords.push(words[index]);
  }

  return selectedWords.join('-');
}

// ============================================================================
// Helpers
// ============================================================================

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Passphrase Storage (Desktop Only)
// ============================================================================

const PASSPHRASE_KEY = 'sync_passphrase_hint';

/**
 * Store a passphrase hint in localStorage.
 * Note: For true security, use OS keychain via Tauri.
 */
export function storePassphraseHint(hint: string): void {
  try {
    localStorage.setItem(PASSPHRASE_KEY, hint);
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get stored passphrase hint.
 */
export function getPassphraseHint(): string | null {
  try {
    return localStorage.getItem(PASSPHRASE_KEY);
  } catch {
    return null;
  }
}

/**
 * Clear stored passphrase hint.
 */
export function clearPassphraseHint(): void {
  try {
    localStorage.removeItem(PASSPHRASE_KEY);
  } catch {
    // Ignore storage errors
  }
}
