import type { Page, Request, Route } from '@playwright/test';

/**
 * A signed-in hosted portal with every /v1 call stubbed (MUT-191), so a portal
 * spec needs no server. `/v1/me` answers with the given profiles; lists answer
 * with the given customers or empty pages; writes are recorded for the spec.
 */

/** PORTAL_LANGUAGE_KEY in src/hosted/i18n/HostedLanguageProvider.tsx */
const PORTAL_LANGUAGE_KEY = 'mutaba3a-portal-language';

const STAMP = '2026-10-01T09:00:00.000Z';
export const OFFICE_A = '11111111-1111-4111-8111-111111111111';
export const OFFICE_B = '22222222-2222-4222-8222-222222222222';
export const FIRM = '33333333-3333-4333-8333-333333333333';
export const NEW_PROFILE = '44444444-4444-4444-8444-444444444444';

export interface StubProfile {
  id: string;
  name: string;
  type: 'BUSINESS' | 'PERSONAL' | null;
  owned: boolean;
  writerOfRecord: 'MALAFAT' | null;
  /** MUT-300: firm features on (the caller is OWNER unless `role` says otherwise); off when absent. */
  firm?: boolean;
  role?: 'OWNER' | 'BOOKKEEPER' | 'SUBMITTER';
  /** MUT-300: the owner's pending request for firm features. */
  firmRequestedAt?: string | null;
}

export const office = (id: string, name: string): StubProfile => ({ id, name, type: 'BUSINESS', owned: true, writerOfRecord: null });
export const malafatFirm = (): StubProfile => ({ id: FIRM, name: 'Haddad & Partners', type: null, owned: false, writerOfRecord: 'MALAFAT' });

export function hostedProfile(p: StubProfile) {
  const fed = p.writerOfRecord === 'MALAFAT';
  return {
    id: p.id,
    name: p.name,
    source: 'hosted',
    defaultCurrency: 'ILS',
    timezone: 'Asia/Jerusalem',
    writerOfRecord: p.writerOfRecord,
    access: fed
      ? { payments: 'read', expenses: 'read-write', capture: 'read-write' }
      : { payments: 'read-write', expenses: 'read-write', capture: 'read-write' },
    income: fed ? { received: true, owed: false, customer: 'linked-required' } : { received: true, owed: true, customer: 'optional' },
    isPersonalDefault: false,
    owned: p.owned,
    type: p.type,
    version: 1,
    firm: p.firm ?? false,
    role: p.firm ? (p.role ?? 'OWNER') : null,
    firmRequestedAt: p.owned ? (p.firmRequestedAt ?? null) : null,
  };
}

export function customer(i: number) {
  return {
    id: `0000${String(i).padStart(4, '0')}-0000-4000-8000-000000000000`,
    name: `Client ${i + 1}`,
    email: null,
    phone: null,
    notes: null,
    vatTreatment: 'STANDARD_RATED',
    status: 'ACTIVE',
    archivedAt: null,
    externalReference: null,
    version: 1,
    createdAt: STAMP,
    updatedAt: STAMP,
  };
}

export interface PortalStub {
  /** Bodies of every PATCH /v1/me/malafat-suggestions, in order. */
  malafatChanges: unknown[];
}

/** The signed-in person's `/v1/me` answer for these profiles (the shape openSignedInPortal serves). */
export function meBody(profiles: StubProfile[], language: 'en' | 'ar' = 'en', suggestions = { off: false, dismissed: [] as string[] }) {
  return {
    user: { id: '99999999-9999-4999-8999-999999999999', email: 'nour@office.ps', displayName: 'Nour Haddad', locale: language, malafatSuggestions: suggestions },
    profiles: profiles.map(hostedProfile),
    limits: { ownedProfiles: profiles.filter((p) => p.owned).length, maxOwnedProfiles: 6 },
  };
}

/**
 * A spec's own answer for a /v1 call, asked before the defaults below: return
 * true once it has fulfilled (or aborted) the route, false to fall through.
 */
export type PortalHandler = (route: Route, request: Request, url: URL) => Promise<boolean> | boolean;

export async function openSignedInPortal(
  page: Page,
  {
    profiles,
    clients = 0,
    language = 'en',
    path,
    handle,
    chooseLanguage = true,
  }: {
    profiles: StubProfile[];
    clients?: number;
    language?: 'en' | 'ar';
    path: string;
    handle?: PortalHandler;
    /** false: store no language choice, so the portal's own default and the account's locale apply (MUT-209, MUT-236). */
    chooseLanguage?: boolean;
  },
): Promise<PortalStub> {
  const stub: PortalStub = { malafatChanges: [] };
  let list = profiles;
  let suggestions = { off: false, dismissed: [] as string[] };
  const json = (body: unknown, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/v1/**', async (route) => {
    const request = route.request();
    const { pathname } = new URL(request.url());
    const method = request.method();
    if (handle && (await handle(route, request, new URL(request.url())))) return;
    if (method === 'GET' && pathname === '/v1/me') return route.fulfill(json(meBody(list, language, suggestions)));
    if (method === 'PATCH' && pathname === '/v1/me/malafat-suggestions') {
      const change = request.postDataJSON() as { off?: boolean; dismiss?: string[] };
      stub.malafatChanges.push(change);
      suggestions = {
        off: change.off ?? suggestions.off,
        dismissed: [...new Set([...suggestions.dismissed, ...(change.dismiss ?? [])])],
      };
      return route.fulfill(json(suggestions));
    }
    if (method === 'POST' && pathname === '/v1/profiles') {
      const body = request.postDataJSON() as { name: string; type: 'BUSINESS' | 'PERSONAL' };
      const created: StubProfile = { id: NEW_PROFILE, name: body.name, type: body.type, owned: true, writerOfRecord: null };
      list = [created, ...list];
      return route.fulfill(json(hostedProfile(created), 201));
    }
    if (method === 'GET' && pathname === '/v1/summaries/organization') return route.fulfill(json({ asOf: '2026-10-15', currencies: [] }));
    if (method === 'GET' && pathname === '/v1/customers') {
      return route.fulfill(json({ items: Array.from({ length: clients }, (_, i) => customer(i)), nextCursor: null }));
    }
    if (method === 'GET') return route.fulfill(json({ items: [], nextCursor: null }));
    return route.fulfill(json({ error: { code: 'NOT_FOUND', message: 'Not stubbed' } }, 404));
  });
  if (chooseLanguage) await page.addInitScript(
    ([key, value]) => {
      try {
        localStorage.setItem(key, value);
      } catch {
        // storage blocked: the default language applies
      }
    },
    [PORTAL_LANGUAGE_KEY, language] as const,
  );
  await page.goto(path);
  return stub;
}
