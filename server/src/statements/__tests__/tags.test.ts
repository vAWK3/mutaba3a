import { describe, expect, it } from 'vitest';
import type { DueItem } from '../../issuing/documents-due.js';
import type { ExternalInvoiceRecord, IssuedDocumentRecord } from '../../repositories/ports.js';
import type { StatementLine } from '../build.js';
import { statementTags } from '../tags.js';

const charge = { id: 'r1', kind: 'CHARGE', receivableId: 'r1', paymentId: null, payment: null, credit: null } as unknown as StatementLine;
const payment = { id: 'p1', kind: 'PAYMENT', receivableId: null, paymentId: 'p1', payment: { receiptNumber: 'R-77' }, credit: null } as unknown as StatementLine;
const credit = { id: 'c1', kind: 'CREDIT', receivableId: 'r1', paymentId: null, payment: null, credit: { id: 'c1' } } as unknown as StatementLine;
const reversal = { id: 'p1:reversal', kind: 'PAYMENT_REVERSAL', paymentId: 'p1' } as unknown as StatementLine;
const doc = (o: Partial<IssuedDocumentRecord>) => ({ receivableId: null, paymentId: null, creditId: null, ...o }) as IssuedDocumentRecord;
const due = (kind: DueItem['kind'], entryKind: 'receivable' | 'payment', id: string) => ({ kind, entry: { kind: entryKind, id, number: 'x' } }) as DueItem;

describe('statementTags (MUT-664)', () => {
  it('puts each document on its line and the due document beside it', () => {
    const tags = statementTags([charge, payment, credit, reversal], {
      issued: [doc({ id: 'd305', docType: 'TAX_INVOICE', number: 1044, receivableId: 'r1' }), doc({ id: 'd330', docType: 'CREDIT_NOTE', number: 3, receivableId: 'r1', creditId: 'c1' }), doc({ id: 'd400', docType: 'RECEIPT', number: 2210, paymentId: 'p1' })],
      external: [{ entryKind: 'OWED', entryId: 'r1', number: 'EXT-9', removedAt: null } as ExternalInvoiceRecord, { entryKind: 'OWED', entryId: 'r1', number: 'GONE', removedAt: new Date() } as ExternalInvoiceRecord],
      due: [due('RECEIPT', 'payment', 'p1')],
    });
    expect(tags.get('r1')).toEqual({ documents: [{ id: 'd305', source: 'ISSUED', docType: 'TAX_INVOICE', number: '1044' }, { id: null, source: 'EXTERNAL', docType: 'TAX_INVOICE', number: 'EXT-9' }], due: null });
    expect(tags.get('p1')).toEqual({ documents: [{ id: 'd400', source: 'ISSUED', docType: 'RECEIPT', number: '2210' }, { id: null, source: 'EXTERNAL', docType: 'RECEIPT', number: 'R-77' }], due: 'RECEIPT' });
    expect(tags.get('c1')!.documents.map((d) => d.number)).toEqual(['3']);
    expect(tags.get('p1:reversal')).toEqual({ documents: [], due: null });
  });

  it('an Owed with nothing issued shows what it is due', () => {
    expect(statementTags([charge], { issued: [], external: [], due: [due('TAX_INVOICE', 'receivable', 'r1')] }).get('r1')).toEqual({ documents: [], due: 'TAX_INVOICE' });
  });
});
