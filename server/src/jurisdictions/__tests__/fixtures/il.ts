import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { issuingHarness, read, type AccountantHarness } from '../../../__tests__/helpers/accountants.js';
import { composeDocument } from '../../../issuing/compose.js';
import type { DealerType, IssuedDocType } from '../../../issuing/types.js';
import { ISSUED_DOC_TYPES } from '../../../issuing/types.js';
import { IL_PACK } from '../../il/index.js';
import { FakeTaxAuthority } from '../../il/tax-authority/__tests__/fake-client.js';
import { TokenBox } from '../../il/tax-authority/token-box.js';
import { buildUniformFile, type UniformFileDocument } from '../../il/uniform-file/export.js';
import type { PackFixture } from './types.js';

/**
 * MUT-745: the Israel pack's fixture. `expected` is what il-pack.contract.test.ts asserted before MUT-745, moved here
 * unchanged (MUT-741 identity, codes and flags; MUT-743 dealers, forms, languages, mask, clearance). `golden` holds the
 * hashes MUT-741 recorded on the commit before the rules moved behind the pack: fix the code, never a hash.
 * The uniform-file simulator fixture (≥ 2,000 records) stays in `src/__tests__/uniform-file-fixture.test.ts`.
 */
const sha = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
const shekels = (n: number): bigint => BigInt(Math.round(n * 100));

const ALL: readonly IssuedDocType[] = ['TAX_INVOICE', 'PAYMENT_REQUEST', 'TAX_INVOICE_RECEIPT', 'RECEIPT', 'CREDIT_NOTE'];
const registered = (value: DealerType) => ({
  value,
  labelKey: `IL.${value}`,
  issues: ALL,
  exemptFromVat: false,
  defaultType: 'TAX_INVOICE' as const,
  entryTypes: { owed: ['TAX_INVOICE', 'PAYMENT_REQUEST'] as IssuedDocType[], received: ['TAX_INVOICE_RECEIPT', 'RECEIPT'] as IssuedDocType[] },
});

const GOLDEN_LINES = [
  { description: 'ייעוץ', kind: 'SERVICE' as const, quantityMilli: 2_000n, unitPriceMinor: shekels(500), discountMinor: 0n },
  { description: 'ציוד', kind: 'GOODS' as const, quantityMilli: 1_500n, unitPriceMinor: shekels(120.35), discountMinor: shekels(10), vatExempt: true },
  { description: 'נסיעות', kind: 'SERVICE' as const, quantityMilli: 1_000n, unitPriceMinor: shekels(99.99), discountMinor: 0n, pricesIncludeVat: true },
];
const GOLDEN_DISCOUNT = shekels(33.33);

function composeFor(docType: IssuedDocType, dealerType: DealerType, documentDate: string) {
  return composeDocument({ pack: IL_PACK, docType, currency: 'ILS', documentDate, dealerType, documentDiscountMinor: GOLDEN_DISCOUNT, pricesIncludeVat: false, lines: GOLDEN_LINES });
}

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

function uniformFileGolden() {
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
  return [
    {
      name: 'the uniform file: every document type in one file, INI.TXT and BKMVDATA.TXT bytes',
      actual: { ini: sha(file.ini), bkmv: sha(file.bkmv), records: file.totalRecords },
      expected: { ini: 'd68ae4161704a47df281990966466df79a0a8a7e42e387e7649384702045b617', bkmv: '046cd43582a66aaeda20ada84c38672a3d08e07ccd1d67f78b9bd365b81ffff5', records: 21 },
    },
  ];
}

/** The Tax Authority, scripted (as routes-tax-authority.test.ts drives it). */
const box = new TokenBox('route-test-secret-with-at-least-32-characters');
const clients = new WeakMap<AccountantHarness, FakeTaxAuthority>();
function clearanceHarness(): AccountantHarness {
  const client = new FakeTaxAuthority();
  const h = issuingHarness({ taxAuthority: { client, box, stateSecret: 'state-secret-for-tests', accountingSoftwareNumber: 987654321 } });
  clients.set(h, client);
  return h;
}
async function connectAndRefuseNext(h: AccountantHarness, on: Record<string, string>): Promise<void> {
  const started = await read(await h.app.request('/v1/issuing/tax-authority/connect', { method: 'POST', headers: { ...on, origin: 'http://localhost' } }));
  const state = new URL(started.authorizeUrl).searchParams.get('state')!;
  const back = await h.app.request(`/v1/issuing/tax-authority/callback?code=good-code&state=${encodeURIComponent(state)}`);
  expect(back.status).toBeLessThan(400);
  clients.get(h)!.answers = [{ kind: 'refused', errors: [{ code: 434, message: 'Invoice date is too old for approval', param: 'invoice_date' }] }];
}

export const IL_FIXTURE: PackFixture = {
  country: 'IL',
  expected: {
    identity: { country: 'IL', version: '1.0.0', timezone: 'Asia/Jerusalem', currency: { base: 'ILS', issuing: ['ILS'] }, retentionYears: 7 },
    documentTypes: {
      TAX_INVOICE: { code: 305, vatBearing: true, taxDocument: true, takesPayment: false, hasDueDate: true, needsCustomer: true },
      TAX_INVOICE_RECEIPT: { code: 320, vatBearing: true, taxDocument: true, takesPayment: true, hasDueDate: false, needsCustomer: true },
      CREDIT_NOTE: { code: 330, vatBearing: true, taxDocument: true, takesPayment: false, hasDueDate: false, needsCustomer: true },
      RECEIPT: { code: 400, vatBearing: false, taxDocument: false, takesPayment: true, hasDueDate: false, needsCustomer: false },
      PAYMENT_REQUEST: { code: 300, vatBearing: true, taxDocument: false, takesPayment: false, hasDueDate: true, needsCustomer: true },
    },
    codeOrder: ['PAYMENT_REQUEST', 'TAX_INVOICE', 'TAX_INVOICE_RECEIPT', 'CREDIT_NOTE', 'RECEIPT'],
    vatOn: [
      ['2015-09-30', 1700], // before the table starts: the first rate
      ['2015-10-01', 1700],
      ['2024-12-31', 1700],
      ['2025-01-01', 1800],
      ['2026-11-26', 1800],
    ],
    dealers: [
      registered('LICENSED'),
      { value: 'EXEMPT', labelKey: 'IL.EXEMPT', issues: ['RECEIPT', 'PAYMENT_REQUEST'], exemptFromVat: true, defaultType: 'RECEIPT', entryTypes: { owed: ['PAYMENT_REQUEST'], received: ['RECEIPT'] } },
      registered('COMPANY'),
      registered('NONPROFIT'),
    ],
    refusalReason: 'EXEMPT_DEALER_TAX_INVOICE',
    languages: { available: ['he', 'ar', 'en'], default: 'he' },
    taxId: { scheme: 'IL_TAX_ID', pattern: '^\\d{9}$', maxLength: 9, valid: ['515151512'], invalid: ['515151515'] },
    perLineExemption: true,
    clearanceKind: 'IL_ALLOCATION',
    statutoryFileMime: 'application/zip',
    datedTables: ['vat.standardRate', 'expense.allocationThreshold'],
  },
  golden: {
    currency: 'ILS',
    lines: GOLDEN_LINES,
    documentDiscountMinor: GOLDEN_DISCOUNT,
    pricesIncludeVat: false,
    composed: [
      { name: 'TAX_INVOICE/COMPANY/2026', docType: 'TAX_INVOICE', dealer: 'COMPANY', date: '2026-03-10', sha: '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b' },
      { name: 'TAX_INVOICE_RECEIPT/COMPANY/2026', docType: 'TAX_INVOICE_RECEIPT', dealer: 'COMPANY', date: '2026-03-10', sha: '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b' },
      { name: 'CREDIT_NOTE/COMPANY/2026', docType: 'CREDIT_NOTE', dealer: 'COMPANY', date: '2026-03-10', sha: '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b' },
      { name: 'RECEIPT/COMPANY/2026', docType: 'RECEIPT', dealer: 'COMPANY', date: '2026-03-10', sha: '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21' },
      { name: 'PAYMENT_REQUEST/COMPANY/2026', docType: 'PAYMENT_REQUEST', dealer: 'COMPANY', date: '2026-03-10', sha: '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b' },
      { name: 'TAX_INVOICE/LICENSED/2024-12-31 (17%)', docType: 'TAX_INVOICE', dealer: 'LICENSED', date: '2024-12-31', sha: 'd731eaa5c4599f6436a937e9367d887642fecc8beb369680a094c6e9b7f8cae4' },
      { name: 'TAX_INVOICE/LICENSED/2025-01-01 (18%)', docType: 'TAX_INVOICE', dealer: 'LICENSED', date: '2025-01-01', sha: '5e8acd1b55d1e53680e86b8fa3695c72b2c891a681cca4cab4f679fe9e31c47b' },
      { name: 'RECEIPT/EXEMPT', docType: 'RECEIPT', dealer: 'EXEMPT', date: '2026-03-10', sha: '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21' },
      { name: 'PAYMENT_REQUEST/EXEMPT', docType: 'PAYMENT_REQUEST', dealer: 'EXEMPT', date: '2026-03-10', sha: '9bcc05dd8e04bed3d7e8358db00bbe468023d9d5dc2d86e1939bae220b09db21' },
      { name: 'CREDIT_NOTE/at the invoice rate 17%', docType: 'CREDIT_NOTE', dealer: 'LICENSED', date: '2026-03-10', extra: { vatRateBasisPoints: 1700 }, sha: 'd731eaa5c4599f6436a937e9367d887642fecc8beb369680a094c6e9b7f8cae4' },
      { name: 'TAX_INVOICE/inclusive', docType: 'TAX_INVOICE', dealer: 'NONPROFIT', date: '2026-03-10', extra: { pricesIncludeVat: true }, sha: 'ab2ac1c3e69fd6a81df868734b81f9d245cc561ca73665a225d7f378369ad1d7' },
    ],
    files: uniformFileGolden,
  },
  route: {
    issuer: { legalName: 'Barmajiyat Ltd.', vatId: '515151512', dealerType: 'COMPANY', city: 'Nazareth', country: 'IL' },
    document: (customerId) => ({
      docType: 'TAX_INVOICE',
      documentDate: '2026-11-05',
      currency: 'ILS',
      language: 'he',
      customerId,
      lines: [
        { description: 'ייעוץ', kind: 'SERVICE', quantity: '2', unitPrice: '450.00' },
        { description: 'تطوير', kind: 'SERVICE', quantity: '1', unitPrice: '99.99', discount: '9.99' },
        { description: 'Hosting', kind: 'GOODS', quantity: '1.5', unitPrice: '120.35', vatExempt: true },
      ],
      discount: '33.33',
    }),
    clearanceFailure: {
      harness: clearanceHarness,
      prepare: connectAndRefuseNext,
      customer: { name: 'Acme Digital Ltd.', taxId: '516123452' },
      document: (customerId) => ({ docType: 'TAX_INVOICE', documentDate: '2026-11-05', currency: 'ILS', language: 'he', customerId, lines: [{ description: 'פיתוח אפליקציה', kind: 'SERVICE', quantity: '1', unitPrice: '6000.00' }] }),
      reason: 'ALLOCATION_REFUSED',
    },
  },
};
