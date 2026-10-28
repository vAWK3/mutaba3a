import { formatMoney, type Currency } from '../money.js';
import { encodeStatementCursor, type StatementLine, type StatementPage, type StatementView } from './build.js';

/** MUT-478: the wire shape of a statement page (`CustomerStatementSchema`); every amount gross, in the statement's currency. */
export function serializeStatement(input: { customerId: string; currency: Currency; view: StatementView; page: StatementPage }) {
  const { customerId, currency, view, page } = input;
  const money = (minor: bigint) => formatMoney({ minor, currency });
  return {
    customerId,
    currency,
    projectId: view.projectId,
    from: view.from,
    to: view.to,
    asOf: view.asOf,
    openingBalance: money(page.openingMinor),
    totals: { debit: money(page.totals.debitMinor), credit: money(page.totals.creditMinor) },
    closingBalance: money(page.closingMinor),
    lines: page.lines.map((line) => serializeLine(line, money)),
    nextCursor: page.nextCursor ? encodeStatementCursor(page.nextCursor) : null,
  };
}

function serializeLine(line: StatementLine, money: (minor: bigint) => string) {
  const base = { id: line.id, date: line.date, number: line.number, projectId: line.projectId, debit: money(line.debitMinor), credit: money(line.creditMinor), runningBalance: money(line.runningMinor) };
  switch (line.kind) {
    case 'CHARGE': {
      const r = line.receivable!;
      return {
        ...base,
        kind: 'CHARGE' as const,
        receivableId: r.id,
        origin: line.origin!,
        dueDate: r.dueDate,
        net: money(r.netMinor),
        vat: money(r.vatMinor),
        gross: money(r.grossMinor),
        outstanding: money(line.outstandingMinor!),
        status: line.status!,
        daysOverdue: line.daysOverdue,
      };
    }
    case 'CREDIT':
      return { ...base, kind: 'CREDIT' as const, receivableId: line.receivable!.id, receivableNumber: line.receivable!.number, reason: line.credit!.reason };
    case 'PAYMENT': {
      const p = line.payment!;
      return { ...base, kind: 'PAYMENT' as const, paymentId: p.id, method: p.method, reference: p.reference, unallocated: line.unallocatedMinor === null ? null : money(line.unallocatedMinor), allocated: line.allocatedMinor === null ? null : money(line.allocatedMinor) };
    }
    case 'PAYMENT_REVERSAL':
      return { ...base, kind: 'PAYMENT_REVERSAL' as const, paymentId: line.payment!.id, reason: line.payment!.reversalReason };
  }
}
