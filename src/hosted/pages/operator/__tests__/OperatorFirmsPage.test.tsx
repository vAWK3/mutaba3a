import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { FirmRequest, Me, OperatorFirmRequestDetail } from '../../../api/client';
import { fail, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';

/**
 * MUT-462 (design 16A, 8A): the operator's Firms tab. Pending requests for firm features, oldest first; Enable names the
 * owners in the row (an owned Business profile keeps its own), Decline confirms in the row, and a decided request leaves
 * the list with a toast. The server is stubbed; the step-up is fresh unless a test says otherwise.
 */
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...real, startAuthentication: browser.startAuthentication, browserSupportsWebAuthn: () => true, browserSupportsWebAuthnAutofill: async () => false };
});

const NOW = new Date('2026-10-27T12:00:00.000Z');
const FRESH = '2026-10-27T12:08:00.000Z';
const STALE = '2026-10-27T11:50:00.000Z';
const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rpId: 'localhost', allowCredentials: [] } };
const ASSERTION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30', userHandle: 'dQ' }, clientExtensionResults: {} };

const STUDIO = '11111111-bbbb-4bbb-8bbb-111111111111';
const HADDAD = '22222222-bbbb-4bbb-8bbb-222222222222';
const RANA = '33333333-bbbb-4bbb-8bbb-333333333333';
const OMAR = '44444444-bbbb-4bbb-8bbb-444444444444';
const LAYLA = '55555555-bbbb-4bbb-8bbb-555555555555';

const operator = (locale: 'en' | 'ar' = 'en'): Me => {
  const account = me([profile()], locale);
  return { ...account, user: { ...account.user, operator: true } };
};

const owned: FirmRequest = { organizationId: STUDIO, name: 'Studio Saleh', requestedAt: '2026-10-26T12:00:00.000Z', requestedByUserId: RANA, requestedByEmail: 'rana@studio.example', owned: true };
const firm: FirmRequest = { organizationId: HADDAD, name: 'Haddad & Co', requestedAt: '2026-10-27T09:00:00.000Z', requestedByUserId: OMAR, requestedByEmail: 'omar@haddad.example', owned: false };
const member = (userId: string, email: string, displayName: string, overrides: Partial<OperatorFirmRequestDetail['members'][number]> = {}) => ({ userId, email, displayName, role: 'BOOKKEEPER' as const, status: 'ACTIVE' as const, ...overrides });
const details: Record<string, Omit<OperatorFirmRequestDetail, 'stepUpUntil'>> = {
  [STUDIO]: { request: owned, members: [member(RANA, 'rana@studio.example', 'Rana Saleh', { role: 'OWNER' })] },
  [HADDAD]: {
    request: firm,
    members: [member(OMAR, 'omar@haddad.example', 'Omar Haddad'), member(RANA, 'rana@studio.example', 'Rana Saleh'), member(LAYLA, 'layla@haddad.example', 'Layla Haddad', { status: 'DISABLED' })],
  },
};

const plain = (text: string | null | undefined) => (text ?? '').replace(/[⁨⁩]/g, '');
const sentence = (expected: string) => (_: string, element: Element | null) => element?.tagName === 'P' && plain(element.textContent) === expected;
const toasted = async (expected: string) => waitFor(() => expect(plain(screen.getByTestId('toast-live').textContent)).toContain(expected));

function portal({ me: who = operator(), requests = [owned, firm], stepUpUntil = FRESH as string | null, extra = {} as Record<string, Handler> } = {}) {
  let pending = requests;
  const decide = (id: string) => () => {
    pending = pending.filter((r) => r.organizationId !== id);
    return ok({ organization: { id } });
  };
  const api = stubApi({
    'GET /v1/me': () => ok(who),
    'GET /v1/operator/signup-reviews': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/firm-requests': () => ok({ data: pending, nextCursor: null, stepUpUntil }),
    ...Object.fromEntries(Object.entries(details).map(([id, detail]) => [`GET /v1/operator/firm-requests/${id}`, () => ok({ ...detail, stepUpUntil })])),
    ...Object.fromEntries(requests.flatMap((r) => [[`POST /v1/operator/firm-requests/${r.organizationId}/enable`, decide(r.organizationId)], [`POST /v1/operator/firm-requests/${r.organizationId}/decline`, decide(r.organizationId)]])),
    'POST /v1/operator/step-up/options': () => ok(CHALLENGE),
    'POST /v1/operator/step-up': () => ok({ stepUpUntil: FRESH }),
    ...extra,
  });
  return { ...renderPortal('/operator/firms'), api };
}

const list = async () => within(await screen.findByRole('list', { name: 'Firm requests' }));
const rowOf = async (name: string) => within((await list()).getByRole('listitem', { name }));
const sentBody = (api: ReturnType<typeof portal>['api'], path: string) => api.calls.find((c) => c.method === 'POST' && c.url.pathname === path)?.body;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the Firms tab (design 16A)', () => {
  it('lists pending requests oldest first, with who asked and how long ago, and counts them in the tab', async () => {
    portal();
    expect(await screen.findByRole('link', { name: 'Firms · 2' })).toHaveAttribute('aria-current', 'page');
    const rows = (await list()).getAllByRole('listitem');
    expect(rows.map((r) => r.getAttribute('aria-label'))).toEqual(['Studio Saleh', 'Haddad & Co']);
    const first = within(rows[0]!);
    expect(first.getByText('rana@studio.example')).toHaveAttribute('dir', 'ltr');
    expect(first.getByText(/1 day ago/)).toBeInTheDocument();
    expect(first.getByText('Their own business profile')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Firm with members')).toBeInTheDocument();
  });

  it('says so when nothing waits', async () => {
    portal({ requests: [] });
    expect(await screen.findByRole('heading', { name: 'No firm requests' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Firms' })).toBeInTheDocument();
  });
});

describe('enabling a request (AC1, AC2)', () => {
  it('an operator firm names its owners: the requester ticked, a disabled member inert with the reason', async () => {
    const { user, api } = portal();
    await user.click((await rowOf('Haddad & Co')).getByRole('button', { name: 'Enable' }));
    const owners = within(await screen.findByRole('group', { name: 'Owners' }));
    expect(owners.getByRole('checkbox', { name: /omar@haddad\.example/ })).toBeChecked();
    expect(owners.getByRole('checkbox', { name: /rana@studio\.example/ })).not.toBeChecked();
    expect(owners.getByRole('checkbox', { name: /layla@haddad\.example/ })).toBeDisabled();
    expect(owners.getByText("Disabled: can't be an owner")).toBeInTheDocument();
    await user.click(owners.getByRole('checkbox', { name: /rana@studio\.example/ }));
    expect(screen.getByText(sentence('Haddad & Co gets firm features. Owners: omar@haddad.example, rana@studio.example. Everyone else becomes a bookkeeper.'))).toBeInTheDocument();
    await user.click((await rowOf('Haddad & Co')).getByRole('button', { name: 'Enable' }));
    await toasted('Firm features on for Haddad & Co');
    expect(sentBody(api, `/v1/operator/firm-requests/${HADDAD}/enable`)).toEqual({ ownerUserIds: [OMAR, RANA] });
    await waitFor(() => expect((screen.getByRole('list', { name: 'Firm requests' }).querySelectorAll('li'))).toHaveLength(1));
  });

  it('refuses to send with no owner ticked, and says why', async () => {
    const { user, api } = portal();
    await user.click((await rowOf('Haddad & Co')).getByRole('button', { name: 'Enable' }));
    await user.click(within(await screen.findByRole('group', { name: 'Owners' })).getByRole('checkbox', { name: /omar@haddad\.example/ }));
    await user.click((await rowOf('Haddad & Co')).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText('Choose at least one owner.')).toBeInTheDocument();
    expect(api.count(`POST /v1/operator/firm-requests/${HADDAD}/enable`)).toBe(0);
  });

  it('an owned business profile keeps its owners: no picker, and none are sent', async () => {
    const { user, api } = portal();
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Enable' }));
    expect(await screen.findByText(sentence('Studio Saleh gets firm features. rana@studio.example stay its owners; everyone else becomes a bookkeeper.'))).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Owners' })).toBeNull();
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Enable' }));
    await toasted('Firm features on for Studio Saleh');
    expect(sentBody(api, `/v1/operator/firm-requests/${STUDIO}/enable`)).toEqual({ ownerUserIds: [] });
  });

  it('a stale step-up says "Enable with passkey" and runs the passkey sheet on the same tap', async () => {
    const { user } = portal({ stepUpUntil: STALE });
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Enable' }));
    await user.click(await screen.findByRole('button', { name: 'Enable with passkey' }));
    await toasted('Firm features on for Studio Saleh');
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
  });

  it('a request decided elsewhere (404) leaves the list', async () => {
    // Someone else decided it: the detail answers 404, and the list read after it no longer has it.
    let reads = 0;
    const { user } = portal({
      extra: {
        [`GET /v1/operator/firm-requests/${STUDIO}`]: () => fail(404, 'NOT_FOUND', { reason: 'FIRM_REQUEST_NOT_FOUND' }),
        'GET /v1/operator/firm-requests': () => ok({ data: (reads += 1) === 1 ? [owned, firm] : [firm], nextCursor: null, stepUpUntil: FRESH }),
      },
    });
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(screen.queryByRole('listitem', { name: 'Studio Saleh' })).toBeNull());
  });
});

describe('declining a request', () => {
  it('confirms in the row with what follows; Cancel puts the row back with Decline focused; confirming declines', async () => {
    const { user, api } = portal();
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Decline' }));
    expect(screen.getByText(sentence('Studio Saleh stays a regular profile. Its owner can ask again.'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect((screen.getByRole('listitem', { name: 'Studio Saleh' }).querySelector('.hp-danger'))).toHaveFocus());
    await user.click((await rowOf('Studio Saleh')).getByRole('button', { name: 'Decline' }));
    await user.click(within(screen.getByRole('group')).getByRole('button', { name: 'Decline' }));
    await toasted('Request for Studio Saleh declined');
    expect(api.count(`POST /v1/operator/firm-requests/${STUDIO}/decline`)).toBe(1);
  });
});

describe('Arabic', () => {
  it('reads Arabic by default, right to left, with the tab المكاتب', async () => {
    localStorage.clear();
    portal({ me: operator('ar') });
    expect(await screen.findByRole('link', { name: 'المكاتب · 2' })).toHaveAttribute('aria-current', 'page');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(within((await screen.findAllByRole('listitem'))[0]!).getByRole('button', { name: 'تفعيل' })).toBeInTheDocument();
  });
});
