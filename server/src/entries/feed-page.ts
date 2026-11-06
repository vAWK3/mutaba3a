import type { FeedPageRequest, LedgerStore } from '../repositories/ports.js';
import { expenseContextOf, serializeEntry } from '../serializers.js';
import { encodeFeedCursor } from './merge.js';

/**
 * MUT-575 (ADR-249, E7): the one way an entries page is built, for `/v1/entries` (a person's memberships) and
 * `/v1/profile-entries` (the one selected profile): read the page, then the READY receipt counts of its expenses and
 * the Owed each settle paid toward, and serialize. Trusts `organizationIds`: each route resolved them its own way.
 * Never lazy-posts (MUT-270 D2).
 */
export async function feedPage(store: LedgerStore, organizationIds: readonly string[], request: FeedPageRequest) {
  const page = await store.entries.list(organizationIds, request);
  const expenseIds = page.items.flatMap((row) => (row.kind === 'expense' ? [row.record.id] : []));
  // Only a capture with money applied can be a settle; most pages ask nothing.
  const settleCandidates = page.items.flatMap((row) => (row.kind === 'payment' && row.record.origin === 'CAPTURE' && row.record.allocatedMinor > 0n ? [row.record.id] : []));
  // MUT-557 (A1): the profiles of this page's expenses, for their flags (most pages hold one or two).
  const expenseProfileIds = [...new Set(page.items.flatMap((row) => (row.kind === 'expense' ? [row.record.organizationId] : [])))];
  const [receiptCounts, settledOwed, expenseProfiles] = await Promise.all([
    store.expenseReceipts.countReadyByExpenseIds(organizationIds, expenseIds),
    store.entries.settledOwedIds(organizationIds, settleCandidates),
    Promise.all(expenseProfileIds.map((id) => store.organizations.getById(id))),
  ]);
  const expenseContexts = new Map(expenseProfiles.flatMap((org) => (org ? [[org.id, expenseContextOf(org)] as const] : [])));
  return { items: page.items.map((row) => serializeEntry(row, { receiptCounts, settledOwed, expenseContexts })), nextCursor: page.nextCursor ? encodeFeedCursor(page.nextCursor) : null };
}
