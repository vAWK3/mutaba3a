import { describe, expect, it } from 'vitest';
import { generateApiKey, hashApiKey, hashesMatch, maskApiKey, parseApiKey } from '../api-key.js';
import { hasScope, MALAFAT_REQUIRED_SCOPES, missingScopes, parseScopes, SCOPES, SESSION_ONLY_SCOPES } from '../scopes.js';
import { sessionScopes } from '../writability.js';

describe('generateApiKey', () => {
  it('produces the documented format and a hash that is not the secret', () => {
    const k = generateApiKey('live');
    expect(k.secret).toMatch(/^mut_live_[a-z0-9]{8}_[A-Za-z0-9_-]{43}$/);
    expect(k.keyHash).toHaveLength(64);
    expect(k.keyHash).not.toContain(k.secret);
    expect(hashApiKey(k.secret)).toBe(k.keyHash);
    expect(k.prefix).toBe(parseApiKey(k.secret)?.prefix);
  });

  it('is random: two keys never share a prefix or hash', () => {
    const a = generateApiKey('test');
    const b = generateApiKey('test');
    expect(a.prefix).not.toBe(b.prefix);
    expect(a.keyHash).not.toBe(b.keyHash);
  });
});

describe('parseApiKey', () => {
  it('rejects anything that is not exactly the format', () => {
    for (const bad of ['', 'mut_live_abc', 'mut_prod_abcdefgh_' + 'a'.repeat(43), 'Bearer x', 'mut_live_ABCDEFGH_' + 'a'.repeat(43)]) {
      expect(parseApiKey(bad), bad).toBeNull();
    }
  });
});

describe('hashesMatch', () => {
  it('compares equal-length digests and rejects different lengths', () => {
    const h = hashApiKey('x');
    expect(hashesMatch(h, h)).toBe(true);
    expect(hashesMatch(h, hashApiKey('y'))).toBe(false);
    expect(hashesMatch(h, h.slice(1))).toBe(false);
  });
});

describe('maskApiKey', () => {
  it('shows environment, four prefix chars and four hash chars only', () => {
    const k = generateApiKey('live');
    const masked = maskApiKey('live', k.prefix, k.keyHash);
    expect(masked).toBe(`mut_live_${k.prefix.slice(0, 4)}…${k.keyHash.slice(-4)}`);
    expect(masked).not.toContain(k.secret.slice(-10));
  });
});

describe('scopes', () => {
  it('fails the whole list on an unknown scope rather than narrowing', () => {
    expect(parseScopes(['payments:read', 'bogus'])).toEqual({ ok: false, invalid: ['bogus'] });
  });

  it('deduplicates and preserves order', () => {
    expect(parseScopes(['payments:read', 'payments:read', 'customers:read'])).toEqual({
      ok: true,
      scopes: ['payments:read', 'customers:read'],
    });
  });

  it('is non-hierarchical: write never implies read', () => {
    expect(hasScope(['payments:write'], 'payments:read')).toBe(false);
    expect(missingScopes(['payments:write'], ['payments:read', 'payments:write'])).toEqual(['payments:read']);
  });

  it('publishes every scope with a resource:verb shape', () => {
    for (const s of SCOPES) expect(s).toMatch(/^[a-z]+:(read|write)$/);
  });
});

describe('session-only scopes (MUT-42 D4)', () => {
  const KEY_VOCABULARY = [
    'integration:read', 'integration:write', 'customers:read', 'customers:write', 'projects:read', 'projects:write',
    'agreements:read', 'agreements:write', 'payments:read', 'payments:write', 'attachments:read', 'attachments:write',
    'summaries:read', 'audit:read',
  ];

  it('leaves the key vocabulary Malafat sees exactly as it was', () => {
    expect([...SCOPES]).toEqual(KEY_VOCABULARY);
    expect([...MALAFAT_REQUIRED_SCOPES]).toEqual(KEY_VOCABULARY);
  });

  it('never issues an expense scope to a key', () => {
    expect(parseScopes(['payments:read', 'expenses:read'])).toEqual({ ok: false, invalid: ['expenses:read'] });
    expect(parseScopes(['expenses:write'])).toEqual({ ok: false, invalid: ['expenses:write'] });
  });

  it('grants both expense scopes to a session, from the matrix', () => {
    expect(SESSION_ONLY_SCOPES).toEqual(['expenses:read', 'expenses:write']);
    expect(sessionScopes()).toEqual(expect.arrayContaining(['expenses:read', 'expenses:write']));
  });
});
