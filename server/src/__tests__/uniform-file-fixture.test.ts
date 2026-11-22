import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { UNIFORM_FILE_HOUSE_PLACEHOLDER } from '../issuing/uniform-file/export.js';
import { ADMIN, accountantHarness, businessOf, idem, json, person, read, type AccountantHarness } from './helpers/accountants.js';

/**
 * MUT-569 (AC1): the fixture Basel uploads to the Tax Authority's simulator, which wants at least 2,000 records and a
 * BKMVDATA of at most 4 MB. A business issues a year of every document type through the real routes, with Hebrew,
 * Arabic and English customers and lines, discounts, VAT-inclusive and exempt lines, cash and bank payments, receipts
 * with no customer and credit notes. With UNIFORM_FILE_FIXTURE_OUT=<dir> the files are written there for the upload:
 *
 *   UNIFORM_FILE_FIXTURE_OUT="$PWD/../docs/operations/tax-authority/uniform-file/fixture" \
 *   SOFTWARE_HOUSE_VAT_ID=517108775 SOFTWARE_HOUSE_NAME='נאראבנד סטודיו בע"מ' npx vitest run src/__tests__/uniform-file-fixture.test.ts
 *
 * The software house fields come from the same variables the API reads (config.ts), so the file carries the registering
 * owner (Narabnd Studio Ltd, MUT-700) without the code naming it; unset, the placeholders.
 */
const OUT = process.env.UNIFORM_FILE_FIXTURE_OUT;
const HOUSE = {
  registrationNumber: process.env.UNIFORM_FILE_REGISTRATION_NUMBER ?? UNIFORM_FILE_HOUSE_PLACEHOLDER.registrationNumber,
  houseVatId: process.env.SOFTWARE_HOUSE_VAT_ID ?? UNIFORM_FILE_HOUSE_PLACEHOLDER.houseVatId,
  houseName: process.env.SOFTWARE_HOUSE_NAME ?? UNIFORM_FILE_HOUSE_PLACEHOLDER.houseName,
};
const DAYS = 365;
const ISSUER = { legalName: 'סטודיו לדוגמה בע״מ', vatId: '515151512', dealerType: 'COMPANY', address: 'שדרות יפו 12', city: 'נצרת' };
const CUSTOMERS = [
  { name: 'שירותי ענן הגליל בע״מ', taxId: '514713288' },
  { name: 'شركة النور للتطوير', taxId: '039337761' },
  { name: 'Acme Digital Ltd.' },
  { name: 'محمد عبد الله' },
  { name: 'יוסי כהן ייעוץ' },
];
const LINES = ['פיתוח אפליקציה – ספרינט', 'تصميم واجهة المستخدم', 'Hosting and maintenance', 'ייעוץ טכני (שעות)', 'تدريب الفريق', 'SHAAM API integration'];

const day = (offset: number) => new Date(Date.UTC(2025, 10, 7 + offset)).toISOString().slice(0, 10);
const line = (i: number, over: Record<string, unknown> = {}) => ({ description: `${LINES[i % LINES.length]} ${i}`, kind: i % 4 === 0 ? 'GOODS' : 'SERVICE', quantity: String(1 + (i % 3)), unitPrice: `${100 + (i % 7) * 35}.50`, ...over });

async function business(h: AccountantHarness) {
  const owner = await person(h);
  expect((await h.app.request(`/admin/v1/users/${owner.userId}/features/invoicing`, { method: 'PUT', headers: ADMIN })).status).toBe(200);
  const on = owner.on(await businessOf(h, owner, 'Sample Studio'));
  expect((await h.app.request('/v1/issuer', json(ISSUER, on, 'PUT'))).status).toBe(200);
  expect((await h.app.request('/v1/issuing/numbering', json({ alreadyIssuing: false }, on, 'PUT'))).status).toBe(200);
  const customers: string[] = [];
  for (const c of CUSTOMERS) {
    const res = await h.app.request('/v1/customers', json(c, { ...on, ...idem() }));
    expect(res.status, await res.clone().text()).toBe(201);
    customers.push((await read(res)).id);
  }
  return { on, customers };
}

describe('uniform file simulator fixture (MUT-569, AC1)', () => {
  it('a year of every document type passes 2,000 records and stays under 4 MB', { timeout: 120_000 }, async () => {
    const h = accountantHarness({ uniformFileSoftware: HOUSE });
    h.setNow(new Date('2026-11-06T09:00:00Z'));
    const { on, customers } = await business(h);
    const issue = async (body: Record<string, unknown>) => {
      const res = await h.app.request('/v1/issued-documents', json({ currency: 'ILS', language: 'he', ...body }, { ...on, ...idem() }));
      expect(res.status, await res.clone().text()).toBe(201);
      return read(res);
    };

    const open: string[] = [];
    let n = 0;
    for (let d = 0; d < DAYS; d += 1) {
      const documentDate = day(d);
      const customerId = customers[d % customers.length]!;
      const invoice = await issue({
        docType: 'TAX_INVOICE',
        documentDate,
        customerId,
        pricesIncludeVat: d % 5 === 0,
        ...(d % 3 === 0 ? { discount: '25.00' } : {}),
        lines: [line(n++), line(n++, d % 6 === 0 ? { vatExempt: true } : { discount: '5.00' }), ...(d % 2 ? [line(n++)] : [])],
      });
      open.push(invoice.id);
      if (d % 2 === 0) {
        await issue({ docType: 'TAX_INVOICE_RECEIPT', documentDate, customerId, payment: { method: d % 4 ? 'BANK' : 'CASH', receivedOn: documentDate }, lines: [line(n++), ...(d % 4 ? [line(n++)] : [])] });
      }
      if (d % 3 === 0) {
        await issue({ docType: 'RECEIPT', documentDate, ...(d % 6 ? { customerId } : {}), payment: { method: d % 2 ? 'BANK' : 'CASH', receivedOn: documentDate }, lines: [{ description: d % 2 ? 'تسديد دفعة' : 'תשלום', kind: 'SERVICE', quantity: '1', unitPrice: '350.00' }] });
      }
      if (d % 4 === 1 && open.length > 1) {
        await issue({ docType: 'CREDIT_NOTE', documentDate, customerId, originalId: open[open.length - 1], lines: [{ description: d % 8 === 1 ? 'خصم متفق عليه' : 'זיכוי מוסכם', kind: 'SERVICE', quantity: '1', unitPrice: '20.00' }] });
      }
    }

    const res = await h.app.request(`/v1/issuing/uniform-file?from=${day(0)}&to=${day(DAYS - 1)}&lang=ar`, { headers: on });
    expect(res.status, await res.clone().text()).toBe(200);
    const zip = new Uint8Array(await res.arrayBuffer());
    const entries = unzipSync(zip);
    const folder = Object.keys(entries).find((k) => k.endsWith('/INI.TXT'))!.replace(/\/INI\.TXT$/, '');
    const ini = Buffer.from(entries[`${folder}/INI.TXT`]!);
    const bkmv = Buffer.from(unzipSync(entries[`${folder}/BKMVDATA.zip`]!)['BKMVDATA.TXT']!);
    const records = bkmv.toString('latin1').split('\r\n').filter(Boolean);
    const codes = new Set(records.map((r) => r.slice(0, 4)));
    const types = new Set(records.filter((r) => r.startsWith('C100')).map((r) => r.slice(22, 25)));

    expect(records.length).toBeGreaterThanOrEqual(2_000);
    expect(bkmv.length).toBeLessThan(4 * 1024 * 1024);
    expect([...codes].sort()).toEqual(['A100', 'C100', 'D110', 'D120', 'Z900']);
    expect([...types].sort()).toEqual(['305', '320', '330', '400']);
    // Hebrew letters (0xE0–0xFA) in the names and lines, Arabic ones written in them.
    expect([...bkmv].some((b) => b >= 0xe0 && b <= 0xfa)).toBe(true);
    expect(Number(res.headers.get('x-uniform-file-records'))).toBe(records.length);

    if (OUT) {
      mkdirSync(OUT, { recursive: true });
      writeFileSync(join(OUT, 'INI.TXT'), ini);
      writeFileSync(join(OUT, 'BKMVDATA.TXT'), bkmv);
      writeFileSync(join(OUT, 'OPENFRMT-fixture.zip'), zip);
      writeFileSync(join(OUT, 'report.html'), entries['report.html']!);
    }
  });
});
