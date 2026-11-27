import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { Me, OperatorAccountUsage, OperatorUsageOverview, OperatorUsagePeople, OperatorUsageRoutes } from '../../../api/client';
import { fail, me, ok, profile, renderPortal, stubApi, type Handler } from '../../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { operatorUsageOverviewKey, operatorUsagePeopleKey } from '../../../data/operatorUsageQueries';
import { usageMonths } from '../../../operator/usageMonths';

/**
 * MUT-735 (ADR-281): Operator › Usage and the account page's Usage section. The server is stubbed; the passkey sheet is
 * the browser's, so @simplewebauthn/browser is replaced. Numbers sit in <bdi>.
 */
const browser = vi.hoisted(() => ({ startAuthentication: vi.fn(), saved: [] as Array<{ name: string }> }));
vi.mock('@simplewebauthn/browser', async (importOriginal) => {
  const real = await importOriginal<typeof import('@simplewebauthn/browser')>();
  return { ...real, startAuthentication: browser.startAuthentication, browserSupportsWebAuthn: () => true, browserSupportsWebAuthnAutofill: async () => false };
});
vi.mock('../../../data/download', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../data/download')>();
  return { ...real, saveBlobAs: (_: Blob, name: string) => void browser.saved.push({ name }) };
});

const NOW = new Date('2026-11-25T12:00:00.000Z');
const FRESH = '2026-11-25T12:08:00.000Z';
const STALE = '2026-11-25T11:50:00.000Z';
const CHALLENGE = { challengeId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', publicKey: { challenge: 'abc', rpId: 'localhost', allowCredentials: [] } };
const ASSERTION = { id: 'cred', rawId: 'cred', type: 'public-key', response: { clientDataJSON: 'e30', authenticatorData: 'e30', signature: 'e30', userHandle: 'dQ' }, clientExtensionResults: {} };
const RANA = '33333333-aaaa-4aaa-8aaa-333333333333';

const operator = (locale: 'en' | 'ar' = 'en'): Me => {
  const account = me([profile()], locale);
  return { ...account, user: { ...account.user, operator: true } };
};

const overview = (stepUpUntil: string | null = FRESH): OperatorUsageOverview => ({
  month: '2026-11',
  plans: [
    { plan: 'business', payers: 1, near: 0, capped: 0, over: 0, kinds: [{ kind: 'SCAN', events: 3, payers: 1 }] },
    { plan: 'solo', payers: 2, near: 1, capped: 1, over: 0, kinds: [{ kind: 'DOCUMENT_ISSUED', events: 91, payers: 2 }] },
  ],
  stepUpUntil,
});
const people: OperatorUsagePeople = {
  month: '2026-11',
  items: [
    {
      subjectKey: `user:${RANA}`,
      userId: RANA,
      email: 'rana@studio.example',
      name: 'Rana Saleh',
      plan: 'solo',
      meters: [
        { meter: 'documents', used: 41, limit: 50, level: 'near' },
        { meter: 'scans', used: 3, limit: 100, level: 'ok' },
      ],
    },
  ],
  nextCursor: null,
  stepUpUntil: FRESH,
};
const routes: OperatorUsageRoutes = {
  from: '2026-11-19',
  to: '2026-11-25',
  routes: [{ routeKey: 'POST /v1/issued-documents', count: 20, clientErrors: 1, serverErrors: 0, meanMs: 83, p95Ms: 250, p95Over: false }],
  stepUpUntil: FRESH,
};

function portal({ path = '/operator/usage', extra = {} as Record<string, Handler>, stepUpUntil = FRESH as string | null } = {}) {
  const api = stubApi({
    'GET /v1/me': () => ok(operator()),
    'GET /v1/operator/signup-reviews': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/firm-requests': () => ok({ data: [], nextCursor: null, stepUpUntil }),
    'GET /v1/operator/usage/overview': (req) => ok(req.url.searchParams.get('month') === '2026-10' ? { ...overview(stepUpUntil), month: '2026-10', plans: [] } : overview(stepUpUntil)),
    'GET /v1/operator/usage/people': () => ok(people),
    'GET /v1/operator/usage/routes': () => ok(routes),
    'GET /v1/operator/usage/export.csv': () => new Response('﻿month,plan\r\n', { status: 200, headers: { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="usage-overview-2026-11.csv"' } }),
    'POST /v1/operator/step-up/options': () => ok(CHALLENGE),
    'POST /v1/operator/step-up': () => ok({ stepUpUntil: FRESH }),
    ...extra,
  });
  return { ...renderPortal(path), api };
}

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  vi.stubGlobal('__PASSKEY_RP_ID__', 'localhost');
  browser.startAuthentication.mockReset().mockResolvedValue(ASSERTION);
  browser.saved.length = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Operator › Usage (MUT-735)', () => {
  it('is a tab of the console; by plan it shows payers, who is near or at a cap, and events per kind', async () => {
    const { api } = portal();
    expect(await screen.findByRole('link', { name: 'Usage' })).toHaveAttribute('aria-current', 'page');
    const plans = within(await screen.findByRole('list', { name: 'Usage by plan' }));
    const solo = within(plans.getByRole('listitem', { name: 'Solo' }));
    expect(solo.getByText(/Payers: 2/)).toBeInTheDocument();
    expect(solo.getByText(/near a cap: 1/)).toBeInTheDocument();
    expect(solo.getByText(/at a cap: 1/)).toBeInTheDocument();
    expect(solo.getByText('91').tagName).toBe('BDI');
    expect(api.calls.find((c) => c.url.pathname === '/v1/operator/usage/overview')?.url.searchParams.get('month')).toBe('2026-11');
  });

  it('switching the month reads that month; an empty month says so', async () => {
    const { user, api } = portal();
    await screen.findByRole('list', { name: 'Usage by plan' });
    await user.selectOptions(screen.getByLabelText('Month'), '2026-10');
    expect(await screen.findByRole('heading', { name: 'No usage this month' })).toBeInTheDocument();
    expect(api.calls.filter((c) => c.url.pathname === '/v1/operator/usage/overview').map((c) => c.url.searchParams.get('month'))).toEqual(['2026-11', '2026-10']);
  });

  it('People lists who is near a cap, with their meters and levels, each opening their account', async () => {
    const { user, api } = portal();
    await user.click(await screen.findByRole('radio', { name: 'People' }));
    const row = within(await screen.findByRole('listitem', { name: 'Rana Saleh' }));
    expect(row.getByText('rana@studio.example')).toHaveAttribute('dir', 'ltr');
    expect(row.getByText('41 / 50')).toBeInTheDocument();
    expect(row.getByText('80%')).toBeInTheDocument();
    expect(row.getByRole('link')).toHaveAttribute('href', `/operator/accounts/${RANA}`);
    expect(api.calls.find((c) => c.url.pathname === '/v1/operator/usage/people')?.url.searchParams.get('filter')).toBe('near');
    await user.click(screen.getByRole('radio', { name: 'Everyone' }));
    await waitFor(() => expect(api.calls.filter((c) => c.url.pathname === '/v1/operator/usage/people').at(-1)?.url.searchParams.get('filter')).toBeNull());
  });

  it('Routes lists the busiest routes with errors and p95', async () => {
    const { user } = portal();
    await user.click(await screen.findByRole('radio', { name: 'Routes' }));
    const row = within(await screen.findByRole('listitem', { name: 'POST /v1/issued-documents' }));
    expect(row.getByText(/Requests: 20/)).toBeInTheDocument();
    expect(row.getByText(/p95 ≤ 250 ms/)).toBeInTheDocument();
  });

  it('Export CSV downloads the view; with the step-up lapsed it asks for the passkey first', async () => {
    const { user, api } = portal({ stepUpUntil: STALE });
    await screen.findByRole('list', { name: 'Usage by plan' });
    await user.click(screen.getByRole('button', { name: 'Export CSV with passkey' }));
    await waitFor(() => expect(browser.saved).toEqual([{ name: 'usage-overview-2026-11.csv' }]));
    expect(browser.startAuthentication).toHaveBeenCalledTimes(1);
    expect(api.count('POST /v1/operator/step-up')).toBe(1);
    expect(api.calls.find((c) => c.url.pathname === '/v1/operator/usage/export.csv')?.url.searchParams.get('view')).toBe('overview');
  });

  it('a refused export (not the step-up) says it failed', async () => {
    const { user } = portal({ extra: { 'GET /v1/operator/usage/export.csv': () => fail(500, 'INTERNAL') } });
    await screen.findByRole('list', { name: 'Usage by plan' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('opens in Arabic, right to left, with the tab named الاستخدام', async () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    stubApi({
      'GET /v1/me': () => ok(operator('ar')),
      'GET /v1/operator/signup-reviews': () => ok({ data: [], nextCursor: null, stepUpUntil: FRESH }),
      'GET /v1/operator/firm-requests': () => ok({ data: [], nextCursor: null, stepUpUntil: FRESH }),
      'GET /v1/operator/usage/overview': () => ok(overview()),
    });
    renderPortal('/operator/usage');
    expect(await screen.findByRole('link', { name: 'الاستخدام' })).toBeInTheDocument();
    expect(await screen.findByRole('listitem', { name: 'مستقل' })).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('keys name the month and the filter', () => {
    expect(operatorUsageOverviewKey('2026-11')).toContain('2026-11');
    expect(operatorUsageOverviewKey(undefined)).toContain('this');
    expect(operatorUsagePeopleKey('2026-11', 'near')).toEqual(['operator', 'usage', 'people', '2026-11', 'near']);
  });

  it('the month list is this Jerusalem month and the eleven before it', () => {
    // 22:30 UTC on 30 Nov is already 1 December in Jerusalem.
    expect(usageMonths(new Date('2026-11-30T22:30:00Z')).slice(0, 2)).toEqual(['2026-12', '2026-11']);
    expect(usageMonths(NOW)).toHaveLength(12);
  });
});

const accountUsage: OperatorAccountUsage = {
  months: ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'].map((month, i) => ({
    month,
    plan: i === 5 ? 'solo' : 'none',
    meters:
      i === 5
        ? [
            { meter: 'documents', used: 41, limit: 50, level: 'near' },
            { meter: 'scans', used: 3, limit: 100, level: 'ok' },
          ]
        : [
            { meter: 'documents', used: 0, limit: null, level: 'ok' },
            { meter: 'scans', used: 0, limit: null, level: 'ok' },
          ],
  })),
  profiles: [{ organizationId: '44444444-aaaa-4aaa-8aaa-444444444444', name: 'Rana’s studio', months: [{ month: '2026-11', documents: 41, scans: 3, other: 0 }] }],
  stepUpUntil: FRESH,
};

describe('the account page’s Usage section (MUT-735)', () => {
  it('shows six months, newest first, against each month’s plan; no cap says so; and each profile this month', async () => {
    const account = { id: RANA, email: 'rana@studio.example', displayName: 'Rana Saleh', locale: 'en', status: 'ACTIVE', passwordChangedAt: NOW.toISOString(), lastSignInAt: null, createdAt: NOW.toISOString(), closing: false, operator: false, operatorSince: null, passkeyCount: 1, passkeyLastUsedAt: null, features: [], activeSessionCount: 0, agentGrantCount: 0, availableFeatures: [], profiles: [], signupDomain: null, planHistory: [] };
    portal({
      path: `/operator/accounts/${RANA}`,
      extra: {
        [`GET /v1/operator/accounts/${RANA}`]: () => ok({ account, stepUpUntil: FRESH }),
        [`GET /v1/operator/accounts/${RANA}/billing-grants`]: () => ok({ grants: [], stepUpUntil: FRESH }),
        [`GET /v1/operator/accounts/${RANA}/usage`]: () => ok(accountUsage),
      },
    });
    const section = within(await screen.findByRole('region', { name: 'Usage' }));
    const months = await section.findAllByText(/·/, { selector: '.hp-you-row-label' });
    expect(months).toHaveLength(6);
    expect(months[0]).toHaveTextContent('November · Solo');
    expect(section.getByText('41 / 50')).toBeInTheDocument();
    expect(section.getAllByText(/no cap/)).toHaveLength(10);
    expect(section.getByText('This month: 41 documents, 3 scans')).toBeInTheDocument();
  });
});
