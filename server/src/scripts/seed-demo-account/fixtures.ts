import type { Currency } from '../../money.js';

/**
 * The realistic-looking dataset seed-demo-account.ts populates (MUT-136).
 * Dates are always computed relative to `now` at build time, never a literal
 * date, so the seeded account still passes ADR-038 (ledger dates never later
 * than today) no matter when the script runs. `pastDate` makes that an
 * invariant instead of a convention: it throws on a negative `daysAgo`, so a
 * fixture cannot accidentally name a future occurredOn/paidAt. `dueInDays` is
 * separate and signed, because a due date is allowed to sit in the future
 * (an "upcoming" item) or the past (overdue) — unlike occurredOn/paidAt, the
 * server never rejects a future dueDate.
 */

export interface SettleFixture {
  /** Days after occurredOn that the (partial or full) payment lands. */
  paidDaysAfter: number;
  /** Omit for a full settle of whatever is outstanding. */
  amount?: string;
}

export interface IncomeFixture {
  slug: string;
  kind: 'received' | 'owed';
  amount: string;
  title?: string;
  notes?: string;
  /** Days before `now`. */
  occurredDaysAgo: number;
  /** `owed` only: days before (positive) or after (negative) `now`. */
  dueInDays?: number;
  /** `owed` only: settle it (fully or partially) after creation. */
  settle?: SettleFixture;
}

export interface ExpenseFixture {
  slug: string;
  amount: string;
  title: string;
  vendor?: string;
  occurredDaysAgo: number;
}

export interface ProjectFixture {
  slug: string;
  name: string;
  currency: Currency;
  income: IncomeFixture[];
  expenses: ExpenseFixture[];
}

export interface ClientFixture {
  slug: string;
  name: string;
  projects: ProjectFixture[];
}

/** Resolved dates, ready to send on the wire. */
export interface ResolvedIncomeFixture extends Omit<IncomeFixture, 'occurredDaysAgo' | 'dueInDays' | 'settle'> {
  occurredOn: string;
  dueDate?: string;
  settle?: { paidAt: string; amount?: string };
}

export interface ResolvedExpenseFixture extends Omit<ExpenseFixture, 'occurredDaysAgo'> {
  occurredOn: string;
}

export interface ResolvedProjectFixture extends Omit<ProjectFixture, 'income' | 'expenses'> {
  income: ResolvedIncomeFixture[];
  expenses: ResolvedExpenseFixture[];
}

export interface ResolvedClientFixture extends Omit<ClientFixture, 'projects'> {
  projects: ResolvedProjectFixture[];
}

function pastDate(now: Date, daysAgo: number): string {
  if (daysAgo < 0) throw new Error(`pastDate: daysAgo must be >= 0, got ${daysAgo}`);
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

function dueInDays(now: Date, days: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const CLIENTS: ClientFixture[] = [
  {
    slug: 'al-quds-bakery',
    name: 'Al-Quds Bakery',
    projects: [
      {
        slug: 'daily-supply',
        name: 'Daily Supply Retainer',
        currency: 'ILS',
        income: [
          { slug: 'received-1', kind: 'received', amount: '650.00', occurredDaysAgo: 2 },
          { slug: 'received-2', kind: 'received', amount: '420.00', occurredDaysAgo: 9 },
          { slug: 'owed-overdue', kind: 'owed', amount: '300.00', title: 'October supply run', occurredDaysAgo: 20, dueInDays: -5 },
        ],
        expenses: [{ slug: 'flour-delivery', amount: '85.00', title: 'Flour delivery', vendor: 'Unipack Supplies', occurredDaysAgo: 6 }],
      },
    ],
  },
  {
    slug: 'haddad-law-office',
    name: 'Haddad Law Office',
    projects: [
      {
        slug: 'contract-review',
        name: 'Contract Review',
        currency: 'ILS',
        income: [
          { slug: 'owed-upcoming', kind: 'owed', amount: '2200.00', title: 'Lease contract review', occurredDaysAgo: 30, dueInDays: 7 },
          {
            slug: 'owed-part-paid',
            kind: 'owed',
            amount: '1500.00',
            title: 'Partnership agreement draft',
            occurredDaysAgo: 45,
            dueInDays: -15,
            settle: { paidDaysAfter: 35, amount: '900.00' },
          },
          { slug: 'received-1', kind: 'received', amount: '500.00', occurredDaysAgo: 3 },
        ],
        expenses: [],
      },
    ],
  },
  {
    slug: 'al-noor-clinic',
    name: 'Al-Noor Clinic',
    projects: [
      {
        slug: 'equipment-lease',
        name: 'Equipment Lease',
        currency: 'ILS',
        income: [{ slug: 'received-1', kind: 'received', amount: '3400.00', occurredDaysAgo: 1 }],
        expenses: [],
      },
    ],
  },
  {
    slug: 'bethlehem-design-studio',
    name: 'Bethlehem Design Studio',
    projects: [
      {
        slug: 'branding-package',
        name: 'Branding Package',
        currency: 'USD',
        income: [
          { slug: 'received-1', kind: 'received', amount: '1200.00', occurredDaysAgo: 5 },
          { slug: 'owed-overdue', kind: 'owed', amount: '800.00', title: 'Logo revisions round 2', occurredDaysAgo: 25, dueInDays: -3 },
        ],
        expenses: [{ slug: 'stock-photos', amount: '60.00', title: 'Stock photo license', vendor: 'ImageBank', occurredDaysAgo: 15 }],
      },
    ],
  },
  {
    slug: 'ramallah-tech-solutions',
    name: 'Ramallah Tech Solutions',
    projects: [
      {
        slug: 'website-maintenance',
        name: 'Website Maintenance',
        currency: 'ILS',
        income: [
          { slug: 'received-1', kind: 'received', amount: '950.00', occurredDaysAgo: 4 },
          { slug: 'received-2', kind: 'received', amount: '950.00', occurredDaysAgo: 34 },
        ],
        expenses: [{ slug: 'hosting-renewal', amount: '120.00', title: 'Hosting renewal', vendor: 'CloudHost', occurredDaysAgo: 20 }],
      },
    ],
  },
  {
    slug: 'hebron-textiles-co',
    name: 'Hebron Textiles Co.',
    projects: [
      {
        slug: 'spring-order',
        name: 'Spring Order',
        currency: 'ILS',
        income: [
          {
            slug: 'owed-part-paid',
            kind: 'owed',
            amount: '4200.00',
            title: 'Spring collection fabric order',
            occurredDaysAgo: 40,
            dueInDays: -10,
            settle: { paidDaysAfter: 28, amount: '2000.00' },
          },
          { slug: 'received-1', kind: 'received', amount: '300.00', occurredDaysAgo: 7 },
        ],
        expenses: [],
      },
    ],
  },
  {
    slug: 'nablus-grocery',
    name: 'Nablus Grocery',
    projects: [
      {
        slug: 'weekly-delivery',
        name: 'Weekly Delivery',
        currency: 'ILS',
        income: [
          { slug: 'received-1', kind: 'received', amount: '275.00', occurredDaysAgo: 1 },
          { slug: 'received-2', kind: 'received', amount: '275.00', occurredDaysAgo: 8 },
          { slug: 'received-3', kind: 'received', amount: '275.00', occurredDaysAgo: 15 },
        ],
        expenses: [{ slug: 'crates', amount: '40.00', title: 'Delivery crates', occurredDaysAgo: 3 }],
      },
    ],
  },
  {
    slug: 'jerusalem-consulting-group',
    name: 'Jerusalem Consulting Group',
    projects: [
      {
        slug: 'strategy-advisory',
        name: 'Strategy Advisory',
        currency: 'ILS',
        income: [
          { slug: 'owed-upcoming', kind: 'owed', amount: '5000.00', title: 'Q1 strategy engagement', occurredDaysAgo: 60, dueInDays: 3 },
          {
            slug: 'owed-settled',
            kind: 'owed',
            amount: '5000.00',
            title: 'Q4 strategy engagement',
            occurredDaysAgo: 90,
            dueInDays: -60,
            settle: { paidDaysAfter: 60 },
          },
        ],
        expenses: [],
      },
    ],
  },
];

export function buildFixtures(now: Date): ResolvedClientFixture[] {
  return CLIENTS.map((client) => ({
    slug: client.slug,
    name: client.name,
    projects: client.projects.map((project) => ({
      slug: project.slug,
      name: project.name,
      currency: project.currency,
      income: project.income.map((income) => ({
        slug: income.slug,
        kind: income.kind,
        amount: income.amount,
        ...(income.title ? { title: income.title } : {}),
        ...(income.notes ? { notes: income.notes } : {}),
        occurredOn: pastDate(now, income.occurredDaysAgo),
        ...(income.dueInDays !== undefined ? { dueDate: dueInDays(now, income.dueInDays) } : {}),
        ...(income.settle
          ? {
              settle: {
                paidAt: pastDate(now, income.occurredDaysAgo - income.settle.paidDaysAfter),
                ...(income.settle.amount ? { amount: income.settle.amount } : {}),
              },
            }
          : {}),
      })),
      expenses: project.expenses.map((expense) => ({
        slug: expense.slug,
        amount: expense.amount,
        title: expense.title,
        ...(expense.vendor ? { vendor: expense.vendor } : {}),
        occurredOn: pastDate(now, expense.occurredDaysAgo),
      })),
    })),
  }));
}
