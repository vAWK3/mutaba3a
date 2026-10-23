import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { ORG_A, ORG_B, emptyProfileRoutes, fail, locationOf, me, never, ok, profile, renderPortal, stubApi, type Handler } from '../../__tests__/harness';
import { PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { downloadNavigator } from '../../data/download';
import {
  C1,
  C2,
  CUSTOMERS,
  P1,
  P2,
  PROJECTS,
  R1,
  R2,
  RECEIVABLES,
  attachment,
  organizationSummary,
  page,
  payment,
  receivable,
} from './fixtures';
import { SLOW_UNDER_COVERAGE } from '../../../test/timeouts';

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
    expect(await screen.findByRole('alert')).toHaveTextContent("Can't reach MTB3A right now");
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

  it('keeps the phone-app sentence, reworded, for a personal profile whose rules offer no income writes (MUT-93 fallback)', async () => {
    portal(`/p/${ORG_A}/receivables`, {}, [
      profile({ writerOfRecord: null, isPersonalDefault: true, owned: true, type: 'PERSONAL', access: { payments: 'read-write', expenses: 'read-write' } }),
    ]);
    // No capture access, so MUT-133 offers nothing here and the fallback copy stays.
    expect(await screen.findByRole('note')).toHaveTextContent('Income on this profile is recorded from the phone app.');
    expect(screen.getByRole('note')).not.toHaveTextContent('read-only');
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
    const open = vi.spyOn(downloadNavigator, 'open').mockImplementation(async () => {});
    const { user, container } = portal(`/p/${ORG_A}/documents`, {
      'GET /v1/attachments': () => ok(page([attachment('f1111111-1111-4111-8111-111111111111', 'invoice-014.pdf'), attachment('f2222222-2222-4222-8222-222222222222', 'pending.pdf', 'PENDING_UPLOAD')])),
      'GET /v1/attachments/f1111111-1111-4111-8111-111111111111/download': () =>
        ok({ url: 'https://storage.googleapis.com/signed/invoice-014.pdf?X-Goog-Signature=abc', expiresAt: '2026-10-11T10:15:00Z', filename: 'invoice-014.pdf', mimeType: 'application/pdf' }),
    });
    await screen.findByRole('table', { name: 'Documents' });
    expect(screen.getByText('Still uploading')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Download invoice-014.pdf' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.googleapis.com/signed/invoice-014.pdf?X-Goog-Signature=abc', 'invoice-014.pdf'));
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
    expect(menu).toHaveTextContent('Your local profiles stay in the MTB3A app on your device.');
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

// ---------------------------------------------------------------- MUT-133

const PERSONAL = profile({
  writerOfRecord: null,
  isPersonalDefault: true,
  owned: true,
  type: 'PERSONAL',
  access: { payments: 'read-write', capture: 'read-write', expenses: 'read-write' },
  income: { received: true, owed: true, customer: 'optional' },
});
const WRITER_NULL_FIRM = { ...PERSONAL, isPersonalDefault: false, owned: false, type: null };
const adjustment = (id: string, customerId: string, projectId: string, outstanding: string, status: string) => ({
  ...receivable(id, customerId, projectId, outstanding, status),
  origin: 'ADJUSTMENT' as const,
});
const OPEN_OWED = [adjustment(R1, C1, P1, '1170.00', 'OVERDUE'), adjustment(R2, C2, P2, '585.00', 'PARTIALLY_PAID')];
const strip = (text: string | null) => (text ?? '').replace(/[\u2066-\u2069]/g, '');
const politeStatus = () => screen.getByTestId('toast-live');

describe('Income writes on a personal profile (MUT-133)', () => {
  it('drops the lock notice and offers Add income plus Record payment on open Owed rows only', async () => {
    const rows = [...OPEN_OWED, receivable('b3333333-3333-4333-8333-333333333333', C1, P1, '200.00', 'DUE')];
    portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(rows)) }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Receivables' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add income' })).toBeInTheDocument();
    const buttons = within(table).getAllByRole('button', { name: /Record payment/ });
    // The INSTALLMENT row (Malafat-posted) offers nothing: the settle route would answer 404.
    expect(buttons).toHaveLength(2);
    expect(buttons[0]).toHaveAccessibleName('Record payment for Al-Quds Bakery, remaining: ₪1,170.00');
    expect(within(table).getByRole('columnheader', { name: 'Actions' })).toHaveClass('hp-sticky-end');
  });

  it('treats a business profile the user created exactly like the personal one: no lock notice, Add income offered (MUT-182)', async () => {
    const business = { ...PERSONAL, isPersonalDefault: false, owned: true, type: 'BUSINESS' as const };
    portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(OPEN_OWED)) }, [business]);
    await screen.findByRole('table', { name: 'Receivables' });
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: '+ Add income' })).toBeInTheDocument();
  });

  it('opens Record payment through the URL without refetching the list, and closes the same way (R1)', async () => {
    const { user, router, api } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': () => ok(page(OPEN_OWED)),
      [`GET /v1/receivables/${R1}`]: () => ok(OPEN_OWED[0]),
    }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Receivables' });
    await user.click(within(table).getAllByRole('button', { name: /Record payment/ })[0]);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables?settle=${R1}`));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables`);
    expect(api.count('GET /v1/receivables')).toBe(1);
  });

  it('settles in full: the list re-reads without the row, the status says so, and focus moves to the next row (AC, A1)', async () => {
    let settled = false;
    const { user } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': () => ok(page(settled ? [OPEN_OWED[1]] : OPEN_OWED)),
      [`GET /v1/receivables/${R1}`]: () => ok(OPEN_OWED[0]),
      [`POST /v1/receivables/${R1}/settle`]: () => {
        settled = true;
        return ok({ receivable: { ...OPEN_OWED[0], status: 'PAID', outstanding: '0.00' }, payment: {} }, 201);
      },
    }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Receivables' });
    await user.click(within(table).getAllByRole('button', { name: /Record payment/ })[0]);
    await screen.findByLabelText('Amount (ILS)');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(screen.getByRole('table', { name: 'Receivables' })).queryByText('Al-Quds Bakery')).toBeNull());
    expect(strip(politeStatus().textContent)).toBe('Payment recorded · ₪1,170.00 from Al-Quds Bakery');
    expect(document.activeElement).toHaveAccessibleName('Record payment for Nablus Trading, remaining: ₪585.00');
  });

  it('settles in part: the row re-reads as partly paid and focus returns to its button', async () => {
    let paid = false;
    const partly = { ...OPEN_OWED[0], status: 'PARTIALLY_PAID', outstanding: '670.00', paid: '500.00' };
    const { user } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': () => ok(page(paid ? [partly, OPEN_OWED[1]] : OPEN_OWED)),
      [`GET /v1/receivables/${R1}`]: () => ok(OPEN_OWED[0]),
      [`POST /v1/receivables/${R1}/settle`]: () => {
        paid = true;
        return ok({ receivable: partly, payment: {} }, 201);
      },
    }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Receivables' });
    await user.click(within(table).getAllByRole('button', { name: /Record payment/ })[0]);
    const amount = await screen.findByLabelText('Amount (ILS)');
    await user.clear(amount);
    await user.type(amount, '500');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(within(rowsOf(screen.getByRole('table', { name: 'Receivables' }))[0]).getByText('Partly paid')).toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toHaveAccessibleName('Record payment for Al-Quds Bakery, remaining: ₪670.00'));
  });

  it('adds Owed from Receivables: the list re-reads and the new entry is announced', async () => {
    let added = false;
    const newRow = adjustment('b4444444-4444-4444-8444-444444444444', C1, P1, '300.00', 'PENDING');
    const { user, api } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': () => ok(page(added ? [...OPEN_OWED, newRow] : OPEN_OWED)),
      'POST /v1/income': () => {
        added = true;
        return ok({ id: newRow.id, kind: 'owed' }, 201);
      },
    }, [PERSONAL]);
    await screen.findByRole('table', { name: 'Receivables' });
    await user.click(screen.getByRole('button', { name: '+ Add income' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '300');
    await user.click(within(dialog).getByLabelText('Client'));
    await user.click(await screen.findByText('Al-Quds Bakery', { selector: '[role="option"] *, [role="option"]' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(rowsOf(screen.getByRole('table', { name: 'Receivables' }))).toHaveLength(3));
    expect(api.calls.find((c) => c.method === 'POST')!.body).toMatchObject({ kind: 'owed', amount: '300.00', customerId: C1 });
    expect(strip(politeStatus().textContent)).toBe('Saved · ₪300.00 owed by Al-Quds Bakery');
  });

  it('defaults Add income to Received on Payments, and offers it from the empty state too', async () => {
    const { user, router } = portal(`/p/${ORG_A}/payments`, {}, [PERSONAL]);
    expect(await screen.findByText('No payments recorded on this profile yet')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: '+ Add income' });
    expect(buttons).toHaveLength(2);
    await user.click(buttons[1]);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/payments?newIncome=received`));
    expect(await screen.findByLabelText('Client (optional)')).toBeInTheDocument();
  });

  it('returns focus to the header Add button after a save started from the empty state (review #4)', async () => {
    let added = false;
    const { user } = portal(`/p/${ORG_A}/payments`, {
      'GET /v1/payments': () => ok(page(added ? [payment('p1', 'PAY-2026-0001')] : [])),
      'POST /v1/income': () => {
        added = true;
        return ok({ id: 'i1', kind: 'received' }, 201);
      },
    }, [PERSONAL]);
    await screen.findByText('No payments recorded on this profile yet');
    await user.click(screen.getAllByRole('button', { name: '+ Add income' })[1]);
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Amount'), '250');
    await user.click(within(dialog).getByRole('button', { name: 'Save income' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(screen.queryByText('No payments recorded on this profile yet')).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Add income' }));
  });

  it('prefills the client on Client detail and records a payment from its Receivables tab', SLOW_UNDER_COVERAGE, async () => {
    const { user, router } = portal(`/p/${ORG_A}/clients/${C1}`, {
      [`GET /v1/customers/${C1}`]: () => ok(CUSTOMERS[0]),
      [`GET /v1/summaries/customers/${C1}`]: () => ok({ customerId: C1, lastPaymentOn: null, currencies: [] }),
      'GET /v1/receivables': () => ok(page([OPEN_OWED[0]])),
      [`GET /v1/receivables/${R1}`]: () => ok(OPEN_OWED[0]),
    }, [PERSONAL]);
    await user.click(await screen.findByRole('button', { name: '+ Add income' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Client')).toHaveValue('Al-Quds Bakery');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await user.click(screen.getByRole('tab', { name: 'Receivables' }));
    const table = await screen.findByRole('table', { name: 'Receivables' });
    await user.click(within(table).getByRole('button', { name: /Record payment/ }));
    await waitFor(() => expect(locationOf(router)).toContain(`settle=${R1}`));
    expect(await screen.findByLabelText('Amount (ILS)')).toHaveValue('1170.00');
  });
});

describe('Income writes stay off everywhere else (MUT-133 regression contract)', () => {
  for (const [label, who] of [
    ['a Malafat-fed profile', profile()],
    ['a writable profile that is not the user\'s personal one', WRITER_NULL_FIRM],
  ] as const) {
    it(`offers no button and no actions column on ${label}`, async () => {
      portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(OPEN_OWED)) }, [who]);
      const table = await screen.findByRole('table', { name: 'Receivables' });
      expect(screen.queryByRole('button', { name: '+ Add income' })).toBeNull();
      expect(within(table).queryByRole('columnheader', { name: 'Actions' })).toBeNull();
      expect(within(table).queryByRole('button', { name: /Record payment/ })).toBeNull();
    });

    it(`ignores ?newIncome= and ?settle= deep links on ${label}`, async () => {
      portal(`/p/${ORG_A}/receivables?newIncome=owed&settle=${R1}`, { 'GET /v1/receivables': () => ok(page(OPEN_OWED)) }, [who]);
      await screen.findByRole('table', { name: 'Receivables' });
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  }

  it('keeps the Malafat notice byte for byte', async () => {
    portal(`/p/${ORG_A}/receivables`, { 'GET /v1/receivables': () => ok(page(OPEN_OWED)) }, [profile()]);
    expect(await screen.findByRole('note')).toHaveTextContent('Malafat records income and payments for this profile. To change them, use Malafat.');
  });
});


// ---------------------------------------------------------------- MUT-224

const ME_ID = '99999999-9999-4999-8999-999999999999';
const P1_ID = 'c1111111-1111-4111-8111-111111111111';
const P2_ID = 'c2222222-2222-4222-8222-222222222222';
const capture = (id: string, number: string, over: Record<string, unknown> = {}) => ({
  ...payment(id, number),
  origin: 'capture' as const,
  capturedBy: { userId: ME_ID, displayName: 'Nour Haddad' },
  ...over,
});

describe('Changing a date (MUT-224)', () => {
  it('shows each Owed entry’s own date, and a row opens ?income= while Record payment still opens only its drawer', async () => {
    const { user, router } = portal(`/p/${ORG_A}/receivables`, {
      'GET /v1/receivables': () => ok(page(OPEN_OWED)),
      [`GET /v1/receivables/${R1}`]: () => ok(OPEN_OWED[0]),
    }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Receivables' });
    expect(within(table).getByRole('columnheader', { name: 'Date' })).toBeInTheDocument();
    expect(rowsOf(table)[0]).toHaveTextContent('Sep 1, 2026');

    await user.click(within(table).getAllByRole('button', { name: /Record payment/ })[0]!);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables?settle=${R1}`));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    const link = rowsOf(table)[0]!.querySelector<HTMLButtonElement>('button.row-link')!;
    link.focus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables?income=${R1}`));
    expect(await screen.findByRole('heading', { name: 'Change the date' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/receivables`));
  });

  it('opens ?payment= from the Received date of the user’s own posted capture; the expander and other rows stay put', async () => {
    const mine = capture(P1_ID, 'PAY-2026-0007');
    const undone = capture(P2_ID, 'PAY-2026-0008', { status: 'REVERSED' });
    const { user, router } = portal(`/p/${ORG_A}/payments`, {
      'GET /v1/payments': () => ok(page([mine, undone])),
      [`GET /v1/payments/${P1_ID}`]: () => ok(mine),
    }, [PERSONAL]);
    const table = await screen.findByRole('table', { name: 'Payments' });
    const [first, second] = rowsOf(table);
    expect(second!.querySelector('button.row-link')).toBeNull();
    expect(second).not.toHaveClass('clickable');

    await user.click(within(first!).getByRole('button', { name: 'Show where this payment went' }));
    expect(locationOf(router)).toBe(`/p/${ORG_A}/payments`);

    const link = first!.querySelector<HTMLButtonElement>('button.row-link')!;
    expect(link.closest('td')).toBe(first!.querySelectorAll('td')[2]);
    await user.click(link);
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/payments?payment=${P1_ID}`));
    expect(await screen.findByRole('heading', { name: 'Change the received date' })).toBeInTheDocument();
  });

  it('a Malafat-fed profile shows no row-link on either list and ignores ?income= and ?payment= deep links', async () => {
    const malafat = profile();
    portal(`/p/${ORG_A}/receivables?income=${R1}`, { 'GET /v1/receivables': () => ok(page(OPEN_OWED)) }, [malafat]);
    const receivables = await screen.findByRole('table', { name: 'Receivables' });
    expect(receivables.querySelector('button.row-link')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a Malafat-fed profile’s Payments are unchanged too', async () => {
    portal(`/p/${ORG_A}/payments?payment=${P1_ID}`, { 'GET /v1/payments': () => ok(page([capture(P1_ID, 'PAY-2026-0007')])) }, [profile()]);
    const payments = await screen.findByRole('table', { name: 'Payments' });
    expect(payments.querySelector('button.row-link')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});


// ---------------------------------------------------------------- MUT-183

describe('Shell overlay keys never reach a list (MUT-183 R1)', () => {
  it('a profile-drawer key in the URL leaves Receivables and Payments unfiltered', async () => {
    portal(`/p/${ORG_A}/receivables?newProfile=1`);
    expect(await screen.findByText('Nothing is owed on this profile right now')).toBeInTheDocument();
    expect(screen.queryByText('Nothing matches these filters.')).toBeNull();
  });

  it('adding a profile-drawer key does not refetch the list behind it', async () => {
    const { router, api } = portal(`/p/${ORG_A}/payments`);
    expect(await screen.findByText('No payments recorded on this profile yet')).toBeInTheDocument();
    await act(() => router.navigate({ to: '.', search: (prev: Record<string, unknown>) => ({ ...prev, manageProfiles: true }) } as never));
    await waitFor(() => expect(locationOf(router)).toBe(`/p/${ORG_A}/payments?manageProfiles=true`));
    expect(screen.getByText('No payments recorded on this profile yet')).toBeInTheDocument();
    expect(api.count('GET /v1/payments')).toBe(1);
  });
});

describe('Profile switcher entries (MUT-183)', () => {
  const builtIn = profile({ id: ORG_B, name: 'Personal', writerOfRecord: null, owned: true, type: 'PERSONAL', isPersonalDefault: true });
  const business = profile({ id: 'c3333333-3333-4333-8333-333333333333', name: 'Nour Studio', writerOfRecord: null, owned: true, type: 'BUSINESS' });
  const writerNullFirm = profile({ id: 'c4444444-4444-4444-8444-444444444444', name: 'Khalil Accounting', writerOfRecord: null });

  it('SW1/SW4: lists the profiles with their kind, then New profile and Manage profiles', async () => {
    const { user } = portal(`/p/${ORG_A}`, {}, [profile(), business, writerNullFirm, builtIn]);
    await user.click(await screen.findByRole('button', { name: 'Switch profile: Haddad & Partners' }));
    const menu = screen.getByRole('menu', { name: 'Switch profile' });
    const radios = within(menu).getAllByRole('menuitemradio');
    expect(radios.map((r) => r.textContent)).toEqual([
      '✓Haddad & PartnersHostedIncome recorded by Malafat',
      'Nour StudioHostedBusiness',
      'Khalil AccountingHostedExpenses only',
      'PersonalHostedYour built-in profile',
    ]);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['+ New profile', 'Manage profiles']);
  });

  it('SW2: at the cap New profile is aria-disabled, says why, and opens nothing', async () => {
    const owned = Array.from({ length: 6 }, (_, i) =>
      profile({ id: `6666666${i}-6666-4666-8666-666666666666`, name: `Owned ${i}`, writerOfRecord: null, owned: true, type: 'BUSINESS' }),
    );
    const { user, router } = portal(`/p/${owned[0].id}`, {}, owned);
    await user.click(await screen.findByRole('button', { name: /Switch profile/ }));
    const item = screen.getByRole('menuitem', { name: /New profile/ });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveTextContent("You've used 6 of 6 profiles");
    await user.click(item);
    expect(locationOf(router)).toBe(`/p/${owned[0].id}`);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('SW3: Manage profiles closes the menu and opens the Manage drawer', async () => {
    const { user, router } = portal(`/p/${ORG_A}`, {}, [profile(), builtIn]);
    await user.click(await screen.findByRole('button', { name: /Switch profile/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Manage profiles' }));
    expect(await screen.findByRole('dialog', { name: 'Profiles' })).toBeInTheDocument();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(locationOf(router)).toBe(`/p/${ORG_A}?manageProfiles=true`);
  });
});
