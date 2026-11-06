import type { ExpenseSummaryBlock } from '../expenses/summary.js';
import type { EntryRow } from '../repositories/ports.js';
import { serializeConversion, serializeExpense, serializeIncomeEntry } from '../serializers.js';

/**
 * MUT-560 review (ADR-246): what a visitor sees of an entry. Names, never ids: the client, project and category by name
 * (the category in the request's language, MUT-464), the vendor as written, and the entry itself by an opaque key
 * (row-key.ts) that only this link's receipts route understands. No profile, person, client, project, category,
 * vendor, settled-Owed or replaced-payment id. Built field by field, so a field added to the owner's shapes later never
 * reaches a stranger by accident.
 */
export interface VisitorContext {
  /** The opaque key of an entry id on this link. */
  key(id: string): string;
  category(id: string | null): string | null;
  client(id: string | null): string | null;
  project(id: string | null): string | null;
  /** READY receipts per expense id. */
  receiptCounts: ReadonlyMap<string, number>;
  /** The Owed a settle paid, per payment id. */
  settledOwed: ReadonlyMap<string, string>;
}

export function visitorEntry(row: EntryRow, ctx: VisitorContext) {
  const createdAt = row.record.createdAt.toISOString();
  switch (row.kind) {
    case 'expense': {
      const e = serializeExpense(row.record);
      return {
        kind: 'expense' as const,
        createdAt,
        expense: {
          key: ctx.key(e.id),
          occurredOn: e.occurredOn,
          amount: e.amount,
          currency: e.currency,
          title: e.title,
          vendor: e.vendor,
          category: ctx.category(e.categoryId),
          client: ctx.client(e.customerId),
          project: ctx.project(e.projectId),
          notes: e.notes,
          vat: e.vat,
          receiptCount: ctx.receiptCounts.get(e.id) ?? 0,
        },
      };
    }
    case 'payment':
      return {
        kind: 'received' as const,
        createdAt,
        origin: row.record.origin === 'CAPTURE' ? ('capture' as const) : ('integration' as const),
        settlesOwed: ctx.settledOwed.has(row.record.id),
        replacesPayment: row.record.replacesPaymentId !== null,
        income: visitorIncome(serializeIncomeEntry({ kind: 'received', payment: row.record }), ctx),
      };
    case 'receivable':
      return { kind: 'owed' as const, createdAt, income: visitorIncome(serializeIncomeEntry({ kind: 'owed', receivable: row.record }), ctx) };
    case 'conversion': {
      const c = serializeConversion(row.record);
      return { kind: 'conversion' as const, createdAt, conversion: { key: ctx.key(c.id), occurredOn: c.occurredOn, amount: c.amount, currency: c.currency, toAmount: c.toAmount, toCurrency: c.toCurrency, notes: c.notes } };
    }
  }
}

function visitorIncome(i: ReturnType<typeof serializeIncomeEntry>, ctx: VisitorContext) {
  return {
    key: ctx.key(i.id),
    kind: i.kind,
    amount: i.amount,
    currency: i.currency,
    occurredOn: i.occurredOn,
    client: ctx.client(i.customerId),
    project: ctx.project(i.projectId),
    title: i.title,
    notes: i.notes,
    dueDate: i.dueDate,
    status: i.status,
    reversalReason: i.reversalReason,
    reversalReasonCode: i.reversalReasonCode,
    credited: i.credited,
  };
}

/** The expense summary per currency with its breakdowns by name: `byCategory` and `byClient`. */
export function visitorExpenseSummary(blocks: readonly ExpenseSummaryBlock[], ctx: Pick<VisitorContext, 'category' | 'client'>) {
  return blocks.map((b) => ({
    currency: b.currency,
    total: b.total,
    count: b.count,
    byCategory: b.byCategory.map((g) => ({ category: ctx.category(g.categoryId), total: g.total, count: g.count })),
    byClient: b.byCustomer.map((g) => ({ client: ctx.client(g.customerId), total: g.total, count: g.count })),
  }));
}

/** The client, project and category ids a set of rows names, for one batch of name lookups. */
export function namedIds(rows: readonly EntryRow[]): { categories: Set<string>; customers: Set<string>; projects: Set<string> } {
  const categories = new Set<string>();
  const customers = new Set<string>();
  const projects = new Set<string>();
  const add = (set: Set<string>, id: string | null) => void (id && set.add(id));
  for (const row of rows) {
    if (row.kind === 'conversion') continue;
    if (row.kind === 'expense') add(categories, row.record.categoryId);
    add(customers, row.record.customerId);
    add(projects, row.record.projectId);
  }
  return { categories, customers, projects };
}
