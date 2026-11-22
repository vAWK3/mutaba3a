import { describe, expect, it } from 'vitest';
import { composeDocument, type ComposeInput } from '../../issuing/compose.js';
import type { IssueDocumentInput, LedgerStore, Organization } from '../ports.js';

const ISSUER_DEFAULTS = { ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null };

/** MUT-568 (ADR-260) storage contract: issued documents, gap-free numbers, their ledger rows, copies and gaps. */
export function describeLedgerStoreIssuingContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 22, 10, 0, 0, ms));
  const shekels = (n: number): bigint => BigInt(Math.round(n * 100));
  const org = (store: LedgerStore, label = 'Firm'): Promise<Organization> =>
    store.organizations.create({ name: label, slug: `${label.toLowerCase()}-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });

  async function world(store: LedgerStore) {
    const a = await org(store, 'A');
    const b = await org(store, 'B');
    const { user } = await store.users.create({ email: `p-${unique()}@firm.ps`, displayName: 'Basel', passwordHash: 'x', locale: 'en', organizationId: a.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const customer = await store.customers.create({ organizationId: a.id, name: 'Acme Digital Ltd.', email: null, phone: null, notes: null }, at(0));
    const other = await store.customers.create({ organizationId: a.id, name: 'Galil Services', email: null, phone: null, notes: null }, at(0));
    const compose = (over: Partial<ComposeInput> = {}) =>
      composeDocument({
        docType: 'TAX_INVOICE',
        currency: 'ILS',
        documentDate: '2026-11-22',
        dealerType: 'COMPANY',
        documentDiscountMinor: 0n,
        pricesIncludeVat: false,
        lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(1_000), discountMinor: 0n }],
        ...over,
      });
    const issue = (over: Partial<IssueDocumentInput> & { amount?: number } = {}): IssueDocumentInput => {
      const docType = over.docType ?? 'TAX_INVOICE';
      const documentDate = over.documentDate ?? '2026-11-22';
      const { amount = 1_000, ...rest } = over;
      return {
        organizationId: a.id,
        docType,
        documentDate,
        currency: 'ILS',
        composed: compose({ docType, documentDate, lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(amount), discountMinor: 0n }] }),
        issuer: { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY' },
        customerId: customer.id,
        customer: { name: 'Acme Digital Ltd.' },
        language: 'he',
        style: 'PROFESSIONAL',
        ink: 'BLACK',
        notes: null,
        dueDate: '2026-12-22',
        originalId: null,
        payment: docType === 'TAX_INVOICE_RECEIPT' || docType === 'RECEIPT' ? { method: 'BANK', reference: 'TRX-1', receivedOn: documentDate } : null,
        appliesToDocumentId: null,
        fromEntry: null,
        allocationNumber: null,
        titlePrefix: 'חשבונית מס',
        coreVersion: '1.0.0',
        createdByUserId: user.id,
        requestKey: `key-${unique()}`,
        requestId: null,
        ...rest,
      };
    };
    const issued = async (store2: LedgerStore, input: IssueDocumentInput, ms = 1) => {
      const result = await store2.issuing.issue(input, at(ms));
      if (result.kind !== 'issued') throw new Error(`expected issued, got ${result.kind}`);
      return result.document;
    };
    return { a, b, user, customer, other, issue, issued };
  }

  describe(`${name} LedgerStore issuing contract (MUT-568)`, () => {
    it('issues a tax invoice: number 1, its lines, and an Owed posted under the document', async () => {
      const store = await makeStore();
      const w = await world(store);
      const doc = await w.issued(store, w.issue());
      expect(doc).toMatchObject({ docType: 'TAX_INVOICE', number: 1, netMinor: shekels(1_000), vatMinor: shekels(180), grossMinor: shekels(1_180), coreVersion: '1.0.0' });
      expect(doc.lines).toHaveLength(1);
      expect(doc.lines[0]).toMatchObject({ index: 1, description: 'Sprint 3', netMinor: shekels(1_000), vatMinor: shekels(180) });
      const owed = await store.receivables.getById(w.a.id, doc.receivableId!);
      expect(owed).toMatchObject({ origin: 'ISSUED_DOCUMENT', originId: doc.id, customerId: w.customer.id, grossMinor: shekels(1_180), vatMinor: shekels(180), status: 'OPEN', title: 'חשבונית מס 1', dueDate: '2026-12-22', postingDate: '2026-11-22' });
      expect(await store.issuing.getById(w.a.id, doc.id)).toEqual(doc);
      expect(await store.issuing.getById(w.b.id, doc.id)).toBeNull();
    });

    it('numbers each type on its own, one after another, from its starting number', async () => {
      const store = await makeStore();
      const w = await world(store);
      expect(await store.issuing.setStartingNumber(w.a.id, 'TAX_INVOICE', 1040)).toMatchObject({ kind: 'set' });
      const numbers = [];
      for (let i = 0; i < 3; i += 1) numbers.push((await w.issued(store, w.issue(), i)).number);
      expect(numbers).toEqual([1040, 1041, 1042]);
      expect((await w.issued(store, w.issue({ docType: 'RECEIPT', customerId: null }))).number).toBe(1);
      expect(await store.issuing.setStartingNumber(w.a.id, 'TAX_INVOICE', 5000)).toEqual({ kind: 'has_documents' });
      expect((await w.issued(store, w.issue({ organizationId: w.b.id, customerId: null, docType: 'RECEIPT' }))).number).toBe(1);
    });

    it('never duplicates or skips a number under concurrent issues (AC2)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const docs = await Promise.all(Array.from({ length: 25 }, (_, i) => w.issued(store, w.issue(), i)));
      expect(docs.map((d) => d.number).sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i + 1));
      expect(await store.issuing.gaps(w.a.id)).toEqual([{ docType: 'TAX_INVOICE', start: 1, last: 25, missing: [] }]);
    });

    it('a refused issue takes no number', async () => {
      const store = await makeStore();
      const w = await world(store);
      await w.issued(store, w.issue({ documentDate: '2026-11-22' }));
      expect(await store.issuing.issue(w.issue({ documentDate: '2026-11-21' }), at(2))).toEqual({ kind: 'date_before_last', lastDate: '2026-11-22' });
      expect(await store.issuing.issue(w.issue({ customerId: '00000000-0000-4000-8000-000000000000' }), at(3))).toEqual({ kind: 'customer_not_found' });
      expect((await w.issued(store, w.issue(), 4)).number).toBe(2);
      expect((await store.issuing.gaps(w.a.id))[0]!.missing).toEqual([]);
    });

    it('returns the same document for the same request key, with no second number (idempotent)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const input = w.issue();
      const first = await store.issuing.issue(input, at(1));
      const again = await store.issuing.issue(input, at(2));
      expect(first).toMatchObject({ kind: 'issued', created: true });
      expect(again).toMatchObject({ kind: 'issued', created: false });
      if (first.kind === 'issued' && again.kind === 'issued') expect(again.document).toEqual(first.document);
      expect((await w.issued(store, w.issue(), 3)).number).toBe(2);
    });

    it('an invoice-receipt posts an Owed and a Received that pays it in full', async () => {
      const store = await makeStore();
      const w = await world(store);
      const doc = await w.issued(store, w.issue({ docType: 'TAX_INVOICE_RECEIPT' }));
      const owed = await store.receivables.getById(w.a.id, doc.receivableId!);
      const received = await store.payments.getById(w.a.id, doc.paymentId!);
      expect(owed).toMatchObject({ origin: 'ISSUED_DOCUMENT', grossMinor: shekels(1_180), paidMinor: shekels(1_180), status: 'SETTLED' });
      expect(received).toMatchObject({ origin: 'ISSUED_DOCUMENT', amountMinor: shekels(1_180), allocatedMinor: shekels(1_180), method: 'BANK', reference: 'TRX-1', receivedOn: '2026-11-22', customerId: w.customer.id });
      expect(doc.paymentDetails).toEqual({ method: 'BANK', reference: 'TRX-1', receivedOn: '2026-11-22' });
    });

    it('a receipt pays an open tax invoice, up to what it still owes', async () => {
      const store = await makeStore();
      const w = await world(store);
      const invoice = await w.issued(store, w.issue());
      expect(await store.issuing.issue(w.issue({ docType: 'RECEIPT', amount: 2_000, appliesToDocumentId: invoice.id }), at(2))).toMatchObject({ kind: 'exceeds_outstanding', outstandingMinor: shekels(1_180) });
      const receipt = await w.issued(store, w.issue({ docType: 'RECEIPT', amount: 500, appliesToDocumentId: invoice.id }), 3);
      expect(receipt.vatMinor).toBe(0n);
      expect(await store.receivables.getById(w.a.id, invoice.receivableId!)).toMatchObject({ paidMinor: shekels(500), status: 'OPEN' });
      expect(await store.payments.getById(w.a.id, receipt.paymentId!)).toMatchObject({ allocatedMinor: shekels(500) });
    });

    it('a credit note credits its tax invoice up to what is still owed (AC3, R-D2)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const invoice = await w.issued(store, w.issue());
      const note = await w.issued(store, w.issue({ docType: 'CREDIT_NOTE', amount: 400, originalId: invoice.id, titlePrefix: 'חשבונית זיכוי' }), 2);
      expect(note).toMatchObject({ number: 1, originalId: invoice.id, grossMinor: shekels(472) });
      expect(await store.receivables.getById(w.a.id, invoice.receivableId!)).toMatchObject({ creditedMinor: shekels(472), status: 'OPEN' });
      const credits = await store.receivables.listCredits(w.a.id, invoice.receivableId!);
      expect(credits).toHaveLength(1);
      expect(credits[0]).toMatchObject({ id: note.creditId, amountMinor: shekels(472), netMinor: shekels(400), vatMinor: shekels(72), reasonCode: 'OTHER', reason: 'חשבונית זיכוי 1', effectiveDate: '2026-11-22' });
      expect(await store.issuing.issue(w.issue({ docType: 'CREDIT_NOTE', amount: 1_000, originalId: invoice.id }), at(3))).toMatchObject({ kind: 'original_paid', outstandingMinor: shekels(708) });
    });

    it('refuses a credit note on a paid invoice, another customer, or anything but a tax invoice', async () => {
      const store = await makeStore();
      const w = await world(store);
      const paid = await w.issued(store, w.issue({ docType: 'TAX_INVOICE_RECEIPT' }));
      const invoice = await w.issued(store, w.issue(), 2);
      expect(await store.issuing.issue(w.issue({ docType: 'CREDIT_NOTE', amount: 100, originalId: paid.id }), at(3))).toEqual({ kind: 'original_not_found' });
      expect(await store.issuing.issue(w.issue({ docType: 'CREDIT_NOTE', amount: 100, originalId: invoice.id, customerId: w.other.id }), at(4))).toEqual({ kind: 'original_not_found' });
      expect(await store.issuing.issue(w.issue({ organizationId: w.b.id, docType: 'CREDIT_NOTE', amount: 100, originalId: invoice.id, customerId: null }), at(5))).toEqual({ kind: 'original_not_found' });
    });

    it('records copies: the first is the original, every later one a copy (AC4)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const doc = await w.issued(store, w.issue());
      const copy = { producedByUserId: w.user.id, channel: 'DOWNLOAD' };
      const indexes = await Promise.all([0, 1, 2, 3].map((i) => store.issuing.recordCopy(w.a.id, doc.id, copy, at(10 + i))));
      expect(indexes.map((r) => r!.copyIndex).sort()).toEqual([0, 1, 2, 3]);
      expect(await store.issuing.recordCopy(w.b.id, doc.id, copy, at(20))).toBeNull();
      // MUT-640: the same request key gets the same copy back, and takes no new index.
      const keyed = await store.issuing.recordCopy(w.a.id, doc.id, { ...copy, requestKey: 'download-1' }, at(21));
      expect(await store.issuing.recordCopy(w.a.id, doc.id, { ...copy, requestKey: 'download-1' }, at(22))).toEqual(keyed);
      expect(keyed).toEqual({ copyIndex: 4 });
      // Review fix 6: another person, or a day later, reusing the key gets a new copy, never the earlier one back.
      expect(await store.issuing.recordCopy(w.a.id, doc.id, { producedByUserId: '00000000-0000-4000-8000-0000000000ff', channel: 'EMAIL', requestKey: 'download-1' }, at(23))).toEqual({ copyIndex: 5 });
      const dayLater = new Date(at(21).getTime() + 25 * 60 * 60 * 1000);
      expect(await store.issuing.recordCopy(w.a.id, doc.id, { ...copy, requestKey: 'download-1' }, dayLater)).toEqual({ copyIndex: 6 });
    });

    it('keeps a signed original once: the first kept is what every later call gets (MUT-641)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const doc = await w.issued(store, w.issue());
      expect(await store.issuing.getOriginalPdf(w.a.id, doc.id)).toBeNull();
      const first = { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 1]), sha256: '1'.repeat(64), copyIndex: 0 };
      expect(await store.issuing.originalCopyIndex(w.a.id, doc.id)).toBeNull();
      const kept = await store.issuing.keepOriginalPdf(w.a.id, doc.id, first, at(30));
      expect(kept).toMatchObject({ documentId: doc.id, organizationId: w.a.id, sha256: first.sha256, copyIndex: 0 });
      expect(await store.issuing.originalCopyIndex(w.a.id, doc.id)).toBe(0);
      expect([...kept!.bytes]).toEqual([...first.bytes]);
      // A racing twin (or a later call) never replaces it: it gets the first one back.
      const twin = await store.issuing.keepOriginalPdf(w.a.id, doc.id, { bytes: new Uint8Array([9]), sha256: '2'.repeat(64), copyIndex: 1 }, at(31));
      expect(twin).toMatchObject({ sha256: first.sha256, copyIndex: 0 });
      expect([...(await store.issuing.getOriginalPdf(w.a.id, doc.id))!.bytes]).toEqual([...first.bytes]);
      // Another profile sees nothing and can keep nothing.
      expect(await store.issuing.getOriginalPdf(w.b.id, doc.id)).toBeNull();
      expect(await store.issuing.originalCopyIndex(w.b.id, doc.id)).toBeNull();
      expect(await store.issuing.keepOriginalPdf(w.b.id, doc.id, first, at(32))).toBeNull();
    });

    it('lists newest first, paginated, filtered by type and customer, inside one profile only', async () => {
      const store = await makeStore();
      const w = await world(store);
      const made = [];
      for (let i = 0; i < 5; i += 1) made.push(await w.issued(store, w.issue(i === 2 ? { customerId: w.other.id } : {}), i));
      made.push(await w.issued(store, w.issue({ docType: 'RECEIPT', customerId: null }), 9));
      const seen: string[] = [];
      let cursor = null;
      do {
        const page = await store.issuing.list(w.a.id, {}, { limit: 2, cursor });
        seen.push(...page.items.map((d) => d.id));
        cursor = page.nextCursor;
      } while (cursor);
      expect(seen).toEqual([...made].reverse().map((d) => d.id));
      expect((await store.issuing.list(w.a.id, { docType: 'RECEIPT' }, { limit: 10, cursor: null })).items.map((d) => d.id)).toEqual([made[5]!.id]);
      expect((await store.issuing.list(w.a.id, { customerId: w.other.id }, { limit: 10, cursor: null })).items.map((d) => d.id)).toEqual([made[2]!.id]);
      expect((await store.issuing.list(w.b.id, {}, { limit: 10, cursor: null })).items).toEqual([]);
    });

    it('keeps issuer details with If-Match versions', async () => {
      const store = await makeStore();
      const w = await world(store);
      const input = { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY' as const, address: null, city: 'Nazareth', phone: null, email: null, website: null, pricesIncludeVat: false, ...ISSUER_DEFAULTS };
      const created = await store.issuing.putIssuer(w.a.id, input, null, at(1));
      expect(created).toMatchObject({ kind: 'created', record: { legalName: 'Barmajiyat Ltd.', ink: 'BLACK', documentStyle: 'PROFESSIONAL', version: 1 } });
      expect(await store.issuing.putIssuer(w.a.id, input, null, at(2))).toMatchObject({ kind: 'stale' });
      expect(await store.issuing.putIssuer(w.a.id, { ...input, city: 'Haifa' }, 1, at(3))).toMatchObject({ kind: 'updated', record: { city: 'Haifa', version: 2 } });
      expect(await store.issuing.putIssuer(w.a.id, input, 1, at(4))).toMatchObject({ kind: 'stale', record: { version: 2 } });
      expect(await store.issuing.putIssuer(w.b.id, input, 1, at(5))).toEqual({ kind: 'not_found' });
      expect(await store.issuing.getIssuer(w.a.id)).toMatchObject({ city: 'Haifa' });
      expect(await store.issuing.putIssuer(w.a.id, { ...input, ink: 'BLUE', documentStyle: 'MINIMAL', defaultLanguage: 'ar', paymentTermsDays: 30, bankDetails: 'Bank Leumi 10-800-123456', footerNote: 'Thank you' }, 2, at(6))).toMatchObject({
        kind: 'updated',
        record: { ink: 'BLUE', documentStyle: 'MINIMAL', defaultLanguage: 'ar', paymentTermsDays: 30, bankDetails: 'Bank Leumi 10-800-123456', footerNote: 'Thank you', version: 3 },
      });
    });

    it('MUT-646: stamps each setup step once, per profile', async () => {
      const store = await makeStore();
      const w = await world(store);
      expect(await store.issuing.getSetup(w.a.id)).toBeNull();
      expect(await store.issuing.markSetup(w.a.id, 'introSeenAt', at(1))).toMatchObject({ introSeenAt: at(1), numberingAnsweredAt: null, logoId: null });
      expect(await store.issuing.markSetup(w.a.id, 'introSeenAt', at(2))).toMatchObject({ introSeenAt: at(1) });
      expect(await store.issuing.markSetup(w.a.id, 'numberingAnsweredAt', at(3))).toMatchObject({ introSeenAt: at(1), numberingAnsweredAt: at(3), defaultsSavedAt: null });
      expect(await store.issuing.getSetup(w.b.id)).toBeNull();
    });

    it('MUT-571: one Tax Authority connection per profile; the lock runs refreshes one at a time', async () => {
      const store = await makeStore();
      const w = await world(store);
      const row = (version: string) => ({ organizationId: w.a.id, environment: 'sandbox', accessTokenSealed: `v1.a.${version}`, accessExpiresAt: at(10), refreshTokenSealed: `v1.r.${version}`, refreshExpiresAt: at(20), connectedByUserId: w.a.id, connectedAt: at(1) });
      expect(await store.issuing.getTaxConnection(w.a.id)).toBeNull();
      expect(await store.issuing.putTaxConnection(row('1'))).toMatchObject({ accessTokenSealed: 'v1.a.1', version: 1 });
      const seen: string[] = [];
      const refresh = (label: string) =>
        store.issuing.withTaxConnectionLock(w.a.id, async (current) => {
          seen.push(`${label}:${current?.refreshTokenSealed}`);
          await new Promise((resolve) => setTimeout(resolve, 20));
          return { update: current?.refreshTokenSealed === 'v1.r.1' ? row('2') : null, result: label };
        });
      expect(await Promise.all([refresh('first'), refresh('second')])).toEqual(['first', 'second']);
      // The second waited and saw the first's new refresh token, so the spent one was used once.
      expect(seen.map((entry) => entry.split(':')[1]).sort()).toEqual(['v1.r.1', 'v1.r.2']);
      expect(await store.issuing.getTaxConnection(w.a.id)).toMatchObject({ refreshTokenSealed: 'v1.r.2', version: 2 });
      expect(await store.issuing.getTaxConnection(w.b.id)).toBeNull();
      expect(await store.issuing.deleteTaxConnection(w.a.id)).toBe(true);
      expect(await store.issuing.deleteTaxConnection(w.a.id)).toBe(false);
    });

    it('MUT-646: keeps every logo; clearing only drops the current one', async () => {
      const store = await makeStore();
      const w = await world(store);
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
      const first = await store.issuing.addLogo(w.a.id, { contentType: 'image/png', bytes: png, sha256: 'a'.repeat(64) }, at(1));
      expect((await store.issuing.getSetup(w.a.id))?.logoId).toBe(first.id);
      const second = await store.issuing.addLogo(w.a.id, { contentType: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]), sha256: 'b'.repeat(64) }, at(2));
      expect((await store.issuing.getSetup(w.a.id))?.logoId).toBe(second.id);
      await store.issuing.clearLogo(w.a.id, at(3));
      expect((await store.issuing.getSetup(w.a.id))?.logoId).toBeNull();
      const kept = await store.issuing.getLogo(w.a.id, first.id);
      expect(kept).toMatchObject({ contentType: 'image/png', sha256: 'a'.repeat(64) });
      expect([...kept!.bytes]).toEqual([...png]);
      expect(await store.issuing.getLogo(w.b.id, first.id)).toBeNull();
    });

    it('a tax invoice from a recorded Owed takes it over: no second Owed, the document’s VAT split (I1-a)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const owed = await store.receivables.createAdjustment(
        { organizationId: w.a.id, customerId: w.customer.id, projectId: null, currency: 'ILS', netMinor: shekels(1_180), vatMinor: 0n, grossMinor: shekels(1_180), vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: 'Sprint 3', dueDate: '2026-12-01', postingDate: '2026-11-20', postedAt: at(0), createdByUserId: w.user.id, requestId: null },
        at(0),
      );
      const doc = await w.issued(store, w.issue({ fromEntry: { kind: 'receivable', id: owed.id } }));
      expect(doc.receivableId).toBe(owed.id);
      expect(await store.receivables.getById(w.a.id, owed.id)).toMatchObject({ origin: 'ISSUED_DOCUMENT', originId: doc.id, netMinor: shekels(1_000), vatMinor: shekels(180), grossMinor: shekels(1_180), title: 'חשבונית מס 1', dueDate: '2026-12-22', postingDate: '2026-11-22' });
      const all = await store.receivables.statementSources(w.a.id, w.customer.id, 'ILS');
      expect(all.receivables).toHaveLength(1);
      // Taken over once: a second document can't take it again.
      expect(await store.issuing.issue(w.issue({ fromEntry: { kind: 'receivable', id: owed.id } }), at(2))).toEqual({ kind: 'entry_not_found' });
    });

    it('refuses an entry of another customer, amount or profile, and takes no number (I1-a)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const owed = await store.receivables.createAdjustment(
        { organizationId: w.a.id, customerId: w.customer.id, projectId: null, currency: 'ILS', netMinor: shekels(500), vatMinor: 0n, grossMinor: shekels(500), vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: null, dueDate: '2026-12-01', postingDate: '2026-11-20', postedAt: at(0), createdByUserId: w.user.id, requestId: null },
        at(0),
      );
      expect(await store.issuing.issue(w.issue({ fromEntry: { kind: 'receivable', id: owed.id } }), at(1))).toEqual({ kind: 'entry_mismatch', field: 'amount' });
      expect(await store.issuing.issue(w.issue({ customerId: w.other.id, fromEntry: { kind: 'receivable', id: owed.id } }), at(2))).toEqual({ kind: 'entry_mismatch', field: 'customer' });
      expect(await store.issuing.issue(w.issue({ organizationId: w.b.id, customerId: null, docType: 'RECEIPT', fromEntry: { kind: 'receivable', id: owed.id } }), at(3))).toEqual({ kind: 'entry_not_found' });
      expect((await w.issued(store, w.issue(), 4)).number).toBe(1);
    });

    it('an invoice-receipt from a captured Received takes it over and it pays the document’s Owed (I1-a)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const { payment: received } = await store.payments.capture(
        { organizationId: w.a.id, customerId: w.customer.id, projectId: null, currency: 'ILS', amountMinor: shekels(1_180), receivedOn: '2026-11-21', method: 'BANK', notes: null, createdByUserId: w.user.id, requestId: null, captureSource: null },
        at(0),
      );
      const doc = await w.issued(store, w.issue({ docType: 'TAX_INVOICE_RECEIPT', fromEntry: { kind: 'payment', id: received.id }, payment: { method: 'BANK', reference: null, receivedOn: '2026-11-21' } }));
      expect(doc.paymentId).toBe(received.id);
      expect(await store.payments.getById(w.a.id, received.id)).toMatchObject({ origin: 'ISSUED_DOCUMENT', allocatedMinor: shekels(1_180) });
      expect(await store.receivables.getById(w.a.id, doc.receivableId!)).toMatchObject({ paidMinor: shekels(1_180), status: 'SETTLED' });
    });

    it('stores whether prices included VAT, on the document and each line (V1-a)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const input = w.issue();
      const composed = composeDocument({ docType: 'TAX_INVOICE', currency: 'ILS', documentDate: '2026-11-22', dealerType: 'COMPANY', documentDiscountMinor: 0n, pricesIncludeVat: true, lines: [{ description: 'All in', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(1_180), discountMinor: 0n }, { description: 'Fee', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(50), discountMinor: 0n, vatExempt: true }] });
      const doc = await w.issued(store, { ...input, composed });
      expect(doc).toMatchObject({ pricesIncludeVat: true, grossMinor: shekels(1_230), vatMinor: shekels(180) });
      expect(doc.lines.map((l) => [l.pricesIncludeVat, l.vatRateBasisPoints])).toEqual([[true, 1800], [false, 0]]);
      expect(await store.issuing.getById(w.a.id, doc.id)).toEqual(doc);
    });

    it('a receipt keeps the invoice it pays; a taken-over Owed takes the document dates (review fixes 3, 5)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const invoice = await w.issued(store, w.issue());
      const receipt = await w.issued(store, w.issue({ docType: 'RECEIPT', amount: 100, appliesToDocumentId: invoice.id }), 2);
      expect(receipt.originalId).toBe(invoice.id);
      const owed = await store.receivables.createAdjustment(
        { organizationId: w.a.id, customerId: w.customer.id, projectId: null, currency: 'ILS', netMinor: shekels(1_180), vatMinor: 0n, grossMinor: shekels(1_180), vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, title: null, dueDate: '2026-10-30', postingDate: '2026-10-28', postedAt: at(0), createdByUserId: w.user.id, requestId: null },
        at(0),
      );
      await w.issued(store, w.issue({ fromEntry: { kind: 'receivable', id: owed.id }, dueDate: '2026-12-22' }), 3);
      expect(await store.receivables.getById(w.a.id, owed.id)).toMatchObject({ postingDate: '2026-11-22', dueDate: '2026-12-22' });
    });

    it('the ledger refuses to credit, delete or pay a document-owned Owed outside issuing (review fix 2)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const invoice = await w.issued(store, w.issue());
      const credit = { amountMinor: shekels(10), netMinor: shekels(10), vatMinor: 0n, reason: 'x', reasonCode: 'OTHER', effectiveDate: '2026-11-22' as const, requestId: null };
      expect(await store.receivables.credit(w.a.id, invoice.receivableId!, credit, at(2))).toBeNull();
      expect((await store.receivables.softDeleteAdjustment(w.a.id, invoice.receivableId!, at(3)))?.deletedAt ?? null).toBeNull();
      await expect(
        store.payments.create(
          { organizationId: w.a.id, customerId: w.customer.id, projectId: null, currency: 'ILS', amountMinor: shekels(10), receivedOn: '2026-11-22', method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations: [{ receivableId: invoice.receivableId!, amountMinor: shekels(10) }] },
          at(4),
        ),
      ).rejects.toThrow();
      expect(await store.receivables.getById(w.a.id, invoice.receivableId!)).toMatchObject({ paidMinor: 0n, creditedMinor: 0n, deletedAt: null });
    });

    it('an all-exempt document posts an EXEMPT Owed (review fix 4)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const composed = composeDocument({ docType: 'TAX_INVOICE', currency: 'ILS', documentDate: '2026-11-22', dealerType: 'COMPANY', documentDiscountMinor: 0n, pricesIncludeVat: false, lines: [{ description: 'Fee', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: shekels(50), discountMinor: 0n, vatExempt: true }] });
      const doc = await w.issued(store, { ...w.issue(), composed });
      expect(await store.receivables.getById(w.a.id, doc.receivableId!)).toMatchObject({ vatTreatment: 'EXEMPT', vatMinor: 0n, grossMinor: shekels(50) });
    });

    it('a customer keeps a VAT number and address, updates and clears them (MUT-642)', async () => {
      const store = await makeStore();
      const w = await world(store);
      const c = await store.customers.create({ organizationId: w.a.id, name: 'Acme', email: null, phone: null, notes: null, taxId: '516123452', address: '5 Herzl St' }, at(1));
      expect(c).toMatchObject({ taxId: '516123452', address: '5 Herzl St' });
      const updated = await store.customers.update(w.a.id, c.id, c.version, { address: 'Haifa' }, at(2));
      expect(updated).toMatchObject({ kind: 'updated', record: { taxId: '516123452', address: 'Haifa' } });
      if (updated.kind !== 'updated') return;
      expect(await store.customers.update(w.a.id, c.id, updated.record.version, { taxId: null, address: null }, at(3))).toMatchObject({ kind: 'updated', record: { taxId: null, address: null } });
    });

    it('a document read back is a copy: changing it changes nothing stored', async () => {
      const store = await makeStore();
      const w = await world(store);
      const doc = await w.issued(store, w.issue());
      const read = (await store.issuing.getById(w.a.id, doc.id))!;
      read.lines[0]!.description = 'changed';
      (read.customer as { name: string }).name = 'changed';
      expect(await store.issuing.getById(w.a.id, doc.id)).toEqual(doc);
    });
  });
}
