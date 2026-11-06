import { describe, expect, it, vi } from 'vitest';
import { periodDownloadStoreGuard } from '../auth/store-guard.js';
import { LOCKED_OPEN_ENDPOINTS } from '../billing/gate.js';
import { SlidingWindowRateLimiter } from '../rate-limit.js';
import { ADMIN, T0, businessOf, json, person, read, shared, type Loose, type Person } from './helpers/accountants.js';
import {
  download,
  downloadHarness,
  expenseOn,
  indexOf,
  linkMint,
  mintOk,
  mintRequest,
  receiptOn,
  receivedOn,
  rowsOf,
  streamRequest,
  workbookOf,
  zipOf,
  type DownloadHarness,
} from './helpers/period-downloads.js';
import { linkOn, viewerOf } from './helpers/share-links.js';

/**
 * MUT-314 (ADR-248): download a period as an Excel report or a receipts zip, through the real app: mint a ticket
 * (owner, accountant or share link), then stream it. The numbered groups are the plan's (1, 5 and 7's pure parts and
 * 12's helper live in period-pack/__tests__ and http/__tests__).
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PDF = new TextEncoder().encode('%PDF-1.4 a receipt');
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const later = (h: DownloadHarness, ms: number) => h.setNow(new Date(h.now().getTime() + ms));
const errorOf = async (res: Response) => (await read(res)).error;

async function owner(h: DownloadHarness, options: { locale?: 'en' | 'ar' } = {}) {
  const p = await person(h, { displayName: 'Basel Sader', ...options });
  return { p, profileId: p.personalId };
}

const expenseRows = async (res: Response) => rowsOf((await workbookOf(res)).worksheets[0]!);

describe('2. the period, end to end (MUT-314)', () => {
  it('only the money dates inside the months appear; deleted expenses and undone payments never do', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    for (const [day, title] of [['2026-09-30', 'before'], ['2026-10-01', 'first'], ['2026-10-31', 'last'], ['2026-11-01', 'after']]) await expenseOn(h, p, profileId, { occurredOn: day, title });
    const gone = await expenseOn(h, p, profileId, { occurredOn: '2026-10-10', title: 'deleted' });
    expect((await h.app.request(`/v1/expenses/${gone.id}`, { method: 'DELETE', headers: { ...p.on(profileId), 'if-match': String(gone.version) } })).status).toBe(204);
    await receivedOn(h, p, profileId, '2026-09-30', '1.00');
    const kept = await receivedOn(h, p, profileId, '2026-10-15', '2.00');
    const undone = await receivedOn(h, p, profileId, '2026-10-16', '3.00');
    expect((await h.app.request(`/v1/income/${undone.id}`, { method: 'DELETE', headers: p.on(profileId) })).status).toBe(204);

    const wb = await workbookOf(await download(h, p, profileId));
    expect(rowsOf(wb.getWorksheet('Expenses')!).slice(1).map((r) => r[3])).toEqual(['first', 'last']);
    expect(rowsOf(wb.getWorksheet('Income')!).slice(1).map((r) => r[13])).toEqual([kept.id]);
  });

  it('a span of months runs from the first day of `from` to the last day of `to`', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    for (const day of ['2026-07-31', '2026-08-01', '2026-10-31']) await expenseOn(h, p, profileId, { occurredOn: day, title: day });
    const rows = await expenseRows(await download(h, p, profileId, { from: '2026-08', to: '2026-10' }));
    expect(rows.slice(1).map((r) => r[3])).toEqual(['2026-08-01', '2026-10-31']);
  });

  it('refuses 25 months, a future month and a bad asOf (422)', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    for (const [q, reason] of [
      [{ from: '2024-10', to: '2026-10' }, 'PERIOD_RANGE'],
      [{ from: '2026-12', to: '2026-12' }, 'PERIOD_RANGE'],
      [{ asOf: '2026-11-07T00:00:00Z' }, 'AS_OF'],
    ] as const) {
      const res = await mintRequest(h, p, profileId, q);
      expect(res.status).toBe(422);
      expect((await errorOf(res)).details).toMatchObject({ reason });
    }
    expect((await mintRequest(h, p, profileId, { from: '2026-11', to: '2026-11' })).status).toBe(200);
  });
});

describe('3. Refs agree across the two downloads (MUT-314, D22)', () => {
  it('the same asOf gives the same Refs and file names; an entry logged after it, even backdated, is in neither', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { occurredOn: '2026-10-05', title: 'A' });
    const b = await expenseOn(h, p, profileId, { occurredOn: '2026-10-20', title: 'B' });
    await receiptOn(h, p, profileId, a.id, PNG);
    await receiptOn(h, p, profileId, b.id, PDF, 'application/pdf');
    const asOf = h.now().toISOString();
    later(h, 60_000);
    await expenseOn(h, p, profileId, { occurredOn: '2026-10-01', title: 'late but earliest' });

    const report = await expenseRows(await download(h, p, profileId, { asOf }));
    const zip = await zipOf(await download(h, p, profileId, { type: 'receipts', asOf }));
    expect(report.slice(1).map((r) => [r[0], r[3], r[15]])).toEqual([
      ['E0001', 'A', 'E0001-1.png'],
      ['E0002', 'B', 'E0002-1.pdf'],
    ]);
    expect(Object.keys(zip).sort()).toEqual(['index.csv', 'receipts/E0001-1.png', 'receipts/E0002-1.pdf']);

    // Without the shared asOf the new row takes E0001; each index line still names its row by id.
    const fresh = indexOf(await zipOf(await download(h, p, profileId, { type: 'receipts' })));
    expect(fresh.slice(1).map((l) => [l[0], l[7]])).toEqual([
      ['receipts/E0002-1.png', a.id],
      ['receipts/E0003-1.pdf', b.id],
    ]);
  });
});

describe('4. money (MUT-314)', () => {
  it('2 decimals for ILS, USD, EUR; 3 for JOD; large amounts exact; the Summary per currency, never summed', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    await expenseOn(h, p, profileId, { amount: '12.50', currency: 'ILS', title: 'ils' });
    await expenseOn(h, p, profileId, { amount: '12.50', currency: 'USD', title: 'usd' });
    await expenseOn(h, p, profileId, { amount: '12.5', currency: 'EUR', title: 'eur' });
    await expenseOn(h, p, profileId, { amount: '12.500', currency: 'JOD', title: 'jod' });
    await expenseOn(h, p, profileId, { amount: '9999999999999.99', currency: 'ILS', title: 'large' });
    await receivedOn(h, p, profileId, '2026-10-07', '1.250', 'JOD');

    const wb = await workbookOf(await download(h, p, profileId));
    const ws = wb.getWorksheet('Expenses')!;
    const byTitle = new Map(rowsOf(ws).slice(1).map((r, i) => [r[3], i + 2]));
    const amount = (title: string) => ws.getCell(`I${byTitle.get(title)}`);
    expect([amount('ils').value, amount('ils').numFmt]).toEqual([12.5, '0.00']);
    expect([amount('usd').value, amount('eur').numFmt]).toEqual([12.5, '0.00']);
    expect([amount('jod').value, amount('jod').numFmt]).toEqual([12.5, '0.000']);
    expect(amount('large').value).toBe(9999999999999.99);

    const summary = rowsOf(wb.getWorksheet('Summary')!);
    const table = summary.slice(summary.findIndex((r) => r[0] === 'Currency') + 1);
    expect(table.map((r) => [r[0], r[1], r[2], r[5], r[6]])).toEqual([
      ['EUR', 1, 12.5, 0, 0],
      ['ILS', 2, 10000000000012.49, 0, 0],
      ['JOD', 1, 12.5, 1, 1.25],
      ['USD', 1, 12.5, 0, 0],
    ]);
  });
});

describe('5. the Excel report (MUT-314)', () => {
  it('Arabic: Arabic sheet names and headers, right to left; Arabic, Hebrew and emoji text intact; =1+1 stays text', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h, { locale: 'ar' });
    await expenseOn(h, p, profileId, { title: 'قهوة الصباح ☕️', vendor: 'קפה ירושלים', notes: '=1+1' });
    const wb = await workbookOf(await download(h, p, profileId, { lang: 'ar' }));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['المصروفات', 'الدخل', 'الملخص']);
    const ws = wb.worksheets[0]!;
    expect(ws.views[0]).toMatchObject({ rightToLeft: true });
    expect(rowsOf(ws)[0]!.slice(0, 3)).toEqual(['رقم القيد', 'التاريخ', 'المورّد']);
    const row = rowsOf(ws)[1]!;
    expect([row[2], row[3], row[13]]).toEqual(['קפה ירושלים', 'قهوة الصباح ☕️', '=1+1']);
    expect(ws.getCell('N2').formula).toBeUndefined();
  });

  it('English by default for an English person; left to right; both sheets even with no income', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    await expenseOn(h, p, profileId, { title: 'Paper' });
    const wb = await workbookOf(await download(h, p, profileId));
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Expenses', 'Income', 'Summary']);
    expect(wb.worksheets[0]!.views[0]?.rightToLeft ?? false).toBe(false);
    expect(rowsOf(wb.getWorksheet('Income')!)).toEqual([['Ref', 'Date received', 'Client', 'Project', 'Currency', 'Amount', 'Method', 'Reference', 'Receipt number', 'Notes', 'Source', 'Logged by', 'Logged at', 'Id']]);
    expect(rowsOf(wb.worksheets[0]!)[1]![16]).toBe('Basel Sader');
  });
});

describe('6 + 7. the receipts zip matches the report (MUT-314, AC2)', () => {
  it('every READY receipt of an in-range expense is there under its Ref, as the report names it; nothing else is', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { occurredOn: '2026-10-03', title: 'A', vendor: '=cmd' });
    const none = await expenseOn(h, p, profileId, { occurredOn: '2026-10-04', title: 'none' });
    const outside = await expenseOn(h, p, profileId, { occurredOn: '2026-09-04', title: 'outside' });
    const deleted = await expenseOn(h, p, profileId, { occurredOn: '2026-10-05', title: 'deleted' });
    await receiptOn(h, p, profileId, a.id, PNG);
    later(h, 1000);
    await receiptOn(h, p, profileId, a.id, PDF, 'application/pdf');
    await receiptOn(h, p, profileId, outside.id, PNG);
    await receiptOn(h, p, profileId, deleted.id, PNG);
    await h.app.request(`/v1/expenses/${deleted.id}`, { method: 'DELETE', headers: { ...p.on(profileId), 'if-match': String(deleted.version) } });
    // A To-review receipt (no expense) never belongs to a period.
    await h.store.expenseReceipts.create({ organizationId: profileId, expenseId: null, filename: 'x.png', mimeType: 'image/png', sizeBytes: 3, receivedOn: '2026-10-06', uploadedByUserId: p.userId, requestId: null }, h.now());

    const report = await expenseRows(await download(h, p, profileId));
    expect(report.slice(1).map((r) => [r[0], r[3], r[14], r[15] ?? null])).toEqual([
      ['E0001', 'A', 2, 'E0001-1.png; E0001-2.pdf'],
      ['E0002', 'none', 0, null],
    ]);
    const files = await zipOf(await download(h, p, profileId, { type: 'receipts' }));
    expect(Object.keys(files).sort()).toEqual(['index.csv', 'receipts/E0001-1.png', 'receipts/E0001-2.pdf']);
    expect(files['receipts/E0001-1.png']).toEqual(PNG);
    expect(files['receipts/E0001-2.pdf']).toEqual(PDF);
    const index = indexOf(files);
    expect(index[0]).toEqual(['File', 'Ref', 'Date', 'Vendor', 'Currency', 'Amount', 'Status', 'Row id']);
    expect(index.slice(1)).toEqual([
      ['receipts/E0001-1.png', 'E0001', '2026-10-03', "'=cmd", 'ILS', '12.00', 'ok', a.id],
      ['receipts/E0001-2.pdf', 'E0001', '2026-10-03', "'=cmd", 'ILS', '12.00', 'ok', a.id],
    ]);
    expect(none.id).toBeTruthy();
  });

  it('index.csv: the BOM first, CRLF, headers in the download’s language, a negative-looking amount never guarded', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h, { locale: 'ar' });
    const a = await expenseOn(h, p, profileId, { title: 'A', vendor: 'مطبعة، رام الله' });
    await receiptOn(h, p, profileId, a.id, PNG);
    const files = await zipOf(await download(h, p, profileId, { type: 'receipts', lang: 'ar' }));
    const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(files['index.csv']!);
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1).split('\r\n')[0]).toBe('الملف,رقم القيد,التاريخ,المورّد,العملة,المبلغ,الحالة,معرّف القيد');
    expect(text).toContain(',مطبعة، رام الله,');
    expect(text.endsWith('\r\n')).toBe(true);
  });

  it('a receipt missing from the bucket is listed `missing`; the rest of the zip is whole; one error is logged', async () => {
    const h = downloadHarness();
    const errors = vi.spyOn(h.logger, 'error');
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { occurredOn: '2026-10-03', title: 'A' });
    const b = await expenseOn(h, p, profileId, { occurredOn: '2026-10-04', title: 'B' });
    const lost = await receiptOn(h, p, profileId, a.id, PNG);
    await receiptOn(h, p, profileId, b.id, PDF, 'application/pdf');
    await h.storage.remove(lost.storageKey);

    const files = await zipOf(await download(h, p, profileId, { type: 'receipts' }));
    expect(Object.keys(files).sort()).toEqual(['index.csv', 'receipts/E0002-1.pdf']);
    expect(indexOf(files).slice(1).map((l) => [l[0], l[6]])).toEqual([
      ['receipts/E0001-1.png', 'missing'],
      ['receipts/E0002-1.pdf', 'ok'],
    ]);
    expect(errors).toHaveBeenCalledTimes(1);
    expect(errors.mock.calls[0]![0]).toMatchObject({ missing: 1 });
  });
});

describe('8. who may download (MUT-314)', () => {
  it('owner, co-owner and member: 200; a stranger and another profile: 404', async () => {
    const h = downloadHarness();
    const { p } = await owner(h);
    const business = await businessOf(h, p, 'Sader Studio');
    const co = await person(h);
    expect((await h.app.request(`/admin/v1/users/${co.userId}/memberships`, json({ organizationId: business, role: 'OWNER' }, ADMIN))).status).toBe(201);
    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const member = await person(h);
    expect((await h.app.request(`/admin/v1/users/${member.userId}/memberships`, json({ organizationId: firm.id }, ADMIN))).status).toBe(201);
    const stranger = await person(h);

    expect((await download(h, p, business)).status).toBe(200);
    expect((await download(h, co, business)).status).toBe(200);
    expect((await download(h, member, firm.id, { type: 'receipts' })).status).toBe(200);
    expect((await mintRequest(h, stranger, business)).status).toBe(404);
    expect((await mintRequest(h, member, business)).status).toBe(404);
  });

  it('an accountant with an ACTIVE grant downloads through the derived allowlist; revoked, another profile or none: 404', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    await expenseOn(h, p, profileId, { title: 'shared' });
    const acc = await shared(h, p, profileId);
    expect((await expenseRows(await download(h, acc, profileId))).slice(1).map((r) => r[3])).toEqual(['shared']);
    expect((await download(h, acc, profileId, { type: 'receipts' })).status).toBe(200);
    const other = await businessOf(h, p, 'Not shared');
    expect((await mintRequest(h, acc, other)).status).toBe(404);
    const grants = await read(await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: p.auth }));
    expect((await h.app.request(`/v1/profiles/${profileId}/accountants/${grants.items[0].id}`, { method: 'DELETE', headers: p.auth })).status).toBe(204);
    expect((await mintRequest(h, acc, profileId)).status).toBe(404);
  });

  it('a LOCKED profile still mints (LOCKED_OPEN); the stream is public, outside the gate', () => {
    expect(LOCKED_OPEN_ENDPOINTS.has('GET /v1/period-downloads/ticket')).toBe(true);
  });

  it('a download never lazy-posts a due item', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const at = new Date('2026-10-01T08:00:00Z');
    const customer = await h.store.customers.create({ organizationId: profileId, name: 'Bakery', email: null, phone: null, notes: null }, at);
    const project = await h.store.projects.create({ organizationId: profileId, customerId: customer.id, name: 'Menu', currency: 'ILS' }, at);
    await h.store.agreements.create(
      {
        organizationId: profileId, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE',
        vatRateBasisPoints: 0, amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, agreementDate: '2026-10-01', description: null, paymentTerms: 'IMMEDIATE',
        startMonth: null, billingDay: null, endMonth: null,
        installments: [{ position: 1, label: 'All', amountMinor: 1000n, netMinor: 1000n, vatMinor: 0n, grossMinor: 1000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: 'IMMEDIATE', dueDateOverride: null }],
      },
      at,
    );
    const receivables = () => (h.store as unknown as { recs: Map<string, unknown> }).recs.size;
    await (await download(h, p, profileId)).arrayBuffer();
    await (await download(h, p, profileId, { type: 'receipts' })).arrayBuffer();
    expect(receivables()).toBe(0);
    // A read that does post (the records export) shows the item was due.
    await (await h.app.request('/v1/records-export', { headers: p.on(profileId) })).text();
    expect(receivables()).toBe(1);
  });
});

describe('9. the ticket (MUT-314)', () => {
  it('tampered, wrongly signed, expired or unknown: the uniform 404; the type in the ticket decides the file', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const { ticket } = await mintOk(h, p, profileId);
    const [payload, sig] = ticket.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), type: 'receipts' })).toString('base64url');
    for (const bad of [`${forged}.${sig}`, `${payload}.${'0'.repeat(64)}`, 'nonsense']) {
      const res = await streamRequest(h, { ticket: bad });
      expect(res.status).toBe(404);
      expect((await errorOf(res)).details).toEqual({ reason: 'DOWNLOAD_UNAVAILABLE' });
    }
    expect((await streamRequest(h, { ticket })).headers.get('content-type')).toBe(XLSX);
    const receipts = await mintOk(h, p, profileId, { type: 'receipts' });
    expect((await streamRequest(h, { ticket: receipts.ticket })).headers.get('content-type')).toBe('application/zip');
    const stale = await mintOk(h, p, profileId);
    later(h, 120_000);
    expect((await streamRequest(h, { ticket: stale.ticket })).status).toBe(404);
  });

  it('access revoked between the mint and the stream wins: a grant, a membership', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const acc = await shared(h, p, profileId);
    const minted = await mintOk(h, acc, profileId);
    const grants = await read(await h.app.request(`/v1/profiles/${profileId}/accountants`, { headers: p.auth }));
    await h.app.request(`/v1/profiles/${profileId}/accountants/${grants.items[0].id}`, { method: 'DELETE', headers: p.auth });
    expect((await streamRequest(h, { ticket: minted.ticket })).status).toBe(404);

    const firm = await read(await h.app.request('/admin/v1/organizations', json({ name: 'Firm', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, ADMIN)));
    const member = await person(h);
    await h.app.request(`/admin/v1/users/${member.userId}/memberships`, json({ organizationId: firm.id }, ADMIN));
    const memberTicket = await mintOk(h, member, firm.id);
    expect((await h.app.request(`/admin/v1/users/${member.userId}/memberships/${firm.id}`, { method: 'DELETE', headers: ADMIN })).ok).toBe(true);
    expect((await streamRequest(h, { ticket: memberTicket.ticket })).status).toBe(404);
  });

  it('takes the ticket from a form post too (the portal’s hidden form)', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const { ticket } = await mintOk(h, p, profileId);
    expect((await streamRequest(h, { ticket }, true)).status).toBe(200);
  });

  it('OpenAPI puts no ticket or token in a path or query', async () => {
    const h = downloadHarness();
    const doc = await read(await h.app.request('/openapi.json'));
    for (const path of ['/v1/period-downloads/ticket', '/v1/period-downloads/stream', '/v1/share-links/download-ticket']) {
      expect(path).not.toMatch(/ticket\}|token/i);
      const params = Object.values(doc.paths[path] as Record<string, Loose>).flatMap((op) => (op.parameters ?? []).map((x: Loose) => x.name));
      expect(params.filter((n: string) => /ticket|token/i.test(n))).toEqual([]);
    }
  });
});

describe('10. a share link’s downloads (MUT-314)', () => {
  async function linkSetup(h: DownloadHarness) {
    const { p, profileId } = await owner(h);
    await expenseOn(h, p, profileId, { occurredOn: '2026-09-30', title: 'before' });
    const inside = await expenseOn(h, p, profileId, { occurredOn: '2026-10-12', title: 'inside' });
    await receiptOn(h, p, profileId, inside.id, PNG);
    const other = await businessOf(h, p, 'Other');
    await expenseOn(h, p, other, { occurredOn: '2026-10-12', title: 'other profile' });
    const link = await linkOn(h, p, profileId, { period: 'LAST_1_MONTH' });
    return { p, profileId, viewer: await viewerOf(h, link.token), link };
  }

  it('both downloads hold only the link’s period and its profile; the viewer token goes with the stream', async () => {
    const h = downloadHarness();
    const { viewer } = await linkSetup(h);
    const minted = await read(await linkMint(h, { viewerToken: viewer, type: 'report', lang: 'en' }));
    expect(minted.filename).toBe('mutaba3a-Personal-2026-10.xlsx');
    const rows = await expenseRows(await streamRequest(h, { ticket: minted.ticket, viewerToken: viewer }));
    expect(rows.slice(1).map((r) => r[3])).toEqual(['inside']);
    const zip = await read(await linkMint(h, { viewerToken: viewer, type: 'receipts' }));
    expect(Object.keys(await zipOf(await streamRequest(h, { ticket: zip.ticket, viewerToken: viewer }))).sort()).toEqual(['index.csv', 'receipts/E0001-1.png']);
  });

  it('a link ticket without its viewer token, with another viewer’s, or after a revoke: 404', async () => {
    const h = downloadHarness();
    const { p, profileId, viewer, link } = await linkSetup(h);
    const other = await viewerOf(h, link.token);
    const { ticket } = await read(await linkMint(h, { viewerToken: viewer, type: 'report' }));
    expect((await streamRequest(h, { ticket })).status).toBe(404);
    expect((await streamRequest(h, { ticket, viewerToken: other })).status).toBe(404);
    expect((await h.app.request(`/v1/profiles/${profileId}/share-links/${link.id}`, { method: 'DELETE', headers: p.auth })).status).toBe(204);
    expect((await streamRequest(h, { ticket, viewerToken: viewer })).status).toBe(404);
    expect((await linkMint(h, { viewerToken: viewer, type: 'report' })).status).toBe(404);
  });

  it('SHARE_LINKS or PERIOD_DOWNLOADS off: 404', async () => {
    const off = downloadHarness({ periodDownloads: false });
    const { viewer } = await linkSetup(off);
    expect((await linkMint(off, { viewerToken: viewer, type: 'report' })).status).toBe(404);
    const { p, profileId } = await owner(off);
    expect((await mintRequest(off, p, profileId)).status).toBe(404);
    expect((await streamRequest(off, { ticket: 'x.y' })).status).toBe(404);
    const noLinks = downloadHarness({ shareLinks: false });
    expect((await linkMint(noLinks, { viewerToken: 'a'.repeat(43), type: 'report' })).status).toBe(404);
  });
});

describe('11. estimates and caps (MUT-314)', () => {
  it('the estimate counts rows and sums receipt bytes', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receivedOn(h, p, profileId, '2026-10-09');
    await receiptOn(h, p, profileId, a.id, PNG);
    await receiptOn(h, p, profileId, a.id, PDF, 'application/pdf');
    const minted = await mintOk(h, p, profileId, { type: 'receipts' });
    expect(minted.estimate).toEqual({ expenses: 1, income: 1, receipts: 2, receiptBytes: PNG.byteLength + PDF.byteLength });
    expect(minted).toMatchObject({ type: 'receipts', filename: 'mutaba3a-Personal-2026-10-receipts.zip' });
    expect(new Date(minted.expiresAt).getTime()).toBe(T0.getTime() + 120_000);
  });

  it('over the row cap the report is refused up front; over the byte cap the zip is, while the report still mints', async () => {
    const h = downloadHarness({ periodPackLimits: { maxRows: 2, maxReceiptBytes: 10 } });
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receiptOn(h, p, profileId, a.id, PNG);
    await receivedOn(h, p, profileId, '2026-10-09');
    expect((await mintRequest(h, p, profileId)).status).toBe(200);
    const zip = await mintRequest(h, p, profileId, { type: 'receipts' });
    expect(zip.status).toBe(422);
    expect((await errorOf(zip)).details).toEqual({ reason: 'PERIOD_TOO_LARGE', type: 'receipts', limit: 10, estimate: PNG.byteLength });
    await expenseOn(h, p, profileId, { title: 'B' });
    const report = await mintRequest(h, p, profileId);
    expect(report.status).toBe(422);
    expect((await errorOf(report)).details).toEqual({ reason: 'PERIOD_TOO_LARGE', type: 'report', limit: 2, estimate: 3 });
  });

  it('a stream past the instance’s slots answers 429 with Retry-After; a finished one frees its slot', async () => {
    const h = downloadHarness({ periodPackConcurrency: 1 });
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receiptOn(h, p, profileId, a.id, PNG);
    const held = await download(h, p, profileId, { type: 'receipts' });
    const busy = await download(h, p, profileId);
    expect(busy.status).toBe(429);
    expect(busy.headers.get('retry-after')).toBe('15');
    await held.arrayBuffer();
    expect((await download(h, p, profileId)).status).toBe(200);
  });

  it('mints per person per hour are capped (429)', async () => {
    const h = downloadHarness({ periodDownloadMintLimiter: new SlidingWindowRateLimiter(2, 3_600_000) });
    const { p, profileId } = await owner(h);
    expect((await mintRequest(h, p, profileId)).status).toBe(200);
    expect((await mintRequest(h, p, profileId)).status).toBe(200);
    const limited = await mintRequest(h, p, profileId);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('12. streaming and cancels (MUT-314, MUT-501)', () => {
  /** A bucket whose objects arrive one chunk at a time, the next only when asked, so a cancel lands mid-receipt. */
  function slowBucket(h: DownloadHarness, chunks = 4) {
    const cancelled = vi.fn();
    vi.spyOn(h.storage, 'read').mockImplementation(async () => {
      let sent = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent++ < chunks) controller.enqueue(new Uint8Array(1024).fill(sent));
          else controller.close();
        },
        cancel: cancelled,
      });
    });
    return cancelled;
  }

  it('a cancel mid-receipt: the bucket read is cancelled, nothing is logged as an error, the slot is freed', async () => {
    const h = downloadHarness({ periodPackConcurrency: 1 });
    const errors = vi.spyOn(h.logger, 'error');
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receiptOn(h, p, profileId, a.id, PNG);
    const cancelled = slowBucket(h, 1000);
    const res = await download(h, p, profileId, { type: 'receipts' });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel('client went away');
    await new Promise((r) => setTimeout(r, 10));
    expect(cancelled).toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
    expect((await download(h, p, profileId)).status).toBe(200);
  });

  it('a cancel right after the last receipt (while index.csv is written) is quiet too', async () => {
    const h = downloadHarness();
    const errors = vi.spyOn(h.logger, 'error');
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receiptOn(h, p, profileId, a.id, PNG);
    const res = await download(h, p, profileId, { type: 'receipts' });
    const reader = res.body!.getReader();
    let total = 0;
    while (total < PNG.byteLength) total += (await reader.read()).value?.byteLength ?? Infinity;
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 10));
    expect(errors).not.toHaveBeenCalled();
  });

  it('a storage failure after a receipt’s first bytes errors the stream (no central directory) and logs once', async () => {
    const h = downloadHarness();
    const errors = vi.spyOn(h.logger, 'error');
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receiptOn(h, p, profileId, a.id, PNG);
    vi.spyOn(h.storage, 'read').mockImplementation(async () => {
      let sent = false;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (!sent) {
            sent = true;
            controller.enqueue(new Uint8Array([1, 2, 3]));
          } else controller.error(new Error('bucket reset'));
        },
      });
    });
    const res = await download(h, p, profileId, { type: 'receipts' });
    await expect(res.arrayBuffer()).rejects.toThrow();
    expect(errors).toHaveBeenCalledTimes(1);
  });
});

describe('13. read-only and audit (MUT-314)', () => {
  it('inside a download every write is refused for every kind; reads and the feed pass', () => {
    for (const kind of ['member', 'accountant', 'link'] as const) {
      const guard = periodDownloadStoreGuard(kind);
      expect(() => guard.assertCanCall('expenses', 'create')).toThrow(expect.objectContaining({ code: 'READ_ONLY_PROFILE' }));
      expect(() => guard.assertCanCall('audit', 'append')).toThrow(expect.objectContaining({ code: 'READ_ONLY_PROFILE' }));
      expect(() => guard.assertCanCall('entries', 'list')).not.toThrow();
      expect(() => guard.assertCanCall('periodPack', 'estimate')).not.toThrow();
      expect(() => guard.assertCanCall('expenseReceipts', 'listReadyByExpenseIds')).not.toThrow();
    }
  });

  it('one period.downloaded row per stream, with no token, address or row content', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'secret title' });
    await receiptOn(h, p, profileId, a.id, PNG);
    const { ticket } = await mintOk(h, p, profileId, { type: 'receipts' });
    await (await streamRequest(h, { ticket })).arrayBuffer();
    const rows = (await h.store.audit.listByOrganization(profileId, 100)).filter((e) => e.action === 'period.downloaded');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: 'USER', actorId: p.userId, metadata: { type: 'receipts', kind: 'member', from: '2026-10-01', to: '2026-10-31', rows: 1, receiptFiles: 1 } });
    expect(JSON.stringify(rows[0])).not.toMatch(new RegExp(`${ticket.slice(0, 20)}|secret title|127\\.0\\.0\\.1`));
  });

  it('a link’s audit row names the link, not the viewer’s token', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const link = await linkOn(h, p, profileId);
    const viewer = await viewerOf(h, link.token);
    const { ticket } = await read(await linkMint(h, { viewerToken: viewer, type: 'report' }));
    await (await streamRequest(h, { ticket, viewerToken: viewer })).arrayBuffer();
    const row = (await h.store.audit.listByOrganization(profileId, 100)).find((e) => e.action === 'period.downloaded')!;
    expect(row).toMatchObject({ actorType: 'SYSTEM', metadata: { type: 'report', kind: 'link', shareLinkId: link.id } });
    expect(JSON.stringify(row)).not.toContain(viewer);
  });
});

describe('14. performance (MUT-314, AC4)', () => {
  it('a 1,000-row month: the report is sent in under 10 s; a 600-receipt zip starts and finishes in under 10 s', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const at = new Date('2026-10-31T10:00:00Z');
    const expenseIds: string[] = [];
    for (let i = 0; i < 600; i++) {
      const e = await h.store.expenses.create(
        { organizationId: profileId, occurredOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}`, amountMinor: BigInt(1000 + i), currency: 'ILS', title: `Expense ${i}`, vendor: `Vendor ${i % 40}`, categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: p.userId, vatTreatment: null, vatRateBasisPoints: null, netMinor: null, vatMinor: null },
        at,
      );
      expenseIds.push(e.id);
    }
    for (let i = 0; i < 400; i++) {
      const res = await h.app.request('/v1/income', json({ kind: 'received', amount: '5.00', currency: 'ILS', occurredOn: `2026-10-${String((i % 28) + 1).padStart(2, '0')}` }, { ...p.on(profileId), 'idempotency-key': `perf-income-${i}` }));
      if (res.status !== 201) throw new Error(`income ${i}: ${res.status} ${await res.text()}`);
    }
    const bytes = new Uint8Array(50 * 1024).fill(7);
    for (const expenseId of expenseIds) {
      const r = await h.store.expenseReceipts.create({ organizationId: profileId, expenseId, filename: 'r.png', mimeType: 'image/png', sizeBytes: bytes.byteLength, receivedOn: '2026-10-31', uploadedByUserId: p.userId, requestId: null }, at);
      const key = `org/${profileId}/perf/${r.id}`;
      await h.store.expenseReceipts.setKey(profileId, r.id, key);
      await h.store.expenseReceipts.complete(profileId, r.id, at);
      h.storage.put(key, { sizeBytes: bytes.byteLength, contentType: 'image/png' }, bytes);
    }

    let started = performance.now();
    const report = await download(h, p, profileId);
    const wb = await workbookOf(report);
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(wb.getWorksheet('Expenses')!.rowCount).toBe(601);
    expect(wb.getWorksheet('Income')!.rowCount).toBe(401);

    started = performance.now();
    const zip = await download(h, p, profileId, { type: 'receipts' });
    const reader = zip.body!.getReader();
    await reader.read();
    expect(performance.now() - started).toBeLessThan(10_000);
    let size = 0;
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) size += chunk.value.byteLength;
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(size).toBeGreaterThan(600 * bytes.byteLength);
  }, 60_000);
});

describe('15. response headers (MUT-314)', () => {
  it('report: the XLSX type with Content-Length; zip: application/zip, chunked; both attachments, nosniff, no-store, noindex, never gzipped', async () => {
    const h = downloadHarness();
    const p: Person = await person(h);
    const studio = await businessOf(h, p, 'استوديو صادر');
    const a = await expenseOn(h, p, studio, { title: 'A' });
    await receiptOn(h, p, studio, a.id, PNG);
    const report = await download(h, p, studio);
    const body = await report.arrayBuffer();
    expect(report.headers.get('content-type')).toBe(XLSX);
    expect(report.headers.get('content-length')).toBe(String(body.byteLength));
    const name = report.headers.get('content-disposition')!;
    // The ASCII fallback drops what it can't spell; the UTF-8 name keeps the profile's.
    expect(name).toMatch(/^attachment; filename="mutaba3a-2026-10\.xlsx"; filename\*=UTF-8''/);
    expect(decodeURIComponent(name.split("UTF-8''")[1]!)).toBe('mutaba3a-استوديو-صادر-2026-10.xlsx');
    const zip = await h.app.request('/v1/period-downloads/stream', json({ ticket: (await mintOk(h, p, studio, { type: 'receipts' })).ticket }, { 'accept-encoding': 'gzip' }));
    expect(zip.headers.get('content-type')).toBe('application/zip');
    expect(zip.headers.get('content-length')).toBeNull();
    for (const res of [report, zip]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('cache-control')).toMatch(/no-store/);
      expect(res.headers.get('x-robots-tag')).toBe('noindex');
      expect(res.headers.get('content-encoding')).toBeNull();
    }
    await zip.arrayBuffer();
  });
});

describe('review fixes (MUT-314)', () => {
  it('an accountant’s ticket dies when the owner starts closing their account (MUT-575’s rule, in clientAccess)', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const acc = await shared(h, p, profileId);
    const { ticket } = await mintOk(h, acc, profileId);
    expect((await h.app.request('/v1/me/closure', json({ password: p.password }, p.auth))).status).toBe(200);
    expect((await streamRequest(h, { ticket })).status).toBe(404);
    expect((await mintRequest(h, acc, profileId)).status).toBe(404);
  });

  it('a link visitor’s files carry no “Logged by”, no ids and no row ids; an owner’s keep them', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receivedOn(h, p, profileId, '2026-10-09');
    await receiptOn(h, p, profileId, a.id, PNG);
    const link = await linkOn(h, p, profileId);
    const viewer = await viewerOf(h, link.token);
    const report = await read(await linkMint(h, { viewerToken: viewer, type: 'report', lang: 'en' }));
    const wb = await workbookOf(await streamRequest(h, { ticket: report.ticket, viewerToken: viewer }));
    expect(rowsOf(wb.getWorksheet('Expenses')!)[0]).toEqual(['Ref', 'Date', 'Vendor', 'Description', 'Category', 'Client', 'Project', 'Currency', 'Amount', 'Net', 'VAT', 'VAT rate %', 'VAT treatment', 'Notes', 'Receipts', 'Receipt files', 'Logged at']);
    expect(rowsOf(wb.getWorksheet('Income')!)[0]).toEqual(['Ref', 'Date received', 'Client', 'Project', 'Currency', 'Amount', 'Method', 'Reference', 'Receipt number', 'Notes', 'Source', 'Logged at']);
    const bytes = new Uint8Array(await (await streamRequest(h, { ticket: (await read(await linkMint(h, { viewerToken: viewer, type: 'report' }))).ticket, viewerToken: viewer })).arrayBuffer());
    expect(new TextDecoder().decode(bytes)).not.toContain(a.id);
    const zip = await read(await linkMint(h, { viewerToken: viewer, type: 'receipts', lang: 'en' }));
    const index = indexOf(await zipOf(await streamRequest(h, { ticket: zip.ticket, viewerToken: viewer })));
    expect(index).toEqual([
      ['File', 'Ref', 'Date', 'Vendor', 'Currency', 'Amount', 'Status'],
      ['receipts/E0001-1.png', 'E0001', '2026-10-05', '', 'ILS', '12.00', 'ok'],
    ]);
    const owners = await workbookOf(await download(h, p, profileId));
    expect(rowsOf(owners.getWorksheet('Expenses')!)[0]).toContain('Logged by');
    expect(rowsOf(owners.getWorksheet('Expenses')!)[0]).toContain('Id');
  });

  it('the row cap applies to the receipts download too, counting what it holds: expenses', async () => {
    const h = downloadHarness({ periodPackLimits: { maxRows: 1, maxReceiptBytes: 1_000_000 } });
    const { p, profileId } = await owner(h);
    await expenseOn(h, p, profileId, { title: 'A' });
    for (const day of ['2026-10-09', '2026-10-10']) await receivedOn(h, p, profileId, day);
    expect((await mintRequest(h, p, profileId, { type: 'receipts' })).status).toBe(200);
    expect((await mintRequest(h, p, profileId)).status).toBe(422);
    await expenseOn(h, p, profileId, { title: 'B' });
    const refused = await mintRequest(h, p, profileId, { type: 'receipts' });
    expect(refused.status).toBe(422);
    expect((await errorOf(refused)).details).toEqual({ reason: 'PERIOD_TOO_LARGE', type: 'receipts', limit: 1, estimate: 2 });
  });

  it('the receipts download reads expenses only, and only the vendor names it writes', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const a = await expenseOn(h, p, profileId, { title: 'A' });
    await receivedOn(h, p, profileId, '2026-10-09');
    await receiptOn(h, p, profileId, a.id, PNG);
    const feed = vi.spyOn(h.store.entries, 'list');
    const names = vi.spyOn(h.store.periodPack, 'names');
    const categories = vi.spyOn(h.store.expenseCategories, 'list');
    await (await download(h, p, profileId, { type: 'receipts' })).arrayBuffer();
    expect(feed.mock.calls.every(([, page]) => JSON.stringify(page.kinds) === '["expense"]')).toBe(true);
    expect(names.mock.calls.every(([, ids]) => ids.customers.size + ids.projects.size + ids.users.size === 0)).toBe(true);
    expect(categories).not.toHaveBeenCalled();
  });

  it('a ticket streams once; a second use is the uniform 404', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const { ticket } = await mintOk(h, p, profileId);
    expect((await streamRequest(h, { ticket })).status).toBe(200);
    const again = await streamRequest(h, { ticket });
    expect(again.status).toBe(404);
    expect((await errorOf(again)).details).toEqual({ reason: 'DOWNLOAD_UNAVAILABLE' });
  });

  it('a ticket from a session signed out before the stream is refused', async () => {
    const h = downloadHarness();
    const { p, profileId } = await owner(h);
    const { ticket } = await mintOk(h, p, profileId);
    expect((await h.app.request('/v1/device-sessions/current', { method: 'DELETE', headers: p.auth })).status).toBe(204);
    expect((await streamRequest(h, { ticket })).status).toBe(404);
  });
});
