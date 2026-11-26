import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { composeDocument } from '../../issuing/compose.js';
import { UsageCapReached } from '../../usage/cap-reached.js';
import type { IssueDocumentInput, LedgerStore, UsageStamp } from '../ports.js';
import { PrismaLedgerStore } from '../prisma.js';

/**
 * MUT-731 (ADR-284, plan tests "Postgres contract"): Starter's hard caps ride the usage counter's conditional upsert in
 * the action's own transaction. Two issues racing at 2 of 3 documents: exactly one is issued, the other answers
 * plan_limit, the counter ends at 3 and the loser's number is rolled back (no gap). A library scan completing at 11 of
 * 12 counts and flips; the 13th is refused and its receipt stays pending.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma Starter caps (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store: LedgerStore = PrismaLedgerStore.connect(url, { starterPlan: true });
  const raw = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await (store as PrismaLedgerStore).disconnect();
    await raw.$disconnect();
  });

  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 10, 22, 10, 0, 0, ms));
  const MONTH = '2026-11';

  async function world() {
    const org = await store.organizations.create({ name: 'Starter', slug: `starter-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const { user } = await store.users.create({ email: `s-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: 'x', locale: 'en', organizationId: org.id, personal: { name: 'Personal', slug: `personal-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) });
    const stamp: UsageStamp = { subjectKey: `user:${user.id}`, plan: 'starter', door: 'PORTAL', actorUserId: user.id };
    const seedCounter = (meter: 'DOCUMENTS' | 'SCANS', count: number) =>
      raw.$executeRaw`INSERT INTO "usage_counters" ("subjectKey","month","meter","count","plan","updatedAt") VALUES (${stamp.subjectKey}, ${MONTH}, ${meter}, ${count}, 'starter', ${at(0)})`;
    const counter = async (meter: 'DOCUMENTS' | 'SCANS') =>
      (await raw.usageCounter.findUnique({ where: { subjectKey_month_meter: { subjectKey: stamp.subjectKey, month: MONTH, meter } } }))?.count ?? 0;
    return { org, user, stamp, seedCounter, counter };
  }

  describe('Prisma Starter caps (MUT-731)', () => {
    it('two issues racing at 2 of 3 documents: one issued, one plan_limit, counter 3, numbering without a gap', async () => {
      const w = await world();
      const customer = await store.customers.create({ organizationId: w.org.id, name: 'Acme Digital Ltd.', email: null, phone: null, notes: null }, at(0));
      await w.seedCounter('DOCUMENTS', 2);
      const input = (): IssueDocumentInput => ({
        organizationId: w.org.id,
        docType: 'TAX_INVOICE',
        documentDate: '2026-11-22',
        currency: 'ILS',
        composed: composeDocument({
          docType: 'TAX_INVOICE',
          currency: 'ILS',
          documentDate: '2026-11-22',
          dealerType: 'COMPANY',
          documentDiscountMinor: 0n,
          pricesIncludeVat: false,
          lines: [{ description: 'Sprint 3', kind: 'SERVICE', quantityMilli: 1_000n, unitPriceMinor: 100_000n, discountMinor: 0n }],
        }),
        issuer: { legalName: 'Barmajiyat Ltd.', vatId: '123456789', dealerType: 'COMPANY' },
        customerId: customer.id,
        customer: { name: 'Acme Digital Ltd.' },
        language: 'he',
        style: 'PROFESSIONAL',
        ink: 'BLACK',
        notes: null,
        dueDate: '2026-12-22',
        originalId: null,
        payment: null,
        appliesToDocumentId: null,
        fromEntry: null,
        allocationNumber: null,
        titlePrefix: 'חשבונית מס',
        coreVersion: '1.0.0',
        createdByUserId: w.user.id,
        requestKey: `key-${randomUUID()}`,
        requestId: null,
        usage: w.stamp,
      });

      const results = await Promise.all([store.issuing.issue(input(), at(1)), store.issuing.issue(input(), at(2))]);
      const kinds = results.map((r) => r.kind).sort();
      expect(kinds).toEqual(['issued', 'plan_limit']);
      expect(results.find((r) => r.kind === 'plan_limit')).toEqual({ kind: 'plan_limit', used: 3, cap: 3 });
      const winner = results.find((r) => r.kind === 'issued');
      expect(winner && winner.kind === 'issued' && winner.document.number).toBe(1);

      expect(await w.counter('DOCUMENTS')).toBe(3);
      expect(await raw.issuedDocument.count({ where: { organizationId: w.org.id } })).toBe(1);
      expect(await raw.usageEvent.count({ where: { subjectKey: w.stamp.subjectKey, kind: 'DOCUMENT_ISSUED' } })).toBe(1);
      expect((await store.issuing.gaps(w.org.id)).find((g) => g.docType === 'TAX_INVOICE')).toMatchObject({ last: 1, missing: [] });
    });

    it('a library scan completing at 11 of 12 counts and flips; the 13th is refused and stays pending', async () => {
      const w = await world();
      await w.seedCounter('SCANS', 11);
      const upload = async (ms: number) => {
        const r = await store.expenseReceipts.create(
          { organizationId: w.org.id, expenseId: null, filename: 'scan.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, receivedOn: '2026-11-22', uploadedByUserId: w.user.id, requestId: null },
          at(ms),
        );
        await store.expenseReceipts.setKey(r.organizationId, r.id, `org/${r.organizationId}/expense-receipts/${r.id}`);
        return r;
      };

      const twelfth = await upload(1);
      const done = await store.expenseReceipts.complete(w.org.id, twelfth.id, at(1), undefined, w.stamp);
      expect(done?.status).toBe('READY');
      expect(await w.counter('SCANS')).toBe(12);

      const thirteenth = await upload(2);
      await expect(store.expenseReceipts.complete(w.org.id, thirteenth.id, at(2), undefined, w.stamp)).rejects.toBeInstanceOf(UsageCapReached);
      expect((await raw.expenseReceipt.findUniqueOrThrow({ where: { id: thirteenth.id } })).status).toBe('PENDING_UPLOAD');
      expect(await w.counter('SCANS')).toBe(12);
      expect(await raw.usageEvent.count({ where: { subjectKey: w.stamp.subjectKey, kind: 'SCAN' } })).toBe(1);
    });
  });
}
