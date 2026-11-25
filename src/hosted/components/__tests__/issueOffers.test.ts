import { describe, expect, it } from 'vitest';
import { issueOffers } from '../issueOffers';
import type { IncomeResponse } from '../../api/client';

const saved = (kind: 'owed' | 'received', customerId: string | null) => ({ id: 'e1', kind, customerId, amount: '1180.00', currency: 'ILS', title: 'Design work' }) as unknown as IncomeResponse;
const types = (offers: ReturnType<typeof issueOffers>) => offers.map((o) => o.docType);

describe('issueOffers (MUT-648)', () => {
  it('offers a tax invoice for an Owed with a client, nothing without one', () => {
    expect(types(issueOffers(saved('owed', 'c1'), 'Services', false))).toEqual(['TAX_INVOICE']);
    expect(issueOffers(saved('owed', null), 'Services', false)).toEqual([]);
  });
  it('offers an invoice-receipt and a receipt for a Received with a client, a receipt without one', () => {
    expect(types(issueOffers(saved('received', 'c1'), 'Services', false))).toEqual(['TAX_INVOICE_RECEIPT', 'RECEIPT']);
    expect(types(issueOffers(saved('received', null), 'Services', false))).toEqual(['RECEIPT']);
  });
  it('an exempt dealer gets a receipt for a Received and a payment request for an Owed (MUT-662)', () => {
    expect(types(issueOffers(saved('owed', 'c1'), 'Services', true))).toEqual(['PAYMENT_REQUEST']);
    expect(issueOffers(saved('owed', null), 'Services', true)).toEqual([]);
    expect(types(issueOffers(saved('received', 'c1'), 'Services', true))).toEqual(['RECEIPT']);
  });
  it('links the document to the entry and keeps the typed amount VAT-included', () => {
    const [offer] = issueOffers(saved('received', 'c1'), 'Services', false);
    expect(offer.fromEntry).toEqual({ kind: 'received', id: 'e1' });
    expect(offer.lines?.[0]).toMatchObject({ unitPrice: '1180.00', pricesIncludeVat: true, description: 'Design work' });
  });

  it('MUT-661: an Owed follows the client\'s documents preference', () => {
    expect(types(issueOffers(saved('owed', 'c1'), 'Services', false, 'TAX_INVOICE_FIRST'))).toEqual(['TAX_INVOICE']);
    expect(types(issueOffers(saved('owed', 'c1'), 'Services', false, 'PAYMENT_REQUEST_FIRST'))).toEqual(['PAYMENT_REQUEST']);
    expect(issueOffers(saved('owed', 'c1'), 'Services', false, 'ON_PAYMENT')).toEqual([]);
    expect(issueOffers(saved('owed', 'c1'), 'Services', false, 'NO_DOCUMENT')).toEqual([]);
  });
  it('MUT-661: a Received offers its documents unless the client takes none', () => {
    expect(types(issueOffers(saved('received', 'c1'), 'Services', false, 'ON_PAYMENT'))).toEqual(['TAX_INVOICE_RECEIPT', 'RECEIPT']);
    expect(issueOffers(saved('received', 'c1'), 'Services', false, 'NO_DOCUMENT')).toEqual([]);
  });
});
