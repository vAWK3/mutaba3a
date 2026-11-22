import { todayFor } from '../agreements/compose.js';
import { postDueItems, type PostingActor } from '../agreements/posting.js';
import { addDays, compareIsoDates, type IsoDate } from '../dates.js';
import { listAll } from '../repositories/list-all.js';
import type { ExpenseCursor, ExpenseRecord, LedgerStore, Organization, PaymentRecord, ReceivableRecord } from '../repositories/ports.js';
import { historyEnd, historyStart, summarizeActivity, type ActivitySummary } from './activity.js';
import { owedOf, type Owed } from './verdict.js';
import { invoiceSplitOf } from '../income/invoice-split.js';
import type { IncomeSplitRow } from '../income/invoice-class.js';

/**
 * MUT-535 (plan D5): one profile's figures as Reports' Glance reads them — due items posted first, then the POSTED
 * payments and expenses over the read window and the open income — so the verdict route and the monthly summary mail
 * read the same numbers through one function and can never disagree.
 */
export interface ProfileFigures {
  /** The profile's own today, in its timezone. */
  today: IsoDate;
  /** Records exist before the read window (the activity route's earlierData). */
  earlierData: boolean;
  activity: ActivitySummary;
  owed: Owed;
  /** MUT-535 (D10): an income still open, a payment or an expense is dated in [from, to]. */
  entriesInRange: boolean;
  /** MUT-660: the range's received money split; null where invoicing is off. */
  invoiceSplit: IncomeSplitRow[] | null;
}

/** How catch-up posting writes: a request's door (`lazyPostingOf`), or a job's (the unguarded store, SYSTEM). */
export interface PostingDoor {
  store: LedgerStore;
  actor: PostingActor;
}

export interface ActivityWindow {
  payments: PaymentRecord[];
  expenses: ExpenseRecord[];
  earlierData: boolean;
}

/**
 * MUT-175 (shared with MUT-447): one profile's POSTED payments and expenses over the read window — from (or the 12
 * months ending with to's month, if earlier) through the end of to's month — and whether records exist before it.
 */
export async function readActivityWindow(store: LedgerStore, organizationId: string, from: IsoDate, to: IsoDate): Promise<ActivityWindow> {
  const start = compareIsoDates(from, historyStart(to)) < 0 ? from : historyStart(to);
  const end = historyEnd(to);
  const before = addDays(start, -1);
  const [payments, expenses, paidEarlier, spentEarlier] = await Promise.all([
    listAll((cursor) => store.payments.list(organizationId, { status: 'POSTED', receivedAfter: start, receivedBefore: end }, { limit: 200, cursor })),
    listAll<ExpenseRecord, ExpenseCursor>((cursor) => store.expenses.list(organizationId, { from: start, to: end }, { limit: 200, cursor })),
    store.payments.list(organizationId, { status: 'POSTED', receivedBefore: before }, { limit: 1, cursor: null }),
    store.expenses.list(organizationId, { to: before }, { limit: 1, cursor: null }),
  ]);
  return { payments, expenses, earlierData: paidEarlier.items.length > 0 || spentEarlier.items.length > 0 };
}

/**
 * `posting: null` reads without posting due items (an operator's dry run writes nothing); owed can then lag what the
 * overview shows by the installments not yet posted.
 */
export async function readProfileFigures(store: LedgerStore, organization: Organization, range: { from: IsoDate; to: IsoDate }, now: Date, posting: PostingDoor | null): Promise<ProfileFigures> {
  const { from, to } = range;
  const today = todayFor(organization, now);
  if (posting) await postDueItems(posting.store, organization, today, now, posting.actor);
  const [window, receivables] = await Promise.all([
    readActivityWindow(store, organization.id, from, to),
    listAll((cursor) => store.receivables.list(organization.id, { status: 'OPEN' }, { limit: 200, cursor })),
  ]);
  return {
    today,
    earlierData: window.earlierData,
    activity: summarizeActivity({ payments: window.payments, expenses: window.expenses, allocations: [], receivables: [], from, to, bucket: 'month' }),
    owed: owedOf(receivables, today),
    entriesInRange: entriesIn(window, receivables, from, to),
    invoiceSplit: await invoiceSplitOf(store, organization, window.payments, { from, to }),
  };
}

function entriesIn(window: ActivityWindow, receivables: readonly ReceivableRecord[], from: IsoDate, to: IsoDate): boolean {
  const within = (date: IsoDate) => compareIsoDates(date, from) >= 0 && compareIsoDates(date, to) <= 0;
  return window.payments.some((p) => within(p.receivedOn)) || window.expenses.some((e) => within(e.occurredOn)) || receivables.some((r) => within(r.postingDate));
}
