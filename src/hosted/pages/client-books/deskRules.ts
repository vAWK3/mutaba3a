import type { AccountantClientWithStats, Schemas } from '../../api/client';
import { isEnded, matchesClient } from './clientBooksRules';

export type { AccountantClientWithStats };
/** One account the accountant created for a customer (GET /v1/accountant/customers). */
export type DeskCustomer = Schemas['ProvisionedCustomerRow'];

/**
 * MUT-768 (accountant channel, DR-2..DR-6): the desk's rows. One row per client book (GET /v1/clients), joined by
 * profile with the accountant's customers (GET /v1/accountant/customers). A customer without a client book still
 * shows, under their own name. The state is the word on the badge; the next action is the row's ONE button.
 *
 * `activating` is the portal's own state (DR-5, B15): the server has no such state. It is the customer ids the person
 * sent to Stripe in the last two minutes, until the list says paid.
 */
export type DeskState = 'await' | 'expired' | 'card' | 'activating' | 'active' | 'ended';
export type DeskFilter = 'all' | 'awaiting' | 'needcard' | 'active';
/** New code on an unclaimed account, Resend link once it expired, Take card once claimed and unpaid. */
export type NextAction = 'newCode' | 'resend' | 'takeCard';

export interface DeskRow {
  /** The profile id, or the customer's user id when they have no client book. */
  key: string;
  client: AccountantClientWithStats | null;
  customer: DeskCustomer | null;
  state: DeskState;
  /** The business: the client book's name, else the customer's profile, else their own name. */
  name: string;
  ownerName: string | null;
  email: string | null;
}

function customerState(customer: DeskCustomer, activating: ReadonlySet<string>): DeskState {
  switch (customer.state) {
    case 'awaiting_claim':
    case 'code_locked':
      return 'await';
    case 'link_expired':
      return 'expired';
    case 'claimed':
      if (customer.paid) return 'active';
      return activating.has(customer.userId) ? 'activating' : 'card';
  }
}

export function buildDeskRows(clients: readonly AccountantClientWithStats[], customers: readonly DeskCustomer[], activating: ReadonlySet<string>): DeskRow[] {
  const byProfile = new Map(customers.flatMap((c) => (c.profile ? [[c.profile.id, c] as const] : [])));
  const joined = new Set<string>();
  const rows: DeskRow[] = clients.map((client) => {
    const customer = byProfile.get(client.profileId) ?? null;
    if (customer) joined.add(customer.userId);
    // An ended share wins: setup actions on a book the accountant can no longer open would only fail.
    const state: DeskState = isEnded(client) ? 'ended' : customer ? customerState(customer, activating) : 'active';
    return { key: client.profileId, client, customer, state, name: client.name, ownerName: client.ownerName ?? customer?.displayName ?? null, email: customer?.email ?? null };
  });
  for (const customer of customers) {
    if (joined.has(customer.userId)) continue;
    rows.push({ key: customer.userId, client: null, customer, state: customerState(customer, activating), name: customer.profile?.name ?? customer.displayName, ownerName: customer.displayName, email: customer.email });
  }
  return rows;
}

export function nextActionOf(state: DeskState): NextAction | null {
  switch (state) {
    case 'await':
      return 'newCode';
    case 'expired':
      return 'resend';
    case 'card':
      return 'takeCard';
    default:
      return null;
  }
}

const AWAITING: ReadonlySet<DeskState> = new Set(['await', 'expired']);
/** Activating stays under Active: a row mid-payment must not vanish from the list. */
const ACTIVE: ReadonlySet<DeskState> = new Set(['active', 'activating']);

export function matchesDeskFilter(row: Pick<DeskRow, 'state'>, filter: DeskFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'awaiting':
      return AWAITING.has(row.state);
    case 'needcard':
      return row.state === 'card';
    case 'active':
      return ACTIVE.has(row.state);
  }
}

export function filterCounts(rows: readonly Pick<DeskRow, 'state'>[]): Record<DeskFilter, number> {
  const count = (filter: DeskFilter) => rows.filter((row) => matchesDeskFilter(row, filter)).length;
  return { all: count('all'), awaiting: count('awaiting'), needcard: count('needcard'), active: count('active') };
}

/** The business, the owner or the email contains the query, ignoring case. */
export function matchesDeskRow(row: Pick<DeskRow, 'name' | 'ownerName' | 'email'>, query: string): boolean {
  if (matchesClient({ name: row.name, ownerName: row.ownerName }, query)) return true;
  const q = query.trim().toLocaleLowerCase();
  return (row.email ?? '').toLocaleLowerCase().includes(q);
}
