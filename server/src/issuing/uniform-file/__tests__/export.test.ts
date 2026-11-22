import { describe, expect, it } from 'vitest';
import { composeDocument, type ComposeLineInput } from '../../compose.js';
import type { IssuedDocType } from '../../types.js';
import { buildUniformFile, DocumentTooLargeError, type UniformFileDocument, type UniformFileInput } from '../export.js';

/** MUT-569: issued documents → INI.TXT + BKMVDATA.TXT (spec 1.31). AC2 (counts match) and AC3 (no documents) live here. */

const shekels = (n: number): bigint => BigInt(Math.round(n * 100));
let seq = 0;

function doc(docType: IssuedDocType, number: number, over: Partial<Omit<UniformFileDocument, 'lines'>> & { lines?: ComposeLineInput[]; pricesIncludeVat?: boolean; discount?: bigint } = {}): UniformFileDocument {
  const composed = composeDocument({
    docType,
    currency: 'ILS',
    documentDate: over.documentDate ?? '2026-03-10',
    dealerType: 'COMPANY',
    documentDiscountMinor: over.discount ?? 0n,
    pricesIncludeVat: over.pricesIncludeVat ?? false,
    lines: over.lines ?? [{ description: 'ייעוץ', kind: 'SERVICE', quantityMilli: 2_000n, unitPriceMinor: shekels(500), discountMinor: 0n }],
  });
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    docType,
    number,
    documentDate: over.documentDate ?? '2026-03-10',
    issuedAt: over.issuedAt ?? new Date('2026-03-10T08:05:00Z'),
    subtotalMinor: composed.subtotalMinor,
    discountMinor: composed.discountMinor,
    netMinor: composed.netMinor,
    vatRateBasisPoints: composed.vatRateBasisPoints,
    vatMinor: composed.vatMinor,
    grossMinor: composed.grossMinor,
    customerId: over.customerId === undefined ? 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d' : over.customerId,
    customer: over.customer ?? { name: 'שירותי ענן בע"מ', taxId: '514713288', address: 'הרצל 5' },
    originalId: over.originalId ?? null,
    paymentDetails: over.paymentDetails ?? (docType === 'TAX_INVOICE_RECEIPT' || docType === 'RECEIPT' ? { method: 'BANK', reference: null, receivedOn: '2026-03-10' } : null),
    lines: composed.lines.map((l) => ({
      index: l.index,
      description: l.description,
      kind: l.kind,
      quantityMilli: l.quantityMilli,
      unitPriceMinor: l.unitPriceMinor,
      discountMinor: l.discountMinor,
      netMinor: l.netMinor,
      pricesIncludeVat: l.pricesIncludeVat,
      vatRateBasisPoints: l.vatRateBasisPoints,
      vatMinor: l.vatMinor,
    })),
  };
}

const input = (documents: UniformFileDocument[], over: Partial<UniformFileInput> = {}): UniformFileInput => ({
  issuer: { vatId: '515151515', legalName: 'סטודיו לדוגמה בע״מ', address: 'יפו 1', city: 'ירושלים', dealerType: 'COMPANY' },
  documents,
  originals: new Map(),
  range: { from: '2026-01-01', to: '2026-12-31' },
  producedAt: new Date('2026-11-22T16:30:00Z'),
  primaryId: '123456789012345',
  software: { registrationNumber: '00000000', name: 'MTB3A', version: '1.0.0', houseVatId: '517108775', houseName: 'נאראבנד סטודיו בע"מ' },
  ...over,
});

const lines = (buf: Uint8Array) => Buffer.from(buf).toString('latin1').split('\r\n').filter((l) => l.length > 0);
const field = (line: string, start: number, width: number) => line.slice(start - 1, start - 1 + width);
const code = (line: string) => line.slice(0, 4);
const signed = (s: string) => BigInt(s);

describe('buildUniformFile', () => {
  it('AC3: a profile with no documents gives A100 + Z900 and an INI with no summary lines', () => {
    const file = buildUniformFile(input([]));
    const bkmv = lines(file.bkmv);
    expect(bkmv.map(code)).toEqual(['A100', 'Z900']);
    expect(field(bkmv[1]!, 46, 15)).toBe('000000000000002');
    const ini = lines(file.ini);
    expect(ini.map(code)).toEqual(['A000']);
    expect(field(ini[0]!, 10, 15)).toBe('000000000000002');
    expect(file.totalRecords).toBe(2);
  });

  it('ends every record with CRLF, at its spec width, in ISO-8859-8', () => {
    const file = buildUniformFile(input([doc('TAX_INVOICE', 1), doc('TAX_INVOICE_RECEIPT', 1), doc('RECEIPT', 1)]));
    const text = Buffer.from(file.bkmv).toString('latin1');
    expect(text.endsWith('\r\n')).toBe(true);
    const widths: Record<string, number> = { A100: 95, C100: 444, D110: 339, D120: 222, Z900: 110 };
    for (const l of lines(file.bkmv)) expect(l.length).toBe(widths[code(l)]);
    for (const l of lines(file.ini)) expect(l.length).toBe(code(l) === 'A000' ? 466 : 19);
    expect([...file.bkmv].every((b) => b === 0x0d || b === 0x0a || (b >= 0x20 && b < 0x7f) || (b >= 0xe0 && b <= 0xfa))).toBe(true);
  });

  it('AC2: INI counts match BKMVDATA, record numbers run from 1, and the primary id is the same in three places', () => {
    const file = buildUniformFile(
      input([
        doc('TAX_INVOICE', 7, { lines: [line('א'), line('ב'), line('ג')] }),
        doc('TAX_INVOICE_RECEIPT', 3),
        doc('RECEIPT', 9, { customerId: null, customer: {} }),
      ]),
    );
    const bkmv = lines(file.bkmv);
    bkmv.forEach((l, i) => expect(Number(field(l, 5, 9))).toBe(i + 1));
    const ini = lines(file.ini);
    const summary = Object.fromEntries(ini.slice(1).map((l) => [code(l), Number(l.slice(4))]));
    const actual = bkmv.reduce<Record<string, number>>((acc, l) => ({ ...acc, [code(l)]: (acc[code(l)] ?? 0) + 1 }), {});
    expect(summary).toEqual({ C100: actual.C100, D110: actual.D110, D120: actual.D120 });
    expect(summary).toEqual({ C100: 3, D110: 4, D120: 2 });
    expect(Number(field(ini[0]!, 10, 15))).toBe(bkmv.length);
    expect(Number(field(bkmv.at(-1)!, 46, 15))).toBe(bkmv.length);
    expect(field(ini[0]!, 34, 15)).toBe('123456789012345');
    expect(field(bkmv[0]!, 23, 15)).toBe('123456789012345');
    expect(field(bkmv.at(-1)!, 23, 15)).toBe('123456789012345');
  });

  it('fills the INI header: constant, software, multi-year, no bookkeeping, range, Israel time, Hebrew, ISO-8859-8', () => {
    const a000 = lines(buildUniformFile(input([])).ini)[0]!;
    expect(field(a000, 25, 9)).toBe('515151515');
    expect(field(a000, 49, 8)).toBe('&OF1.31&');
    expect(field(a000, 65, 20).trim()).toBe('MTB3A');
    expect(field(a000, 105, 9)).toBe('517108775');
    expect(Buffer.from(field(a000, 114, 20).trim(), 'latin1')).toEqual(Buffer.from([0xf0, 0xe0, 0xf8, 0xe0, 0xe1, 0xf0, 0xe3, 0x20, 0xf1, 0xe8, 0xe5, 0xe3, 0xe9, 0xe5, 0x20, 0xe1, 0xf2, 0x22, 0xee]));
    expect(field(a000, 134, 1)).toBe('2');
    expect(field(a000, 135, 50).trim()).toBe('OPENFRMT\\51515151.26\\11221830');
    expect(field(a000, 185, 2)).toBe('00');
    expect(field(a000, 187, 9)).toBe('515151515');
    expect(field(a000, 367, 16)).toBe('2026010120261231');
    expect(field(a000, 383, 12)).toBe('202611221830');
    expect(field(a000, 395, 2)).toBe('01');
    expect(field(a000, 417, 3)).toBe('ILS');
  });

  it('names the folder OPENFRMT/<8 digits>.<YY>/<MMDDhhmm> in Israel time', () => {
    expect(buildUniformFile(input([])).folder).toBe('OPENFRMT/51515151.26/11221830');
  });

  it('a tax invoice with a document discount: lines add up to the header, the discount is negative', () => {
    const d = doc('TAX_INVOICE', 42, { discount: shekels(100), lines: [line('שעות', 10_000n, 300), line('נסיעה', 1_000n, 120, true)] });
    const [c100, ...d110] = lines(buildUniformFile(input([d])).bkmv).slice(1, -1);
    expect(field(c100!, 23, 3)).toBe('305');
    expect(field(c100!, 26, 20).trim()).toBe('42');
    const subtotal = signed(field(c100!, 288, 15));
    const discount = signed(field(c100!, 303, 15));
    const net = signed(field(c100!, 318, 15));
    const vat = signed(field(c100!, 333, 15));
    const gross = signed(field(c100!, 348, 15));
    expect(discount).toBeLessThan(0n);
    expect(subtotal + discount).toBe(net);
    expect(net + vat).toBe(gross);
    expect(d110.reduce((s, l) => s + signed(field(l, 271, 15)), 0n)).toBe(subtotal);
    for (const l of d110) {
      const qty = signed(field(l, 224, 17));
      const unit = signed(field(l, 241, 15));
      const lineDiscount = signed(field(l, 256, 15));
      expect(lineDiscount).toBeLessThanOrEqual(0n);
      expect((qty * unit + 5_000n) / 10_000n + lineDiscount).toBe(signed(field(l, 271, 15)));
    }
    expect(field(d110[0]!, 286, 4)).toBe('1800');
    expect(field(d110[1]!, 286, 4)).toBe('0000');
  });

  it('writes the issue time in Israel time, across daylight saving', () => {
    const summer = lines(buildUniformFile(input([doc('TAX_INVOICE', 1, { issuedAt: new Date('2026-07-01T21:30:00Z'), documentDate: '2026-07-02' })])).bkmv)[1]!;
    expect(field(summer, 46, 12)).toBe('202607020030');
    const winter = lines(buildUniformFile(input([doc('TAX_INVOICE', 1, { issuedAt: new Date('2026-01-15T21:30:00Z'), documentDate: '2026-01-15' })])).bkmv)[1]!;
    expect(field(winter, 46, 12)).toBe('202601152330');
  });

  it('a credit note names its tax invoice in D110 1256/1257 and keeps positive amounts', () => {
    const original = doc('TAX_INVOICE', 17);
    const credit = doc('CREDIT_NOTE', 2, { originalId: original.id });
    const out = lines(buildUniformFile(input([credit], { originals: new Map([[original.id, { docType: 'TAX_INVOICE', number: 17 }]]) })).bkmv);
    expect(field(out[1]!, 23, 3)).toBe('330');
    expect(signed(field(out[1]!, 348, 15))).toBeGreaterThan(0n);
    expect(field(out[2]!, 50, 3)).toBe('305');
    expect(field(out[2]!, 53, 20).trim()).toBe('17');
  });

  it('a receipt has a payment line and no item lines; with no customer it is a walk-in', () => {
    const out = lines(buildUniformFile(input([doc('RECEIPT', 5, { customerId: null, customer: {}, paymentDetails: { method: 'CASH', reference: null, receivedOn: '2026-03-09' } })])).bkmv);
    expect(out.map(code)).toEqual(['A100', 'C100', 'D120', 'Z900']);
    expect(field(out[1]!, 375, 15).trim()).toBe('0');
    expect(Buffer.from(field(out[1]!, 58, 50).trim(), 'latin1')).toEqual(Buffer.from([0xec, 0xf7, 0xe5, 0xe7, 0x20, 0xee, 0xe6, 0xe3, 0xee, 0xef]));
    expect(field(out[2]!, 50, 1)).toBe('1');
    expect(field(out[2]!, 96, 8)).toBe('20260309');
    expect(signed(field(out[2]!, 104, 15))).toBe(signed(field(out[1]!, 348, 15)));
  });

  it('an invoice-receipt has item lines and a bank-transfer payment line', () => {
    const out = lines(buildUniformFile(input([doc('TAX_INVOICE_RECEIPT', 8)])).bkmv);
    expect(out.map(code)).toEqual(['A100', 'C100', 'D110', 'D120', 'Z900']);
    expect(field(out[3]!, 50, 1)).toBe('4');
  });

  it('a payment request (MUT-662) is record type 300 with its lines', () => {
    const [c100, ...d110] = lines(buildUniformFile(input([doc('PAYMENT_REQUEST', 7)])).bkmv).slice(1, -1);
    expect(field(c100!, 23, 3)).toBe('300');
    expect(field(c100!, 26, 20).trim()).toBe('7');
    expect(d110.length).toBeGreaterThan(0);
    for (const l of d110) expect(field(l, 23, 3)).toBe('300');
  });

  it('writes the customer key, VAT number and an Arabic name in Hebrew letters', () => {
    const c100 = lines(buildUniformFile(input([doc('TAX_INVOICE', 1, { customer: { name: 'محمد', taxId: '039337766' } })])).bkmv)[1]!;
    expect(field(c100, 375, 15)).toBe('a1b2c3d4e5f64a7');
    expect(field(c100, 253, 9)).toBe('039337766');
    expect(Buffer.from(field(c100, 58, 4), 'latin1')).toEqual(Buffer.from([0xee, 0xe7, 0xee, 0xe3]));
  });

  it('totals each document type for the documents report', () => {
    const file = buildUniformFile(input([doc('TAX_INVOICE', 1), doc('TAX_INVOICE', 2), doc('RECEIPT', 1)]));
    expect(file.byType).toEqual([
      { docType: 'PAYMENT_REQUEST', count: 0, grossMinor: 0n },
      { docType: 'TAX_INVOICE', count: 2, grossMinor: shekels(1180) * 2n },
      { docType: 'TAX_INVOICE_RECEIPT', count: 0, grossMinor: 0n },
      { docType: 'CREDIT_NOTE', count: 0, grossMinor: 0n },
      { docType: 'RECEIPT', count: 1, grossMinor: shekels(1000) },
    ]);
  });

  it('VAT-inclusive prices: every line still adds up to the agora (unit price rounded up, the rest a discount)', () => {
    const docs = [117, 203.81, 99.99, 1180, 0.01, 33.33].map((price, i) =>
      doc('TAX_INVOICE', i + 1, { pricesIncludeVat: true, lines: [line('a', 3_000n, price), line('b', 1_500n, price + 1), line('c', 7_000n, price)] }),
    );
    for (const l of lines(buildUniformFile(input(docs)).bkmv).filter((r) => code(r) === 'D110')) {
      const qty = signed(field(l, 224, 17));
      const unit = signed(field(l, 241, 15));
      const discount = signed(field(l, 256, 15));
      expect(discount).toBeLessThanOrEqual(0n);
      expect((qty * unit + 5_000n) / 10_000n + discount).toBe(signed(field(l, 271, 15)));
    }
  });

  it('a document too large for the file is named, not written wrong', () => {
    const huge = doc('TAX_INVOICE', 9);
    huge.grossMinor = 10n ** 15n;
    expect(() => buildUniformFile(input([huge]))).toThrow(DocumentTooLargeError);
    try {
      buildUniformFile(input([huge]));
    } catch (err) {
      expect(err).toMatchObject({ docType: 'TAX_INVOICE', number: 9 });
    }
  });
});

function line(description: string, quantityMilli = 1_000n, price = 100, vatExempt = false): ComposeLineInput {
  return { description, kind: 'SERVICE', quantityMilli, unitPriceMinor: shekels(price), discountMinor: 0n, vatExempt };
}
