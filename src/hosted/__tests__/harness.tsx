import { vi } from 'vitest';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createPortalQueryClient } from '../queryClient';
import { createMemoryHistory } from '@tanstack/react-router';
import { PortalProviders } from '../HostedApp';
import { createPortalRouter } from '../router';
import type { HostedProfile, Me } from '../api/client';

/**
 * Drives the real portal: the real router on a memory history, the real query
 * client, and a `fetch` stub keyed by `"METHOD /path"`. Every route a test does
 * not name answers like an empty profile, so a test only states what matters.
 */

export interface StubRequest {
  method: string;
  url: URL;
  headers: Headers;
  body: unknown;
}
export type Handler = (request: StubRequest) => Response | Promise<Response>;

export function ok(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export function fail(status: number, code: string, details?: unknown, headers: Record<string, string> = {}): Response {
  return ok({ error: { code, message: code, details: details ?? null, requestId: 'req-test' } }, status, headers);
}

export const never = () => new Promise<Response>(() => {});

export const ORG_A = '11111111-1111-4111-8111-111111111111';
export const ORG_B = '22222222-2222-4222-8222-222222222222';

export function profile(overrides: Partial<HostedProfile> = {}): HostedProfile {
  return {
    id: ORG_A,
    name: 'Haddad & Partners',
    source: 'hosted',
    defaultCurrency: 'ILS',
    timezone: 'Asia/Jerusalem',
    writerOfRecord: 'MALAFAT',
    access: { payments: 'read', expenses: 'read-write', capture: 'read-write' },
    // What /v1/me publishes for a Malafat-fed profile (MUT-61, MUT-120).
    income: { received: true, owed: false, customer: 'linked-required' },
    isPersonalDefault: false,
    // MUT-182: a firm — nobody's own profile, untyped.
    owned: false,
    type: null,
    version: 1,
    // MUT-300: firm features off, no role, nothing requested.
    firm: false,
    role: null,
    firmRequestedAt: null,
    // MUT-373: a profile you don't own lists no owners.
    owners: null,
    firmRequestedBy: null,
    // MUT-358/361: no billing in a test unless it says so (the signed-out shape; the lapse gate off).
    billing: null,
    ...overrides,
  };
}

export function me(profiles: HostedProfile[] = [profile()], locale: 'en' | 'ar' = 'en'): Me {
  return {
    user: {
      id: '99999999-9999-4999-8999-999999999999',
      email: 'nour@firm.ps',
      displayName: 'Nour Haddad',
      locale,
      malafatSuggestions: { off: false, dismissed: [] },
      // MUT-418: a test person has answered the first-run trial step unless a test says otherwise.
      trialPrompt: { welcomedAt: '2026-10-01T09:00:00.000Z', welcomeAnswer: 'skipped', bannerSnoozedUntil: null },
      status: 'ACTIVE',
      // MUT-333: not closing unless a test says so.
      closure: null,
    },
    profiles,
    limits: { ownedProfiles: profiles.filter((p) => p.owned).length, maxOwnedProfiles: 6 },
    // MUT-324: a signed-in test person has accepted the current terms unless a test says otherwise.
    terms: { version: '2026-10-19', accepted: true },
    // MUT-361: the lapse gate isn't enforced unless a test says so.
    billingStanding: null,
  };
}

const EMPTY_PAGE = { items: [], nextCursor: null };

export function emptyProfileRoutes(): Record<string, Handler> {
  return {
    'GET /v1/summaries/organization': () => ok({ asOf: '2026-10-11', currencies: [] }),
    'GET /v1/customers': () => ok(EMPTY_PAGE),
    'GET /v1/projects': () => ok(EMPTY_PAGE),
    'GET /v1/receivables': () => ok(EMPTY_PAGE),
    'GET /v1/payments': () => ok(EMPTY_PAGE),
    'GET /v1/attachments': () => ok(EMPTY_PAGE),
  };
}

export function stubApi(routes: Record<string, Handler>) {
  const calls: StubRequest[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), 'http://portal.test');
    const method = (init.method ?? 'GET').toUpperCase();
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const request = { method, url, headers: new Headers(init.headers), body };
    calls.push(request);
    const handler = routes[`${method} ${url.pathname}`];
    if (!handler) return fail(404, 'NOT_FOUND');
    return handler(request);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls, count: (key: string) => calls.filter((c) => `${c.method} ${c.url.pathname}` === key).length };
}

export function renderPortal(path: string) {
  // The portal's own client (MUT-361: a lapse refusal re-reads /v1/me), without retries.
  const queryClient = createPortalQueryClient({ queries: { retry: false }, mutations: { retry: false } });
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = createPortalRouter(queryClient, history);
  const user = userEvent.setup();
  const utils = render(<PortalProviders queryClient={queryClient} router={router} />);
  return { ...utils, router, queryClient, history, user };
}

/** Current path + search, as the router sees it. */
export function locationOf(router: ReturnType<typeof createPortalRouter>): string {
  return router.state.location.href;
}
