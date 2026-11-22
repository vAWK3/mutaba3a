import type { OrganizationSummary } from '../api/client';

/**
 * Home's "Clients overdue" (MUT-657 E-4), from the org summary Owed already reads, by Owed's own rule: a client whose
 * row says OVERDUE (post-due items in the organization's timezone; clientless entries never have a row). A client late
 * in two currencies is one client, as late as its latest. Pure, so every rule is a unit test.
 */

/** Who, not how much: up to three names on home, the rest one tap away on Owed. */
export const OVERDUE_SHOWN = 3;
/** Home shows a short strip of receipts to review, never the gallery's pages (its own key). */
export const TO_REVIEW_STRIP = 8;

export interface OverdueClient {
  customerId: string;
  daysOverdue: number | null;
}

function lateness(summary: OrganizationSummary): Map<string, number | null> {
  const days = new Map<string, number | null>();
  for (const block of summary.currencies) {
    for (const row of block.customers) {
      if (row.status !== 'OVERDUE') continue;
      const seen = days.get(row.customerId) ?? null;
      const late = row.daysOverdue ?? null;
      days.set(row.customerId, late === null ? seen : Math.max(seen ?? 0, late));
    }
  }
  return days;
}

export function overdueClientCount(summary: OrganizationSummary): number {
  return lateness(summary).size;
}

/** The `limit` most late clients, most days first; one the server gave no lateness goes last. */
export function overdueClients(summary: OrganizationSummary, limit: number): OverdueClient[] {
  return [...lateness(summary)]
    .map(([customerId, daysOverdue]) => ({ customerId, daysOverdue }))
    .sort((a, b) => (b.daysOverdue ?? -1) - (a.daysOverdue ?? -1))
    .slice(0, limit);
}
