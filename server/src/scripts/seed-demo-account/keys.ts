import type { ResolvedClientFixture } from './fixtures.js';

/**
 * The seed's Idempotency-Keys (MUT-136), in one place: the writes use them and
 * pruneEarlierBatches.ts rebuilds them for earlier days to find what the seed
 * wrote then. Each stays within [A-Za-z0-9_-:.]{8,128} and repeats only when
 * the request body would repeat too.
 */
export function seedKey(...parts: string[]): string {
  return `seed-${parts.join('-')}`;
}

/** One dated write of a day's batch: what it was, and the key it was sent with. */
export type DatedWrite =
  | { kind: 'income'; key: string }
  | { kind: 'settle'; key: string }
  | { kind: 'expense'; key: string };

/**
 * Every dated write (income, settle, expense) of the batch built for one day,
 * as `buildFixtures(day)` resolves it. Customers and projects are left out:
 * their keys carry no date, so every day replays the same ones.
 */
export function datedWrites(fixtures: ResolvedClientFixture[]): DatedWrite[] {
  const out: DatedWrite[] = [];
  for (const client of fixtures) {
    for (const project of client.projects) {
      for (const income of project.income) {
        out.push({ kind: 'income', key: seedKey(client.slug, project.slug, 'income', income.slug, income.occurredOn) });
        if (income.settle) out.push({ kind: 'settle', key: seedKey(client.slug, project.slug, 'settle', income.slug, income.settle.paidAt) });
      }
      for (const expense of project.expenses) {
        out.push({ kind: 'expense', key: seedKey(client.slug, project.slug, 'expense', expense.slug, expense.occurredOn) });
      }
    }
  }
  return out;
}
