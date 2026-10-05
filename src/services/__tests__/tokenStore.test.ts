import { describe, it, expect } from 'vitest';
import {
  InMemoryTokenStore,
  isAccessTokenExpired,
  needsRefresh,
  REFRESH_SKEW_MS,
} from '../tokenStore';
import type { TokenSet } from '../../sync/transport/oauth-client';

const ORIGIN_A = 'https://acme.malafat.app';
const ORIGIN_B = 'https://other-firm.malafat.app';

function tokenSet(overrides: Partial<TokenSet> = {}): TokenSet {
  return {
    accessToken: 'at-1',
    refreshToken: 'rt-1',
    expiresAt: 10_000,
    scopes: ['clients:read'],
    ...overrides,
  };
}

describe('InMemoryTokenStore', () => {
  it('returns null for a workspace it has never seen', async () => {
    await expect(new InMemoryTokenStore().load(ORIGIN_A)).resolves.toBeNull();
  });

  it('round-trips a token set', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet());
    await expect(store.load(ORIGIN_A)).resolves.toEqual(tokenSet());
  });

  it('keys tokens per workspace — one lawyer may serve two firms', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet({ accessToken: 'at-a' }));
    await store.save(ORIGIN_B, tokenSet({ accessToken: 'at-b' }));

    expect((await store.load(ORIGIN_A))?.accessToken).toBe('at-a');
    expect((await store.load(ORIGIN_B))?.accessToken).toBe('at-b');
  });

  it('clears one workspace without disturbing the other', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet());
    await store.save(ORIGIN_B, tokenSet());

    await store.clear(ORIGIN_A);

    await expect(store.load(ORIGIN_A)).resolves.toBeNull();
    await expect(store.load(ORIGIN_B)).resolves.not.toBeNull();
  });

  it('overwrites rather than accumulates on re-save, so a superseded refresh token cannot linger', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet({ refreshToken: 'rt-1' }));
    await store.save(ORIGIN_A, tokenSet({ refreshToken: 'rt-2' }));

    expect((await store.load(ORIGIN_A))?.refreshToken).toBe('rt-2');
  });

  it('persists nothing beyond its own lifetime', async () => {
    // The spike deliberately has no durable store: a refresh token is a
    // long-lived credential and must land in the OS keychain, which needs a
    // Tauri plugin this spike does not add. Losing tokens on restart forces
    // re-auth, which is the safe failure.
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet());
    await expect(new InMemoryTokenStore().load(ORIGIN_A)).resolves.toBeNull();
  });

  it('clearAll removes every workspace', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN_A, tokenSet());
    await store.save(ORIGIN_B, tokenSet());

    await store.clearAll();

    await expect(store.load(ORIGIN_A)).resolves.toBeNull();
    await expect(store.load(ORIGIN_B)).resolves.toBeNull();
  });

  it('normalises a trailing slash so the same workspace is not stored twice', async () => {
    const store = new InMemoryTokenStore();
    await store.save(`${ORIGIN_A}/`, tokenSet({ accessToken: 'at-x' }));
    expect((await store.load(ORIGIN_A))?.accessToken).toBe('at-x');
  });
});

describe('isAccessTokenExpired', () => {
  it('is false well before expiry', () => {
    expect(isAccessTokenExpired(tokenSet({ expiresAt: 10_000 }), 0)).toBe(false);
  });

  it('is true at the expiry instant', () => {
    expect(isAccessTokenExpired(tokenSet({ expiresAt: 10_000 }), 10_000)).toBe(true);
  });

  it('is true after expiry', () => {
    expect(isAccessTokenExpired(tokenSet({ expiresAt: 10_000 }), 10_001)).toBe(true);
  });
});

describe('needsRefresh', () => {
  it('is true inside the skew window, so a request never races the expiry', () => {
    const expiresAt = 1_000_000;
    expect(needsRefresh(tokenSet({ expiresAt }), expiresAt - REFRESH_SKEW_MS + 1)).toBe(true);
  });

  it('is false outside the skew window', () => {
    const expiresAt = 1_000_000;
    expect(needsRefresh(tokenSet({ expiresAt }), expiresAt - REFRESH_SKEW_MS - 1)).toBe(false);
  });

  it('is true for an already-expired token', () => {
    expect(needsRefresh(tokenSet({ expiresAt: 10_000 }), 20_000)).toBe(true);
  });

  it('leaves a usable margin — a one-hour Malafat token must not refresh on every call', () => {
    expect(REFRESH_SKEW_MS).toBeGreaterThan(0);
    expect(REFRESH_SKEW_MS).toBeLessThan(60 * 60 * 1000);
  });
});
