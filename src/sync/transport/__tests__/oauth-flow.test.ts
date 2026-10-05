import { describe, it, expect, vi } from 'vitest';
import {
  connectWorkspace,
  getValidAccessToken,
  disconnectWorkspace,
  WorkspaceDisconnectedError,
  type OAuthFlowDeps,
} from '../oauth-flow';
import { InMemoryTokenStore, REFRESH_SKEW_MS } from '../../../services/tokenStore';
import { OAUTH_LOOPBACK_PORTS } from '../oauth-client';
import type { TokenSet } from '../oauth-client';

const ORIGIN = 'https://acme.malafat.app';

const DISCOVERY = {
  issuer: ORIGIN,
  authorization_endpoint: `${ORIGIN}/oauth/authorize`,
  token_endpoint: `${ORIGIN}/api/oauth/token`,
  code_challenge_methods_supported: ['S256'],
};

const TOKEN_RESPONSE = {
  access_token: 'at-1',
  refresh_token: 'rt-1',
  expires_in: 3600,
  scope: 'clients:read',
};

/**
 * Fetch double that answers discovery and the token endpoint, and records the
 * order of calls so sequencing can be asserted.
 */
function fakeServer(opts: { tokenResponse?: unknown; tokenStatus?: number } = {}) {
  const order: string[] = [];
  const impl = vi.fn(async (url: string) => {
    if (url.includes('.well-known')) {
      order.push('discover');
      return { ok: true, status: 200, json: async () => DISCOVERY } as Response;
    }
    order.push('token');
    const status = opts.tokenStatus ?? 200;
    return {
      ok: status < 400,
      status,
      json: async () => opts.tokenResponse ?? TOKEN_RESPONSE,
    } as Response;
  });
  return { impl: impl as unknown as typeof fetch, order };
}

function deps(overrides: Partial<OAuthFlowDeps> = {}): OAuthFlowDeps & { order: string[] } {
  const server = fakeServer();
  const order = server.order;
  return {
    bindCallback: vi.fn(async (ports: readonly number[]) => {
      order.push('bind');
      return ports[0];
    }),
    awaitCallback: vi.fn(async () => {
      order.push('await');
      // Echo back whatever state the flow put in the authorize URL.
      return `code=the-code&state=${lastState}`;
    }),
    openUrl: vi.fn(async (url: string) => {
      order.push('open');
      lastOpenedUrl = url;
      lastState = new URL(url).searchParams.get('state') ?? '';
    }),
    fetchImpl: server.impl,
    now: () => 1_000_000,
    order,
    ...overrides,
  } as OAuthFlowDeps & { order: string[] };
}

let lastOpenedUrl = '';
let lastState = '';

describe('connectWorkspace', () => {
  it('binds the loopback port BEFORE opening the browser', async () => {
    // Getting this backwards builds an authorize URL naming a port nothing is
    // listening on, and Malafat matches redirect_uri exactly.
    const d = deps();
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), d);
    expect(d.order.indexOf('bind')).toBeLessThan(d.order.indexOf('open'));
  });

  it('opens an authorize URL on the tenant subdomain', async () => {
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), deps());
    expect(lastOpenedUrl.startsWith(`${ORIGIN}/oauth/authorize?`)).toBe(true);
  });

  it('uses the port the listener actually bound, not the first preference', async () => {
    const d = deps({
      bindCallback: vi.fn(async () => OAUTH_LOOPBACK_PORTS[2]),
    });
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), d);
    expect(new URL(lastOpenedUrl).searchParams.get('redirect_uri')).toBe(
      `http://127.0.0.1:${OAUTH_LOOPBACK_PORTS[2]}/callback`
    );
  });

  it('offers only the registered ports to the listener', async () => {
    const bindCallback = vi.fn(async (ports: readonly number[]) => ports[0]);
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), deps({ bindCallback }));
    expect(bindCallback).toHaveBeenCalledWith(OAUTH_LOOPBACK_PORTS);
  });

  it('stores the resulting tokens against the workspace', async () => {
    const store = new InMemoryTokenStore();
    await connectWorkspace(ORIGIN, ['clients:read'], store, deps());

    const saved = await store.load(ORIGIN);
    expect(saved?.accessToken).toBe('at-1');
    expect(saved?.refreshToken).toBe('rt-1');
    expect(saved?.expiresAt).toBe(1_000_000 + 3600 * 1000);
  });

  it('sends a fresh state on each attempt', async () => {
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), deps());
    const first = new URL(lastOpenedUrl).searchParams.get('state');
    await connectWorkspace(ORIGIN, ['clients:read'], new InMemoryTokenStore(), deps());
    expect(new URL(lastOpenedUrl).searchParams.get('state')).not.toBe(first);
  });

  it('stores nothing when the callback state does not match', async () => {
    const store = new InMemoryTokenStore();
    const d = deps({ awaitCallback: vi.fn(async () => 'code=x&state=forged') });

    await expect(connectWorkspace(ORIGIN, ['clients:read'], store, d)).rejects.toThrow(/state/i);
    await expect(store.load(ORIGIN)).resolves.toBeNull();
  });

  it('stores nothing when the token exchange is rejected', async () => {
    const store = new InMemoryTokenStore();
    const server = fakeServer({ tokenStatus: 400, tokenResponse: { error: 'invalid_grant' } });
    const d = deps({ fetchImpl: server.impl });

    await expect(connectWorkspace(ORIGIN, ['clients:read'], store, d)).rejects.toThrow();
    await expect(store.load(ORIGIN)).resolves.toBeNull();
  });

  it('refuses a non-https workspace origin', async () => {
    await expect(
      connectWorkspace('http://acme.malafat.app', ['clients:read'], new InMemoryTokenStore(), deps())
    ).rejects.toThrow(/https/i);
  });
});

describe('getValidAccessToken', () => {
  function stored(overrides: Partial<TokenSet> = {}): TokenSet {
    return {
      accessToken: 'at-old',
      refreshToken: 'rt-old',
      expiresAt: 2_000_000,
      scopes: ['clients:read'],
      ...overrides,
    };
  }

  it('returns the stored token while it is still fresh', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, stored());
    const server = fakeServer();

    await expect(
      getValidAccessToken(ORIGIN, store, deps({ fetchImpl: server.impl, now: () => 1_000_000 }))
    ).resolves.toBe('at-old');
    expect(server.order).not.toContain('token');
  });

  it('refreshes once the token is inside the skew window', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, stored({ expiresAt: 2_000_000 }));
    const server = fakeServer({ tokenResponse: { access_token: 'at-new', expires_in: 3600 } });

    const token = await getValidAccessToken(
      ORIGIN,
      store,
      deps({ fetchImpl: server.impl, now: () => 2_000_000 - REFRESH_SKEW_MS + 1 })
    );

    expect(token).toBe('at-new');
    expect((await store.load(ORIGIN))?.accessToken).toBe('at-new');
  });

  it('persists a rotated refresh token immediately', async () => {
    // If a rotated token is not stored, the next refresh replays the old one
    // and Malafat revokes the entire grant (REFRESH_REUSE).
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, stored({ expiresAt: 0 }));
    const server = fakeServer({
      tokenResponse: { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 },
    });

    await getValidAccessToken(ORIGIN, store, deps({ fetchImpl: server.impl, now: () => 10 }));
    expect((await store.load(ORIGIN))?.refreshToken).toBe('rt-new');
  });

  it('throws WorkspaceDisconnectedError and clears tokens when the grant is gone', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, stored({ expiresAt: 0 }));
    const server = fakeServer({ tokenStatus: 400, tokenResponse: { error: 'invalid_grant' } });

    await expect(
      getValidAccessToken(ORIGIN, store, deps({ fetchImpl: server.impl, now: () => 10 }))
    ).rejects.toBeInstanceOf(WorkspaceDisconnectedError);

    await expect(store.load(ORIGIN)).resolves.toBeNull();
  });

  it('keeps tokens on a transient server failure so a blip does not force re-auth', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, stored({ expiresAt: 0 }));
    const server = fakeServer({ tokenStatus: 503, tokenResponse: { error: 'server_error' } });

    await expect(
      getValidAccessToken(ORIGIN, store, deps({ fetchImpl: server.impl, now: () => 10 }))
    ).rejects.not.toBeInstanceOf(WorkspaceDisconnectedError);

    await expect(store.load(ORIGIN)).resolves.not.toBeNull();
  });

  it('throws WorkspaceDisconnectedError when no token is stored at all', async () => {
    await expect(
      getValidAccessToken(ORIGIN, new InMemoryTokenStore(), deps())
    ).rejects.toBeInstanceOf(WorkspaceDisconnectedError);
  });

  it('never opens a browser on its own — re-auth is the user\'s decision', async () => {
    const d = deps();
    await expect(getValidAccessToken(ORIGIN, new InMemoryTokenStore(), d)).rejects.toThrow();
    expect(d.openUrl).not.toHaveBeenCalled();
  });
});

describe('disconnectWorkspace', () => {
  it('forgets the tokens', async () => {
    const store = new InMemoryTokenStore();
    await store.save(ORIGIN, {
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 1,
      scopes: [],
    });

    await disconnectWorkspace(ORIGIN, store);
    await expect(store.load(ORIGIN)).resolves.toBeNull();
  });

  it('is safe to call when nothing is connected', async () => {
    await expect(disconnectWorkspace(ORIGIN, new InMemoryTokenStore())).resolves.toBeUndefined();
  });
});
