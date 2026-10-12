/**
 * @vitest-environment jsdom
 *
 * MUT-82 (brief H1): Home's Needs attention rows record a payment in place.
 * The row's Record Payment button opens the payment drawer prefilled with
 * what is left; a save that settles the entry takes the row off the list in
 * the same render that changes Owed now, and a toast offers Undo, which
 * deletes the payment record and brings everything back.
 *
 * Integration: Home (OverviewPage) with the payment drawer mounted from the
 * store as AppShell mounts it, the app's toast container, real translations
 * and the real repository on fake-indexeddb. jsdom has no layout, so the
 * slide-out itself is not played here (rowExit.test.ts, e2e).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import type { MouseEvent, ReactNode } from 'react';
import { OverviewPage } from '../../../pages/overview/OverviewPage';
import { PartialPaymentDrawer } from '../../drawers/PartialPaymentDrawer';
import { ToastContainer } from '../../ui/ToastContainer';
import { LanguageProvider } from '../../../lib/i18n';
import { createAppQueryClient } from '../../../lib/queryClient';
import { useDrawerStore } from '../../../lib/stores';
import { useToastStore } from '../../../lib/toastStore';
import { formatLocalDate, todayLocalISO } from '../../../lib/dates';
import { db } from '../../../db/database';
import { clientRepo, transactionRepo } from '../../../db/repository';
import type { BusinessProfile, Transaction } from '../../../types';

const PROFILE = 'p1';

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  Link: ({
    children,
    to,
    params,
    className,
    onClick,
  }: {
    children: ReactNode;
    to: string;
    params?: Record<string, string>;
    className?: string;
    onClick?: (event: MouseEvent) => void;
  }) => (
    <a
      href={to}
      className={className}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        mockNavigate({ to, params });
      }}
    >
      {children}
    </a>
  ),
}));

// The top bar is chrome with its own suite; Home's content is what's tested
vi.mock('../../layout', () => ({ TopBar: ({ title }: { title: string }) => <h1>{title}</h1> }));

// Home reads the owed screens' lens (MUT-89): one business unless a test turns All on
const lens = vi.hoisted(() => ({
  current: { scope: 'p1' as string | string[], isAll: false, profilesById: new Map<string, BusinessProfile>() },
}));
vi.mock('../../../hooks/useActiveProfile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useActiveProfile')>()),
  useOwedLens: () => lens.current,
}));

/** Mounts the payment drawer from the store, as AppShell does */
function PaymentDrawerHost() {
  const { partialPaymentDrawer, closePartialPaymentDrawer } = useDrawerStore();
  if (!partialPaymentDrawer.isOpen || !partialPaymentDrawer.transactionId) return null;
  return (
    <PartialPaymentDrawer
      transactionId={partialPaymentDrawer.transactionId}
      onClose={closePartialPaymentDrawer}
      onRecorded={partialPaymentDrawer.onRecorded}
    />
  );
}

function renderHome() {
  const queryClient = createAppQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <LanguageProvider>
        <OverviewPage />
        <PaymentDrawerHost />
        <ToastContainer />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

function daysFromToday(days: number): string {
  const [year, month, day] = todayLocalISO().split('-').map(Number);
  return formatLocalDate(new Date(year, month - 1, day + days));
}

interface Seeded {
  logo: string;
  brand: string;
  walkIn: string;
}

/** ₪3,550 overdue for Acme, ₪1,200 due in 2 days for Beta, $200 due today with no client */
async function seed(): Promise<Seeded> {
  const acme = await clientRepo.create({ name: 'Acme Studio', profileId: PROFILE });
  const beta = await clientRepo.create({ name: 'Beta Labs', profileId: PROFILE });
  const entry = (data: Partial<Transaction>) =>
    transactionRepo.create({
      kind: 'income',
      status: 'unpaid',
      currency: 'ILS',
      occurredAt: daysFromToday(-30),
      profileId: PROFILE,
      amountMinor: 0,
      ...data,
    });
  const logo = await entry({ title: 'Logo redesign', clientId: acme.id, amountMinor: 355000, dueDate: daysFromToday(-5) });
  const brand = await entry({ title: 'Brand book', clientId: beta.id, amountMinor: 120000, dueDate: daysFromToday(2) });
  const walkIn = await entry({ title: 'Walk-in job', currency: 'USD', amountMinor: 20000, dueDate: daysFromToday(0) });
  return { logo: logo.id, brand: brand.id, walkIn: walkIn.id };
}

async function clearDb() {
  await Promise.all([
    db.transactions.clear(),
    db.paymentRecords.clear(),
    db.clients.clear(),
    db.projects.clear(),
    db.categories.clear(),
  ]);
}

/** Without the bidi isolates that keep amounts whole inside sentences */
const plain = (text: string | null | undefined) => (text ?? '').replace(/[⁦-⁩]/g, '');

const attention = () => screen.getByRole('region', { name: 'Needs Attention' });
const owedAmounts = () =>
  within(screen.getByRole('region', { name: 'Owed now' }))
    .queryAllByTestId('owed-now-amount')
    .map((amount) => amount.textContent)
    .join(' ');
const payButton = (remaining: string) =>
  within(attention()).getByRole('button', { name: `Record Payment — Remaining: ${remaining}` });
const dialog = () => screen.getByRole('dialog');
/** The drawer's own Record Payment, once the entry has loaded */
const drawerRecordButton = () => within(dialog()).findByRole('button', { name: 'Record Payment' });

async function waitForHome() {
  await within(await screen.findByRole('region', { name: 'Needs Attention' })).findByText('Logo redesign');
  await waitFor(() => expect(owedAmounts()).toBe('$200 ₪4,750'));
}

async function paymentState(id: string) {
  const tx = (await transactionRepo.get(id)) as Transaction;
  return { status: tx.status, remainingMinor: tx.amountMinor - (tx.receivedAmountMinor ?? 0), paidAt: tx.paidAt };
}

describe('Home: Record payment from Needs attention (MUT-82)', () => {
  let ids: Seeded;

  beforeEach(async () => {
    localStorage.setItem('mutaba3a-language', 'en');
    await clearDb();
    ids = await seed();
    useDrawerStore.getState().closePartialPaymentDrawer();
    useDrawerStore.getState().closeIncomeDrawer();
    useToastStore.setState({ toasts: [] });
    mockNavigate.mockClear();
  });

  afterEach(async () => {
    useToastStore.setState({ toasts: [] });
    useDrawerStore.getState().closePartialPaymentDrawer();
    await clearDb();
  });

  it('gives every row a Record Payment button named with what is left, beside its amount', async () => {
    renderHome();
    await waitForHome();

    expect(payButton('₪3,550')).toHaveTextContent(/^Record Payment$/);
    expect(payButton('₪1,200')).toBeInTheDocument();
    expect(payButton('$200')).toBeInTheDocument();
  });

  it('opens the payment drawer in place, prefilled with what is left', async () => {
    const user = userEvent.setup();
    renderHome();
    await waitForHome();

    await user.click(payButton('₪3,550'));

    // The drawer shows its spinner until the entry has loaded
    await waitFor(() =>
      expect(plain(within(dialog()).getByRole('heading', { level: 2 }).textContent)).toBe('Record Payment · ₪3,550 left')
    );
    expect(within(dialog()).getByLabelText('Payment amount')).toHaveValue('3550');
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe('a full payment', () => {
    it('takes the row off the list, lowers Owed now and offers Undo', async () => {
      const user = userEvent.setup();
      renderHome();
      await waitForHome();

      await user.click(payButton('₪3,550'));
      await user.click(await drawerRecordButton());

      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(within(attention()).queryByText('Logo redesign')).toBeNull());
      expect(owedAmounts()).toBe('$200 ₪1,200');
      const toast = screen.getByRole('status');
      expect(plain(toast.textContent)).toContain('Recorded ₪3,550 from Acme Studio');
      expect(within(toast).getByRole('button', { name: 'Undo' })).toBeInTheDocument();
    });

    it('changes the row and Owed now in the same render, never one without the other', async () => {
      const user = userEvent.setup();
      const { container } = renderHome();
      await waitForHome();
      const states = new Set<string>();
      const observer = new MutationObserver(() => {
        const rowShown = within(attention()).queryByText('Logo redesign') !== null;
        states.add(`${rowShown ? 'row' : 'no row'} | ${owedAmounts()}`);
      });
      observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true });

      await user.click(payButton('₪3,550'));
      await user.click(await drawerRecordButton());
      await waitFor(() => expect(within(attention()).queryByText('Logo redesign')).toBeNull());
      await waitFor(() => expect(owedAmounts()).toBe('$200 ₪1,200'));
      observer.disconnect();

      expect(states).toContain('no row | $200 ₪1,200');
      expect(states).not.toContain('no row | $200 ₪4,750');
      expect(states).not.toContain('row | $200 ₪1,200');
    });

    it('moves focus to the next row\'s Record Payment when the paid row leaves', async () => {
      const user = userEvent.setup();
      renderHome();
      await waitForHome();

      await user.click(payButton('₪3,550'));
      await user.click(await drawerRecordButton());

      await waitFor(() => expect(within(attention()).queryByText('Logo redesign')).toBeNull());
      await waitFor(() => expect(payButton('$200')).toHaveFocus());
    });
  });

  it('keeps the row on a partial payment and shows what is still left', async () => {
    const user = userEvent.setup();
    renderHome();
    await waitForHome();

    await user.click(payButton('₪3,550'));
    const amount = await within(dialog()).findByLabelText('Payment amount');
    await user.clear(amount);
    await user.type(amount, '1000');
    await user.click(await drawerRecordButton());

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(payButton('₪2,550')).toBeInTheDocument());
    expect(within(attention()).getByText('Logo redesign')).toBeInTheDocument();
    expect(owedAmounts()).toBe('$200 ₪3,750');
    expect(plain(screen.getByRole('status').textContent)).toContain('Recorded ₪1,000 from Acme Studio');
  });

  it('Undo brings back the row, Owed now and the entry exactly, and focus to the row', async () => {
    const user = userEvent.setup();
    const before = await paymentState(ids.logo);
    renderHome();
    await waitForHome();

    await user.click(payButton('₪3,550'));
    await user.click(await drawerRecordButton());
    await waitFor(() => expect(within(attention()).queryByText('Logo redesign')).toBeNull());
    expect((await paymentState(ids.logo)).status).toBe('paid');

    await user.click(within(screen.getByRole('status')).getByRole('button', { name: 'Undo' }));

    await waitFor(() => expect(payButton('₪3,550')).toBeInTheDocument());
    expect(owedAmounts()).toBe('$200 ₪4,750');
    expect(await paymentState(ids.logo)).toEqual(before);
    await waitFor(() => expect(payButton('₪3,550')).toHaveFocus());
  });

  describe('keyboard and the row\'s own action', () => {
    it('reaches the button with Tab after the row\'s link, and Enter opens the drawer, not the client', async () => {
      const user = userEvent.setup();
      renderHome();
      await waitForHome();
      const link = within(attention()).getByRole('link', { name: 'Acme Studio Logo redesign' });

      link.focus();
      await user.tab();
      expect(payButton('₪3,550')).toHaveFocus();
      await user.keyboard('{Enter}');

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('opens the client from its link, or from a click anywhere else on the row', async () => {
      const user = userEvent.setup();
      renderHome();
      await waitForHome();
      const clientId = (await transactionRepo.get(ids.logo))!.clientId;

      await user.click(within(attention()).getByRole('link', { name: 'Acme Studio Logo redesign' }));
      expect(mockNavigate).toHaveBeenLastCalledWith({ to: '/clients/$clientId', params: { clientId } });

      mockNavigate.mockClear();
      await user.click(within(attention()).getByText('5d overdue'));
      expect(mockNavigate).toHaveBeenLastCalledWith({ to: '/clients/$clientId', params: { clientId } });
    });

    it('opens the entry from a row with no client', async () => {
      const user = userEvent.setup();
      renderHome();
      await waitForHome();

      await user.click(within(attention()).getByRole('button', { name: 'No client Walk-in job' }));

      expect(useDrawerStore.getState().incomeDrawer).toMatchObject({ isOpen: true, mode: 'edit', transactionId: ids.walkIn });
      expect(screen.queryByRole('dialog', { name: /Record Payment/ })).toBeNull();
    });
  });

  describe('with All businesses on (MUT-89)', () => {
    const OTHER = 'p2';
    const STAMP = '2026-01-01T00:00:00Z';
    const studio: BusinessProfile = { id: PROFILE, name: 'Studio', createdAt: STAMP, updatedAt: STAMP };
    const teaching: BusinessProfile = { id: OTHER, name: 'Teaching', createdAt: STAMP, updatedAt: STAMP };

    beforeEach(async () => {
      lens.current = {
        scope: [PROFILE, OTHER],
        isAll: true,
        profilesById: new Map([
          [PROFILE, studio],
          [OTHER, teaching],
        ]),
      };
      const gamma = await clientRepo.create({ name: 'Gamma School', profileId: OTHER });
      await transactionRepo.create({
        kind: 'income',
        status: 'unpaid',
        currency: 'ILS',
        occurredAt: daysFromToday(-30),
        profileId: OTHER,
        clientId: gamma.id,
        title: 'Course fee',
        amountMinor: 50000,
        dueDate: daysFromToday(-3),
      });
    });

    afterEach(() => {
      lens.current = { scope: PROFILE, isAll: false, profilesById: new Map() };
    });

    async function waitForAllBusinesses() {
      await within(await screen.findByRole('region', { name: 'Needs Attention' })).findByText('Course fee');
      await waitFor(() => expect(owedAmounts()).toBe('$200 ₪5,250'));
    }

    it('lists what every business is owed, each row tagged with its business', async () => {
      renderHome();
      await waitForAllBusinesses();

      expect(within(attention()).getByText('Course fee').closest('tr')).toHaveTextContent('Teaching');
      expect(within(attention()).getByText('Logo redesign').closest('tr')).toHaveTextContent('Studio');
    });

    it('still changes the row and Owed now in the same render (ADR-055, D7)', async () => {
      const user = userEvent.setup();
      const { container } = renderHome();
      await waitForAllBusinesses();
      const states = new Set<string>();
      const observer = new MutationObserver(() => {
        const rowShown = within(attention()).queryByText('Logo redesign') !== null;
        states.add(`${rowShown ? 'row' : 'no row'} | ${owedAmounts()}`);
      });
      observer.observe(container, { subtree: true, childList: true, characterData: true, attributes: true });

      await user.click(payButton('₪3,550'));
      await user.click(await drawerRecordButton());
      await waitFor(() => expect(within(attention()).queryByText('Logo redesign')).toBeNull());
      await waitFor(() => expect(owedAmounts()).toBe('$200 ₪1,700'));
      observer.disconnect();

      expect(states).toContain('no row | $200 ₪1,700');
      expect(states).not.toContain('no row | $200 ₪5,250');
      expect(states).not.toContain('row | $200 ₪1,700');
    });
  });
});
