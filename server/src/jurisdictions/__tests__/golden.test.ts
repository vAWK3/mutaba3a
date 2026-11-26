import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { composeDocument, type ComposeInput } from '../../issuing/compose.js';
import type { DealerType, IssuedDocType } from '../../issuing/types.js';
import { ISSUED_DOC_TYPES } from '../../issuing/types.js';
import { buildUniformFile, type UniformFileDocument } from '../../issuing/uniform-file/export.js';

/**
 * MUT-741 (AC1): the behaviour-preserving proof. Fixed inputs in, a hash of what comes out. The hashes were recorded on the
 * commit BEFORE the Israel rules moved behind the pack; every later commit must reproduce them. If one changes, an Israeli
 * document, number or uniform-file byte changed: fix the code, never the hash (a deliberate rules change is a new pack version).
 */

const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const plain = (value: unknown): string => JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
const shekels = (n: number): bigint => BigInt(Math.round(n * 100));

const LINES: ComposeInput['lines'] = [
  { description: 'ייעוץ', kind: 'SERVICE', quantityMilli: 2_000n, unitPriceMinor: shekels(500), discountMinor: 0n },
  { description: 'ציוד', kind: 'GOODS', quantityMilli: 1_500n, unitPriceMinor: shekels(120.35), discountMinor: shekels(10), vatExempt: true },
  { description: 'נסיעות', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(99.99), discountMinor: 0n, pricesIncludeVat: true },
];

function composeFor(docType: IssuedDocType, dealerType: DealerType, documentDate: string, extra: Partial<ComposeInput> = {}) {
  return composeDocument({ docType, currency: 'ILS', documentDate, dealerType, documentDiscountMinor: shekels(33.33), pricesIncludeVat: false, lines: LINES, ...extra });
}

const EXPECTED_COMPOSED: Record<string, string> = {
  "TAX_INVOICE/COMPANY/2026": '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b',
  "TAX_INVOICE_RECEIPT/COMPANY/2026": '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b',
  "CREDIT_NOTE/COMPANY/2026": '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b',
  "RECEIPT/COMPANY/2026": '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21',
  "PAYMENT_REQUEST/COMPANY/2026": '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b',
  "TAX_INVOICE/LICENSED/2024-12-31 (17%)": 'd731eaa5c4599f6436a937e9367d887642fecc8beb369680a094c6e9b7f8cae4',
  "TAX_INVOICE/LICENSED/2025-01-01 (18%)": '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b',
  "RECEIPT/EXEMPT": '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21',
  "PAYMENT_REQUEST/EXEMPT": '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21',
  "CREDIT_NOTE/at the invoice rate 17%": 'd731eaa5c4599f6436a937e9367d887642fecc8beb369680a094c6e9b7f8cae4',
  "TAX_INVOICE/inclusive": 'ab2ac1c3e69fd6a81df868734b81f9d245cc561ca73665a225d7f378369ad1d7',
};

describe('golden: composed documents', () => {
  const cases: [string, IssuedDocType, DealerType, string, Partial<ComposeInput>?][] = [
    ...ISSUED_DOC_TYPES.map((t): [string, IssuedDocType, DealerType, string] => [`${t}/COMPANY/2026`, t, 'COMPANY', '2026-03-10']),
    ['TAX_INVOICE/LICENSED/2024-12-31 (17%)', 'TAX_INVOICE', 'LICENSED', '2024-12-31'],
    ['TAX_INVOICE/LICENSED/2025-01-01 (18%)', 'TAX_INVOICE', 'LICENSED', '2025-01-01'],
    ['RECEIPT/EXEMPT', 'RECEIPT', 'EXEMPT', '2026-03-10'],
    ['PAYMENT_REQUEST/EXEMPT', 'PAYMENT_REQUEST', 'EXEMPT', '2026-03-10'],
    ['CREDIT_NOTE/at the invoice rate 17%', 'CREDIT_NOTE', 'LICENSED', '2026-03-10', { vatRateBasisPoints: 1700 }],
    ['TAX_INVOICE/inclusive', 'TAX_INVOICE', 'NONPROFIT', '2026-03-10', { pricesIncludeVat: true }],
  ];
  it.each(cases)('%s', (name, docType, dealer, date, extra) => {
    expect(sha(plain(composeFor(docType, dealer, date, extra)))).toBe(EXPECTED_COMPOSED[name] ?? `MISSING ${name}`);
  });
});

function uniformDoc(docType: IssuedDocType, number: number, n: number, dealerType: DealerType = 'COMPANY'): UniformFileDocument {
  const c = composeFor(docType, dealerType, '2026-03-10');
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    docType,
    number,
    documentDate: '2026-03-10',
    issuedAt: new Date('2026-03-10T08:05:00Z'),
    subtotalMinor: c.subtotalMinor,
    discountMinor: c.discountMinor,
    netMinor: c.netMinor,
    vatRateBasisPoints: c.vatRateBasisPoints,
    vatMinor: c.vatMinor,
    grossMinor: c.grossMinor,
    customerId: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    customer: { name: 'שירותי ענן בע"מ', taxId: '514713288', address: 'הרצל 5' },
    originalId: null,
    paymentDetails: docType === 'TAX_INVOICE_RECEIPT' || docType === 'RECEIPT' ? { method: 'BANK', reference: null, receivedOn: '2026-03-10' } : null,
    lines: c.lines.map((l) => ({ index: l.index, description: l.description, kind: l.kind, quantityMilli: l.quantityMilli, unitPriceMinor: l.unitPriceMinor, discountMinor: l.discountMinor, netMinor: l.netMinor, pricesIncludeVat: l.pricesIncludeVat, vatRateBasisPoints: l.vatRateBasisPoints, vatMinor: l.vatMinor })),
  };
}

describe('golden: the uniform file', () => {
  it('every document type in one file: INI.TXT and BKMVDATA.TXT bytes', () => {
    const documents = ISSUED_DOC_TYPES.map((t, i) => uniformDoc(t, 1000 + i, i + 1));
    const file = buildUniformFile({
      issuer: { vatId: '515151515', legalName: 'סטודיו לדוגמה בע״מ', address: 'יפו 1', city: 'ירושלים', dealerType: 'COMPANY' },
      documents,
      originals: new Map(),
      range: { from: '2026-01-01', to: '2026-12-31' },
      producedAt: new Date('2026-11-22T16:30:00Z'),
      primaryId: '123456789012345',
      software: { registrationNumber: '00000000', name: 'MTB3A', version: '1.0.0', houseVatId: '517108775', houseName: 'נאראבנד סטודיו בע"מ' },
    });
    expect({ ini: sha(file.ini), bkmv: sha(file.bkmv), records: file.totalRecords }).toEqual({ ini: 'd68ae4161704a47df281990966466df79a0a8a7e42e387e7649384702045b617', bkmv: '046cd43582a66aaeda20ada84c38672a3d08e07ccd1d67f78b9bd365b81ffff5', records: 21 });
  });
});
