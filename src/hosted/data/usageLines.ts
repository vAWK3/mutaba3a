import type { BillingOverview } from '../api/client';

/**
 * MUT-753 (plan T3, design review 2B): a paid plan's usage lines as Billing shows them: documents and scans this
 * month, businesses, and the partners each business may have. Pure, and shared: the Pilot panel uses it today, and
 * the paid plans' meter rows (MUT-754, MUT-733) can read the same lines. Nothing is refused here; a line only turns
 * the attention (butter) tone from 90% of its cap (2B), and stays so over the cap.
 */

export type UsageLineKey = 'documents' | 'scans' | 'businesses';

export interface UsageLine {
  key: UsageLineKey;
  used: number;
  cap: number;
  /** From 90% of the cap (2B): the number and the bar turn butter. */
  attention: boolean;
  /** The bar's fill, 0–100 (an over-cap line stays full). */
  percent: number;
}

export interface UsageLines {
  /** YYYY-MM-DD: the day the monthly lines start again. */
  resetsOn: string;
  lines: UsageLine[];
  /** Partners allowed on each business (a cap with no count); null when the plan has none to show. */
  partnersPerBusiness: number | null;
}

/** 2B: the attention tone starts at 90% of a cap. */
export const ATTENTION_FROM = 0.9;

export function usageLineOf(key: UsageLineKey, used: number, cap: number): UsageLine {
  return { key, used, cap, attention: cap > 0 && used >= cap * ATTENTION_FROM, percent: cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0 };
}

/** The lines of the plan GET /v1/billing `usage` reads from; only lines with a cap. Null with no usage (an older server). */
export function usageLinesOf(billing: Pick<BillingOverview, 'usage'> | null | undefined): UsageLines | null {
  const usage = billing?.usage;
  if (!usage) return null;
  const lines: UsageLine[] = [];
  for (const key of ['documents', 'scans'] as const) {
    const m = usage.meters.find((x) => x.meter === key);
    if (m && m.limit !== null) lines.push(usageLineOf(key, m.used, m.limit));
  }
  if (usage.businesses.limit !== null) lines.push(usageLineOf('businesses', usage.businesses.used, usage.businesses.limit));
  const partners = usage.partners.limit;
  return { resetsOn: usage.resetsOn, lines, partnersPerBusiness: partners !== null && partners > 0 ? partners : null };
}
