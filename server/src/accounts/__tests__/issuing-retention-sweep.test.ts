import { randomUUID } from 'node:crypto';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { composeDocument } from '../../issuing/compose.js';
import { MemoryLedgerStore } from '../../repositories/memory.js';
import type { LedgerStore } from '../../repositories/ports.js';
import { closureDeadline, GRACE_MS } from '../closure.js';
import { runIssuingRetentionSweep } from '../issuing-retention-sweep.js';
import { runAccountPurge } from '../purge-run.js';
import { IL_PACK } from '../../jurisdictions/il/index.js';

/** MUT-644 (ADR-277 D3): the retention sweep, alone and inside the hourly purge, over the memory store with a clock. */
const T0 = new Date(Date.UTC(2026, 10, 22, 10));
const DUE = new Date(T0.getTime() + GRACE_MS + 60_000);
const logger = pino({ level: 'silent' });
const ISSUER = { country: 'IL', vatIdScheme: 'IL_TAX_ID', dealerType: 'COMPANY' as const, address: null, city: null, phone: null, email: null, website: null, pricesIncludeVat: false, ink: 'BLACK', documentStyle: 'PROFESSIONAL', defaultLanguage: 'he', paymentTermsDays: null, bankDetails: null, footerNote: null, offerAfterSave: true, defaultDocumentsPreference: 'ON_PAYMENT' as const };

/** A person whose personal profile issued a receipt dated each of `dates`, closed at T0 (due for the purge at DUE). */
async function issuerClosing(store: LedgerStore, ...dates: string[]) {
  if (dates.length === 0) dates.push('2026-11-20');
  const { user, personalOrganization } = await store.users.create({
    email: `sweep-${randomUUID()}@studio.ps`, displayName: 'Rana', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', locale: 'en',
    personal: { name: 'Personal', slug: `personal-${randomUUID()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: T0,
  });
  const organizationId = personalOrganization.id;
  await store.issuing.putIssuer(organizationId, { legalName: 'Rana Studio', vatId: '123456782', ...ISSUER }, null, T0);
  const documents = [];
  for (const documentDate of dates) {
  const result = await store.issuing.issue({
    organizationId, docType: 'RECEIPT', documentDate, currency: 'ILS',
    composed: composeDocument({ pack: IL_PACK, docType: 'RECEIPT', currency: 'ILS', documentDate, dealerType: 'COMPANY', documentDiscountMinor: 0n, pricesIncludeVat: false, lines: [{ description: 'Sprint', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 10_000n, discountMinor: 0n }] }),
    issuer: { legalName: 'Rana Studio', vatId: '123456782', dealerType: 'COMPANY' }, customerId: null, customer: { name: 'Walk-in' }, language: 'he', style: 'PROFESSIONAL', ink: 'BLACK', notes: null, dueDate: null,
    originalId: null, payment: { method: 'BANK', reference: 'T-1', receivedOn: documentDate }, appliesToDocumentId: null, fromEntry: null, allocationNumber: null, titlePrefix: 'קבלה', coreVersion: '1.0.0', jurisdiction: 'IL', jurisdictionPackVersion: '1.0.0', createdByUserId: user.id, requestKey: `k-${randomUUID()}`, requestId: null,
  }, T0);
  if (result.kind !== 'issued') throw new Error(result.kind);
  documents.push(result.document);
  }
  const session = await store.sessions.create({ userId: user.id, tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '0'), kind: 'cookie', at: T0, idleExpiresAt: DUE, absoluteExpiresAt: DUE, userAgent: null });
  await store.users.requestClosure({ userId: user.id, at: T0, deleteAfter: closureDeadline(T0), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] });
  return { user, organizationId, document: documents[0]!, documents };
}

const purge = (store: LedgerStore, now: Date, dryRun = false) => runAccountPurge({ store, stripe: null, storage: null, logger, now, dryRun });

describe('runIssuingRetentionSweep (MUT-644)', () => {
  it('the purge keeps the documents; the sweep deletes each one 7 years after its own date (AC1)', async () => {
    const store = new MemoryLedgerStore();
    const { organizationId, document } = await issuerClosing(store);
    const first = await purge(store, DUE);
    expect(first.summary).toMatchObject({ purged: 1, issuingProfilesSwept: 0 });
    expect(await store.issuing.getById(organizationId, document.id)).not.toBeNull();

    // Kept through its 7th anniversary, 2033-11-20.
    const early = await runIssuingRetentionSweep({ store, logger, now: new Date('2033-11-20T23:59:59Z'), dryRun: false });
    expect(early).toMatchObject({ due: 0, swept: 0, documentsDeleted: 0, rows: [] });

    const dry = await runIssuingRetentionSweep({ store, logger, now: new Date('2033-11-21T00:00:00Z'), dryRun: true });
    expect(dry).toMatchObject({ dryRun: true, due: 1, swept: 1, documentsDeleted: 0, failed: 0, incomplete: false });
    expect(dry.rows).toEqual([{ organizationId, outcome: 'would-sweep', documents: 1, deleted: null, remaining: null, oldestDocumentDate: '2026-11-20', newestDocumentDate: '2026-11-20', nextSweepOn: '2033-11-21', retainedUntil: '2033-11-21' }]);
    expect(await store.issuing.getById(organizationId, document.id)).not.toBeNull();

    // The hourly purge runs it too (no account is due: only the sweep acts).
    const later = await purge(store, new Date('2033-11-21T00:30:00Z'));
    expect(later.summary).toMatchObject({ purged: 0, issuingProfilesSwept: 1 });
    expect(await store.issuing.getById(organizationId, document.id)).toBeNull();
    expect(await store.issuing.getIssuer(organizationId)).toBeNull();
    expect((await store.issuingRetention.events(organizationId)).map((e) => e.action)).toEqual(['SWEPT']);
  });

  it('two documents years apart: the older goes on its own due day, the newer stays; the profile’s rows go with the last', async () => {
    const store = new MemoryLedgerStore();
    const { organizationId, documents } = await issuerClosing(store, '2023-05-10', '2026-02-01');
    const [older, newer] = documents;
    await purge(store, DUE);

    expect(await runIssuingRetentionSweep({ store, logger, now: new Date('2030-05-10T23:59:59Z'), dryRun: false })).toMatchObject({ due: 0 });
    const first = await runIssuingRetentionSweep({ store, logger, now: new Date('2030-05-11T00:00:00Z'), dryRun: false });
    expect(first).toMatchObject({ due: 1, swept: 1, documentsDeleted: 1 });
    expect(first.rows).toEqual([{ organizationId, outcome: 'swept', documents: 2, deleted: 1, remaining: 1, oldestDocumentDate: '2023-05-10', newestDocumentDate: '2026-02-01', nextSweepOn: '2030-05-11', retainedUntil: '2033-02-02' }]);
    expect(await store.issuing.getById(organizationId, older!.id)).toBeNull();
    expect(await store.issuing.getById(organizationId, newer!.id)).not.toBeNull();
    expect(await store.issuing.getIssuer(organizationId)).not.toBeNull();

    // Nothing more is due until the newer one's day.
    expect(await runIssuingRetentionSweep({ store, logger, now: new Date('2033-02-01T23:59:59Z'), dryRun: false })).toMatchObject({ due: 0 });
    const last = await runIssuingRetentionSweep({ store, logger, now: new Date('2033-02-02T00:00:00Z'), dryRun: false });
    expect(last.rows).toMatchObject([{ outcome: 'swept', deleted: 1, remaining: 0 }]);
    expect(await store.issuing.getById(organizationId, newer!.id)).toBeNull();
    expect(await store.issuing.getIssuer(organizationId)).toBeNull();
    expect(await store.issuingRetention.getClosed(organizationId)).toBeNull();
    expect((await store.issuingRetention.events(organizationId)).map((e) => [e.action, e.metadata.remaining, e.metadata.profileRows])).toEqual([['SWEPT', 1, false], ['SWEPT', 0, true]]);
  });

  it('a dry purge never sweeps', async () => {
    const store = new MemoryLedgerStore();
    const { organizationId, document } = await issuerClosing(store, '2020-03-01');
    await purge(store, DUE);
    const dry = await purge(store, new Date('2030-01-01T00:00:00Z'), true);
    expect(dry.summary.issuingProfilesSwept).toBe(0);
    expect(await store.issuing.getById(organizationId, document.id)).not.toBeNull();
  });

  it('stops at its cap (incomplete) and one profile’s failure never stops it, nor the purge', async () => {
    const store = new MemoryLedgerStore();
    const a = await issuerClosing(store, '2020-01-10');
    const b = await issuerClosing(store, '2020-02-10');
    const c = await issuerClosing(store, '2020-03-10');
    await purge(store, DUE);
    const capped = await runIssuingRetentionSweep({ store, logger, now: new Date('2030-01-01T00:00:00Z'), dryRun: true, max: 2 });
    expect(capped).toMatchObject({ due: 2, incomplete: true });
    expect(capped.rows.map((r) => r.organizationId)).toEqual([a.organizationId, b.organizationId]);

    const sweep = store.issuingRetention.sweep.bind(store.issuingRetention);
    store.issuingRetention.sweep = async (id, before, at) => {
      if (id === a.organizationId) throw new Error('boom');
      return sweep(id, before, at);
    };
    const run = await runIssuingRetentionSweep({ store, logger, now: new Date('2030-01-01T00:00:00Z'), dryRun: false });
    expect(run).toMatchObject({ swept: 2, failed: 1 });
    expect(run.rows.find((r) => r.organizationId === a.organizationId)).toMatchObject({ outcome: 'failed' });
    expect(await store.issuing.getById(c.organizationId, c.document.id)).toBeNull();

    store.issuingRetention.listClosed = async () => {
      throw new Error('database down');
    };
    const other = await issuerClosing(store);
    expect((await purge(store, new Date(DUE.getTime() + 1000))).summary).toMatchObject({ purged: 1, issuingProfilesSwept: 0 });
    expect(await store.users.getById(other.user.id)).toBeNull();
  });
});
