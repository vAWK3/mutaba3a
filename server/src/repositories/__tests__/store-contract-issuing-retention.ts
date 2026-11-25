import { describe, expect, it } from 'vitest';
import { closureDeadline, GRACE_MS } from '../../accounts/closure.js';
import { composeDocument } from '../../issuing/compose.js';
import { ARCHIVE_KEEP_NOTICE_VERSION, sweepCutoff } from '../../issuing/retention.js';
import type { IssuedDocType } from '../../issuing/types.js';
import type { IssueDocumentInput, LedgerStore } from '../ports.js';

const ISSUER_DEFAULTS = { ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null, offerAfterSave: true, defaultDocumentsPreference: 'ON_PAYMENT' as const };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * MUT-644 (ADR-277, amended 2026-11-25) storage contract: a closed profile's issued documents survive the account
 * purge; the retention sweep deletes each one, with the clock, 7 years after its own date, and the profile's own rows
 * with the last; an erasure shortens the 7 years only after an archive carrying the keep notice was handed over.
 */
export function describeLedgerStoreIssuingRetentionContract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const T0 = new Date(Date.UTC(2026, 10, 22, 10, 0, 0));
  const DUE = new Date(T0.getTime() + GRACE_MS + 1000);

  /** A person with a business profile they alone own, its business details saved (`label` makes it findable). */
  async function owner(store: LedgerStore, label: string) {
    const { user } = await store.users.create({
      email: `retain-${unique()}@studio.ps`, displayName: 'Owner', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', locale: 'en',
      personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: T0,
    });
    const created = await store.organizations.createOwned(user.id, { name: 'Studio', slug: `studio-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: T0 }, 6, { actorId: user.id, requestId: null });
    if (created.kind !== 'created') throw new Error('cap');
    const business = created.organization;
    const vatId = String(100_000_000 + Math.floor(Math.random() * 899_999_999)).slice(0, 9);
    await store.issuing.putIssuer(business.id, { legalName: label, vatId, dealerType: 'COMPANY', address: null, city: 'Nazareth', phone: null, email: null, website: null, pricesIncludeVat: false, ...ISSUER_DEFAULTS }, null, T0);
    const session = await store.sessions.create({ userId: user.id, tokenDigest: `${unique()}${unique()}`.padEnd(64, '0'), kind: 'cookie', at: T0, idleExpiresAt: DUE, absoluteExpiresAt: DUE, userAgent: null });
    return { user, business, vatId, session };
  }

  function issueInput(organizationId: string, userId: string, docType: IssuedDocType, documentDate: string, customerId: string | null = null): IssueDocumentInput {
    return {
      organizationId,
      docType,
      documentDate,
      currency: 'ILS',
      composed: composeDocument({ docType, currency: 'ILS', documentDate, dealerType: 'COMPANY', documentDiscountMinor: 0n, pricesIncludeVat: false, lines: [{ description: 'Sprint', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 100_000n, discountMinor: 0n }] }),
      issuer: { legalName: 'Studio Ltd.', vatId: '123456789', dealerType: 'COMPANY' },
      customerId,
      customer: { name: customerId ? 'Acme Ltd.' : 'Walk-in' },
      language: 'he',
      style: 'PROFESSIONAL',
      ink: 'BLACK',
      notes: null,
      dueDate: docType === 'RECEIPT' ? null : '2026-12-22',
      originalId: null,
      payment: docType === 'RECEIPT' ? { method: 'BANK', reference: 'TRX-1', receivedOn: documentDate } : null,
      appliesToDocumentId: null,
      fromEntry: null,
      allocationNumber: null,
      titlePrefix: docType === 'RECEIPT' ? 'קבלה' : 'דרישת תשלום',
      coreVersion: '1.0.0',
      createdByUserId: userId,
      requestKey: `key-${unique()}`,
      requestId: null,
    };
  }

  async function issued(store: LedgerStore, input: IssueDocumentInput) {
    const result = await store.issuing.issue(input, T0);
    if (result.kind !== 'issued') throw new Error(`expected issued, got ${result.kind}`);
    return result.document;
  }

  async function closeAndPurge(store: LedgerStore, o: Awaited<ReturnType<typeof owner>>) {
    await store.users.requestClosure({ userId: o.user.id, at: T0, deleteAfter: closureDeadline(T0), endedSubscriptionIds: [], exceptSessionId: o.session.id, audit: [] });
    expect(await store.accountPurge.claim(o.user.id, DUE)).not.toBeNull();
    const outcome = await store.accountPurge.purge(o.user.id, DUE);
    expect(outcome?.deleteProfileIds).toContain(o.business.id);
  }

  describe(`${name} LedgerStore issuing retention contract (MUT-644)`, () => {
    it('keeps a closed profile’s documents through the purge and sweeps each one 7 years after its own date; the profile’s rows go with the last (AC1)', async () => {
      const store = await makeStore();
      const label = `Retained Studio ${unique()}`;
      const o = await owner(store, label);
      const logo = await store.issuing.addLogo(o.business.id, { contentType: 'image/png', bytes: PNG, sha256: 'a'.repeat(64) }, T0);
      const receipt = await issued(store, issueInput(o.business.id, o.user.id, 'RECEIPT', '2024-03-10'));
      const copy = await store.issuing.recordCopy(o.business.id, receipt.id, { producedByUserId: o.user.id, channel: 'DOWNLOAD' }, T0);
      await store.issuing.keepOriginalPdf(o.business.id, receipt.id, { bytes: PNG, sha256: 'b'.repeat(64), copyIndex: copy!.copyIndex }, T0);
      const customer = await store.customers.create({ organizationId: o.business.id, name: 'Acme Ltd.', email: null, phone: null, notes: null }, T0);
      const request = await issued(store, issueInput(o.business.id, o.user.id, 'PAYMENT_REQUEST', '2026-11-22', customer.id));
      // Cancelled at 01:00 on 1 January 2027 in Israel: the request counts from 2027-01-01, so it is kept through 2034-01-01.
      const cancelled = await store.issuing.cancelPaymentRequest(o.business.id, request.id, { reason: null, requestKey: `c-${unique()}`, userId: o.user.id }, new Date('2026-12-31T23:00:00Z'));
      expect(cancelled.kind).not.toBe('not_found');

      // A live profile is never swept, however old.
      expect(await store.issuingRetention.getClosed(o.business.id)).toBeNull();
      expect(await store.issuingRetention.sweep(o.business.id, '9999-01-01', T0)).toEqual({ kind: 'not_closed' });

      await closeAndPurge(store, o);
      expect(await store.organizations.getById(o.business.id)).toBeNull();
      // Survived the purge.
      expect(await store.issuing.getById(o.business.id, receipt.id)).toMatchObject({ id: receipt.id, number: receipt.number });
      expect((await store.issuing.getOriginalPdf(o.business.id, receipt.id))?.sha256).toBe('b'.repeat(64));
      const closed = { organizationId: o.business.id, legalName: label, vatId: o.vatId, documents: 2, cancellations: 1, oldestDocumentDate: '2024-03-10', newestDocumentDate: '2027-01-01' };
      expect(await store.issuingRetention.getClosed(o.business.id)).toEqual(closed);
      expect(await store.issuingRetention.listClosed({ query: label.toUpperCase() }, 10)).toEqual([closed]);
      expect(await store.issuingRetention.listClosed({ query: o.vatId.slice(0, 6) }, 500)).toContainEqual(closed);
      expect(await store.issuingRetention.listClosed({ query: label, dueBefore: '2024-03-10' }, 10)).toEqual([]);
      expect(await store.issuingRetention.listClosed({ query: label, dueBefore: '2024-03-11' }, 10)).toEqual([closed]);

      // The clock, the older document: the last moment of its 7th anniversary keeps it; the next day it goes, alone.
      expect(await store.issuingRetention.sweep(o.business.id, sweepCutoff(new Date('2031-03-10T23:59:59Z')), T0)).toEqual({ kind: 'not_due', oldestDocumentDate: '2024-03-10' });
      expect(await store.issuing.getById(o.business.id, receipt.id)).not.toBeNull();
      const firstAt = new Date('2031-03-11T00:00:00Z');
      const first = await store.issuingRetention.sweep(o.business.id, sweepCutoff(firstAt), firstAt);
      // The receipt, its line, its copy and its kept original.
      expect(first).toMatchObject({ kind: 'swept', documents: 1, cancellations: 0, rows: 4, remaining: 1, profileRows: false });
      if (first.kind !== 'swept') throw new Error('not swept');
      expect(await store.issuing.getById(o.business.id, receipt.id)).toBeNull();
      expect(await store.issuing.getOriginalPdf(o.business.id, receipt.id)).toBeNull();
      // The newer one and the profile's own rows stay.
      expect(await store.issuing.getById(o.business.id, request.id)).toMatchObject({ id: request.id });
      expect(await store.issuing.getIssuer(o.business.id)).toMatchObject({ legalName: label });
      expect(await store.issuing.getLogo(o.business.id, logo.id)).not.toBeNull();
      expect((await store.issuing.counters(o.business.id)).length).toBeGreaterThan(0);
      const left = { ...closed, documents: 1, cancellations: 1, oldestDocumentDate: '2027-01-01' };
      expect(await store.issuingRetention.getClosed(o.business.id)).toEqual(left);
      expect(await store.issuingRetention.sweep(o.business.id, sweepCutoff(firstAt), firstAt)).toEqual({ kind: 'not_due', oldestDocumentDate: '2027-01-01' });

      // The newer one counts from its cancellation's Israel date: kept through 2034-01-01, gone on the 2nd with the profile's rows.
      expect(await store.issuingRetention.sweep(o.business.id, sweepCutoff(new Date('2034-01-01T23:59:59Z')), T0)).toEqual({ kind: 'not_due', oldestDocumentDate: '2027-01-01' });
      const lastAt = new Date('2034-01-02T00:00:00Z');
      const last = await store.issuingRetention.sweep(o.business.id, sweepCutoff(lastAt), lastAt);
      expect(last).toMatchObject({ kind: 'swept', documents: 1, cancellations: 1, remaining: 0, profileRows: true });
      if (last.kind !== 'swept') throw new Error('not swept');
      // The request, its line and cancellation; the business details, the logo, the counters.
      expect(last.rows).toBeGreaterThanOrEqual(7);

      // Every retained row went.
      expect(await store.issuing.getById(o.business.id, request.id)).toBeNull();
      expect(await store.issuing.getIssuer(o.business.id)).toBeNull();
      expect(await store.issuing.getLogo(o.business.id, logo.id)).toBeNull();
      expect(await store.issuing.counters(o.business.id)).toEqual([]);
      expect(await store.issuingRetention.getClosed(o.business.id)).toBeNull();
      expect(await store.issuingRetention.sweep(o.business.id, sweepCutoff(lastAt), lastAt)).toEqual({ kind: 'nothing' });

      // Audited where the profile can't be: the retention log.
      expect(await store.issuingRetention.events(o.business.id)).toEqual([
        { id: first.event.id, organizationId: o.business.id, action: 'SWEPT', createdAt: firstAt, metadata: { documents: 1, cancellations: 0, rows: 4, remaining: 1, oldestDocumentDate: '2024-03-10', newestDocumentDate: '2024-03-10', profileRows: false } },
        { id: last.event.id, organizationId: o.business.id, action: 'SWEPT', createdAt: lastAt, metadata: { documents: 1, cancellations: 1, rows: last.rows, remaining: 0, oldestDocumentDate: '2027-01-01', newestDocumentDate: '2027-01-01', profileRows: true } },
      ]);
    });

    it('erasure shortens the 7 years only after an archive carrying the keep notice was handed over (D7)', async () => {
      const store = await makeStore();
      const o = await owner(store, `Erased Studio ${unique()}`);
      const receipt = await issued(store, issueInput(o.business.id, o.user.id, 'RECEIPT', '2026-11-20'));
      expect(await store.issuingRetention.erase(o.business.id, 'SUP-9', T0)).toEqual({ kind: 'not_closed' });
      await closeAndPurge(store, o);

      const at = new Date('2027-03-01T10:00:00Z');
      expect(await store.issuingRetention.erase(o.business.id, 'SUP-9', at)).toEqual({ kind: 'archive_not_handed_over' });
      // An archive exported before the notice existed doesn't count; nor does one logged after the erasure.
      await store.issuingRetention.record(o.business.id, 'ARCHIVE_EXPORTED', { reference: 'SUP-1', documents: 1 }, new Date('2027-02-01T10:00:00Z'));
      await store.issuingRetention.record(o.business.id, 'ARCHIVE_EXPORTED', { reference: 'SUP-2', documents: 1, noticeVersion: ARCHIVE_KEEP_NOTICE_VERSION }, new Date(at.getTime() + 1000));
      expect(await store.issuingRetention.erase(o.business.id, 'SUP-9', at)).toEqual({ kind: 'archive_not_handed_over' });
      expect(await store.issuing.getById(o.business.id, receipt.id)).not.toBeNull();

      const handed = await store.issuingRetention.record(o.business.id, 'ARCHIVE_EXPORTED', { reference: 'SUP-3', documents: 1, noticeVersion: ARCHIVE_KEEP_NOTICE_VERSION }, new Date('2027-02-15T10:00:00Z'));
      const erased = await store.issuingRetention.erase(o.business.id, 'SUP-9', at);
      expect(erased).toMatchObject({ kind: 'erased', documents: 1, cancellations: 0 });
      if (erased.kind !== 'erased') throw new Error('not erased');
      expect(erased.rows).toBeGreaterThanOrEqual(3);
      expect(await store.issuing.getById(o.business.id, receipt.id)).toBeNull();
      expect(await store.issuing.getIssuer(o.business.id)).toBeNull();
      expect(await store.issuingRetention.getClosed(o.business.id)).toBeNull();
      expect(await store.issuingRetention.erase(o.business.id, 'SUP-9', at)).toEqual({ kind: 'nothing' });
      const events = await store.issuingRetention.events(o.business.id);
      expect(events.at(-2)).toMatchObject({ id: erased.event.id, action: 'ERASED', createdAt: at, metadata: { reference: 'SUP-9', documents: 1, cancellations: 0, rows: erased.rows, archiveEventId: handed.id } });
      expect(events.map((e) => e.action)).toEqual(['ARCHIVE_EXPORTED', 'ARCHIVE_EXPORTED', 'ERASED', 'ARCHIVE_EXPORTED']);
    });

    it('a closed profile that never issued a document has nothing to keep: due at once', async () => {
      const store = await makeStore();
      const label = `Empty Studio ${unique()}`;
      const o = await owner(store, label);
      await closeAndPurge(store, o);
      const closed = await store.issuingRetention.getClosed(o.business.id);
      expect(closed).toMatchObject({ documents: 0, cancellations: 0, oldestDocumentDate: null, newestDocumentDate: null, legalName: label });
      expect(await store.issuingRetention.listClosed({ query: label, dueBefore: '2000-01-01' }, 10)).toEqual([closed]);
      expect(await store.issuingRetention.sweep(o.business.id, '2000-01-01', DUE)).toMatchObject({ kind: 'swept', documents: 0, rows: 1, remaining: 0, profileRows: true });
      expect(await store.issuing.getIssuer(o.business.id)).toBeNull();
    });

    it('records the operator’s exported archives in the log, oldest first', async () => {
      const store = await makeStore();
      const o = await owner(store, `Logged Studio ${unique()}`);
      await closeAndPurge(store, o);
      const first = await store.issuingRetention.record(o.business.id, 'ARCHIVE_EXPORTED', { reference: 'SUP-1', documents: 0 }, new Date('2027-02-01T10:00:00Z'));
      const second = await store.issuingRetention.record(o.business.id, 'ARCHIVE_EXPORTED', { reference: 'SUP-2', documents: 0 }, new Date('2027-03-01T10:00:00Z'));
      expect(first).toMatchObject({ organizationId: o.business.id, action: 'ARCHIVE_EXPORTED', metadata: { reference: 'SUP-1', documents: 0 } });
      expect((await store.issuingRetention.events(o.business.id)).map((e) => e.id)).toEqual([first.id, second.id]);
    });
  });
}
