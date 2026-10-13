import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { downloadNavigator } from '../../data/download';
import {
  C1,
  C2,
  CUSTOMERS,
  PROJECTS,
  RECEIVABLES,
  attachment,
  organizationSummary,
  page,
  payment,
} from './fixtures';

/** hosted-portal.md §7.3–§7.5 and the MUT-43 test plan §6–§7. */

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
});
afterEach(() => vi.unstubAllGlobals());

function portal(path: string, routes: Record<string, Handler> = {}, profiles = [profile()]) {
  const api = stubApi({
    'GET /v1/me': () => ok(me(profiles)),
    ...emptyProfileRoutes(),
    'GET /v1/customers': () => ok(page(CUSTOMERS)),
    'GET /v1/projects': () => ok(page(PROJECTS)),
    ...routes,
  });
  return { ...renderPortal(path), api };
}

const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);

describe('Overview', () => {
  it('shows the strip for the default currency and sorts overdue, outstanding, quiet, then name', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': () => ok(organizationSummary()) });
    const strip = await screen.findByRole('group', { name: 'ILS' });
    expect(strip).toHaveTextContent('Owed₪12,000.00');
    expect(strip).toHaveTextContent('Overdue₪2,000.00');
    expect(strip).toHaveTextContent('Proposed₪10,000.00');
    const names = rowsOf(screen.getByRole('table')).map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(names).toEqual(['Nablus Trading', 'Al-Quds Bakery', 'Zaytoun Co']);
    expect(screen.getByText('As of Oct 11, 2026')).toBeInTheDocument();
  });

  it('shows the currency switch only when more than one currency has a non-zero figure', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': () => ok(organizationSummary(false)) });
    await screen.findByRole('group', { name: 'ILS' });
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('switches currency through the URL, replacing history', async () => {
    const { user, router } = portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': () => ok(organizationSummary(true)) });
    await screen.findByRole('group', { name: 'ILS' });
    const before = router.history.length;
    await user.click(within(screen.getByRole('tablist')).getByRole('tab', { name: 'USD' }));
    expect(await screen.findByRole('group', { name: 'USD' })).toHaveTextContent('Owed$500.00');
    expect(locationOf(router)).toBe(`/p/${ORG_A}?currency=USD`);
    expect(router.history.length).toBe(before);
  });

  it('has loading, empty and error states with no figure', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': never });
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    expect(document.body.textContent).not.toContain('₪');
  });

  it('says so when the profile has no money yet', async () => {
    portal(`/p/${ORG_A}`, { 'GET /v1/summaries/organization': () => ok({ asOf: '2026-10-11', currencies: [] }) });
    expect(await screen.findByText('No money recorded on this profile yet')).toBeInTheDocument();
  });

  it('never shows a stale figure after a failed refetch', async () => {
    let healthy = true;
    const { queryClient } = portal(`/p/${ORG_A}`, {
      'GET /v1/summaries/organization': () => (healthy ? ok(organizationSummary()) : fail(503, 'INTERNAL')),
    });
    await screen.findByText('₪12,000.00');
    healthy = false;
    await act(() => queryClient.refetchQueries({ queryKey: ['p'] }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach Mutaba3a right now");
    expect(document.body.textContent).not.toContain('12,000');
  });
});

describe('Clients', () => {
  it('lists clients with their figures and filters by name', async () => {
    const { user } = portal(`/p/${ORG_A}/clients`, { 'GET /v1/summaries/organization': () => ok(organizationSummary()) });
    const table = await screen.findByRole('table', { name: 'Clients' });
    expect(rowsOf(table)).toHaveLength(3);
    expect(within(table).getByText('₪9,000.00')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('Search clients'), 'quds');
    await waitFor(() => expect(rowsOf(screen.getByRole('table', { name: 'Clients' }))).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'Al-Quds Bakery' })).toHaveAttribute('href', `/p/${ORG_A}/clients/${C1}`);
  });

  it('has an empty state', async () => {
    portal(`/p/${ORG_A}/clients`, { 'GET /v1/customers': () => ok(page([])) });
    expect(await screen.findByText('No clients on this profile yet')).toBeInTheDocument();
  });
});

describe('Client detail', () => {
  function summary() {
    return {
      customerId: C1,
      asOf: '2026-10-11',
      lastPaymentOn: '2026-10-01',
      currencies: [
        {
          currency: 'ILS',
          outstanding: '9000.00',
          overdue: '0.00',
          dueToday: '0.00',
          notYetDue: '9000.00',
          unallocated: '0.00',
          status: 'OUTSTANDING',
          projects: [
            {
              projectId: '00000000-0000-4000-8000-000000000001',
              currency: 'ILS',
              kind: 'FIXED',
              agreed: '20000.00',
              monthly: null,
              posted: '11000.00',
              paid: '2000.00',
              credited: '0.00',
              outstanding: '9000.00',
              overdue: '0.00',
              dueToday: '0.00',
              notYetDue: '9000.00',
              pending: { count: 1, amount: '9000.00' },
              status: 'OUTSTANDING',
              proposal: null,
            },
          ],
        },
      ],
    };
  }

  it('shows the per-currency summary and the matters', async () => {
    portal(`/p/${ORG_A}/clients/${C1}`, {
      'GET /v1/customers/c1111111-1111-4111-8111-111111111111': () => ok(CUSTOMERS[0]),
      'GET /v1/summaries/customers/c1111111-1111-4111-8111-111111111111': () => ok(summary()),
      'GET /v1/projects': () => ok(page([{ ...PROJECTS[0], id: '00000000-0000-4000-8000-000000000001' }])),
    });
    expect(await screen.findByRole('heading', { name: 'Al-Quds Bakery' })).toBeInTheDocument();
    expect(await screen.findByText('Last payment: Oct 1, 2026')).toBeInTheDocument();
    const matters = screen.getByRole('table', { name: 'Matters' });
    expect(within(matters).getByText('Lease dispute')).toBeInTheDocument();
    expect(within(matters).getByText('₪20,000.00')).toBeInTheDocument();
  });

  it('shows the receivables tab filtered to this client, with the read-only notice', async () => {
    const { user, api } = portal(`/p/${ORG_A}/clients/${C1}`, {
      'GET /v1/customers/c1111111-1111-4111-8111-111111111111': () => ok(CUSTOMERS[0]),
      'GET /v1/summaries/customers/c1111111-1111-4111-8111-111111111111': () => ok(summary()),
      'GET /v1/receivables': () => ok(page([RECEIVABLES[0]])),
    });
    await user.click(await screen.findByRole('tab', { name: 'Receivables' }));
    await screen.findByRole('table', { name: 'Receivables' });
    expect(api.calls.some((c) => c.url.pathname === '/v1/receivables' && c.url.searchParams.get('customerId') === C1)).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent('Malafat records income and payments for this profile.');
  });

  it('says the client is not on this profile on a 404', async () => {
    portal(`/p/${ORG_A}/clients/${C2}`, {
      'GET /v1/customers/c2222222-2222-4222-8222-222222222222': () => fail(404, 'NOT_FOUND'),
      'GET /v1/summaries/customers/c2222222-2222-4222-8222-222222222222': () => fail(404, 'NOT_FOUND'),
    });
    expect(await screen.findByText("This client isn't on this profile")).toBeInTheDocument();
  });
});

describe('Receivables', () => {
  it('shows pre-shaped rows with names, dates, amounts and status words', async () => {
    portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(RECEIVABLES)) });
    const table = await screen.findByRole('table', { name: 'Receivables' });
    const first = within(rowsOf(table)[0]);
    expect(first.getByText('Al-Quds Bakery')).toBeInTheDocument();
    expect(first.getByText('Lease dispute')).toBeInTheDocument();
    expect(first.getByText('Oct 1, 2026')).toBeInTheDocument();
    expect(first.getAllByText('₪1,170.00')).toHaveLength(2);
    expect(first.getByText('Overdue')).toBeInTheDocument();
    expect(within(rowsOf(table)[1]).getByText('Partly paid')).toBeInTheDocument();
  });

  it('explains the read-only reason and offers no edit affordance', async () => {
    portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(RECEIVABLES)) });
    await screen.findByRole('table', { name: 'Receivables' });
    expect(screen.getByRole('note')).toHaveTextContent('Malafat records income and payments for this profile. To change them, use Malafat.');
    const actionable = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(actionable.filter((label) => /\b(record|edit|add|new|mark|delete|pay)\b|payment/i.test(label))).toEqual([]);
  });

  it('gives the expenses-only reason on a profile Malafat does not feed', async () => {
    portal(`/p/${ORG_A}/receivables`, {}, [profile({ writerOfRecord: null })]);
    expect(await screen.findByRole('note')).toHaveTextContent("Income isn't recorded on hosted profiles yet. This profile is for expenses.");
  });

  it('says income comes from the phone app on the signed-in user\'s own personal profile (MUT-93)', async () => {
    portal(`/p/${ORG_A}/receivables`, {}, [
      profile({ writerOfRecord: null, isPersonalDefault: true, access: { payments: 'read-write', expenses: 'read-write' } }),
    ]);
    // access.payments is read-write post-MUT-65, which would otherwise hide
    // the notice entirely (the portal still has no Record payment button)
    expect(await screen.findByRole('note')).toHaveTextContent('Income on this profile is recorded from the phone app. This view is read-only.');
    const actionable = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(actionable.filter((label) => /\b(record|edit|add|new|mark|delete|pay)\b|payment/i.test(label))).toEqual([]);
  });

  it('keeps one filters object in the URL, replaces history, and refetches with the matching params', async () => {
    const { user, router, api } = portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(RECEIVABLES)) });
    await screen.findByRole('table', { name: 'Receivables' });
    const before = router.history.length;
    await user.click(screen.getByRole('tab', { name: 'Settled' }));
    await user.selectOptions(screen.getByLabelText('Client'), C2);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables?status=SETTLED&customerId=${C2}`));
    expect(router.history.length).toBe(before);
    await waitFor(() =>
      expect(api.calls.some((c) => c.url.pathname === '/v1/receivables' && c.url.searchParams.get('status') === 'SETTLED' && c.url.searchParams.get('customerId') === C2)).toBe(true),
    );
  });

  it('defaults to open receivables', async () => {
    const { api } = portal(`/p/${ORG_A}/receivables`);
    expect(await screen.findByText('Nothing is owed on this profile right now')).toBeInTheDocument();
    expect(api.calls.find((c) => c.url.pathname === '/v1/receivables')?.url.searchParams.get('status')).toBe('OPEN');
  });

  it('tells "nothing matches" apart from "nothing yet", and clears filters', async () => {
    const { user, router } = portal(`/p/${ORG_A}/receivables?currency=USD`);
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables`));
  });

  it('loads the next page by cursor', async () => {
    const { user, api } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': ({ url }) => ok(url.searchParams.get('cursor') ? page([RECEIVABLES[1]]) : page([RECEIVABLES[0]], 'next-1')),
    });
    await screen.findByRole('table', { name: 'Receivables' });
    await user.click(screen.getByRole('button', { name: 'Show more' }));
    await waitFor(() => expect(rowsOf(screen.getByRole('table', { name: 'Receivables' }))).toHaveLength(2));
    expect(api.calls.some((c) => c.url.searchParams.get('cursor') === 'next-1')).toBe(true);
  });
});

describe('Payments', () => {
  it('shows payments and expands one to where it went', async () => {
    const { user } = portal(`/p/${ORG_A}/payments`, { 'GET /v1/payments': () => ok(page([payment('e1111111-1111-4111-8111-111111111111', 'PAY-0007')])) });
    const table = await screen.findByRole('table', { name: 'Payments' });
    const row = within(rowsOf(table)[0]);
    expect(row.getByText('PAY-0007')).toBeInTheDocument();
    expect(row.getByText('Bank transfer')).toBeInTheDocument();
    expect(row.getByText('Recorded')).toBeInTheDocument();
    await user.click(row.getByRole('button', { name: 'Show where this payment went' }));
    const detail = screen.getByRole('table', { name: 'Applied to' });
    expect(within(detail).getByText('Lease dispute')).toBeInTheDocument();
    expect(within(detail).getAllByText('₪585.00')).toHaveLength(2);
    expect(screen.getByRole('note')).toBeInTheDocument();
  });
});

describe('Documents', () => {
  it('downloads through a signed URL, with no inline preview', async () => {
    const open = vi.spyOn(downloadNavigator, 'open').mockImplementation(() => {});
    const { user, container } = portal(`/p/${ORG_A}/documents`, {
      'GET /v1/attachments': () => ok(page([attachment('f1111111-1111-4111-8111-111111111111', 'invoice-014.pdf'), attachment('f2222222-2222-4222-8222-222222222222', 'pending.pdf', 'PENDING_UPLOAD')])),
      'GET /v1/attachments/f1111111-1111-4111-8111-111111111111/download': () =>
        ok({ url: 'https://storage.googleapis.com/signed/invoice-014.pdf?X-Goog-Signature=abc', expiresAt: '2026-10-11T10:15:00Z', filename: 'invoice-014.pdf', mimeType: 'application/pdf' }),
    });
    await screen.findByRole('table', { name: 'Documents' });
    expect(screen.getByText('Still uploading')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download invoice-014.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.googleapis.com/signed/invoice-014.pdf?X-Goog-Signature=abc'));
    // The shell's Brand v2 mark (MUT-104) is the only image allowed on the page
    expect(container.querySelector('iframe, object, embed, img:not(.hp-wordmark-mark)')).toBeNull();
  });

  it('toasts when the download cannot be prepared', async () => {
    vi.spyOn(downloadNavigator, 'open').mockImplementation(() => {});
    const { user } = portal(`/p/${ORG_A}/documents`, {
      'GET /v1/attachments': () => ok(page([attachment('f1111111-1111-4111-8111-111111111111', 'invoice-014.pdf')])),
      'GET /v1/attachments/f1111111-1111-4111-8111-111111111111/download': () => fail(503, 'ATTACHMENTS_NOT_CONFIGURED'),
    });
    await user.click(await screen.findByRole('button', { name: 'Download invoice-014.pdf' }));
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't prepare the download. Try again.");
  });
});

describe('Profile switcher', () => {
  const both = [profile(), profile({ id: ORG_B, name: 'Nour — personal', writerOfRecord: null })];

  it('shows each profile with its Hosted chip and source, and says where local profiles live', async () => {
    const { user } = portal(`/p/${ORG_A}`, {}, both);
    await user.click(await screen.findByRole('button', { name: 'Switch profile: Haddad & Partners' }));
    const menu = screen.getByRole('menu', { name: 'Switch profile' });
    const [first, second] = within(menu).getAllByRole('menuitemradio');
    expect(first).toHaveAttribute('aria-checked', 'true');
    expect(first).toHaveTextContent('Haddad & PartnersHostedIncome recorded by Malafat');
    expect(second).toHaveTextContent('Nour — personalHostedExpenses only');
    expect(menu).toHaveTextContent('Your local profiles stay in the Mutaba3a app on your device.');
  });

  it('keeps the section, sends the new profile header, and never shows the old figures', async () => {
    const { user, router, api } = portal(
      `/p/${ORG_A}/receivables`,
      { 'GET /v1/receivables': ({ headers }) => (headers.get('x-mutaba3a-profile') === ORG_A ? ok(page(RECEIVABLES)) : never()) },
      both,
    );
    const before = await screen.findByRole('table', { name: 'Receivables' });
    expect(within(before).getByText('Lease dispute')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Switch profile/ }));
    await user.click(screen.getByRole('menuitemradio', { name: /Nour — personal/ }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_B}/receivables`));
    expect(await screen.findByLabelText('Loading')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Receivables' })).toBeNull();
    expect(document.body.textContent).not.toContain('1,170.00');
    expect(api.calls.some((c) => c.url.pathname === '/v1/receivables' && c.headers.get('x-mutaba3a-profile') === ORG_B)).toBe(true);
  });
});
