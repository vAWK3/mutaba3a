import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { PrismaLedgerStore } from '../prisma.js';
import { describeLedgerStoreIssuingContract } from './store-contract-issuing.js';

const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma LedgerStore issuing contract (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const store = PrismaLedgerStore.connect(url);
  const raw = new PrismaClient({ datasources: { db: { url } } });
  afterAll(async () => {
    await store.disconnect();
    await raw.$disconnect();
  });
  describeLedgerStoreIssuingContract('Prisma', async () => store);

  /** AC1 below the store: the database itself refuses to change or remove an issued document (MUT-568 trigger). */
  describe('Prisma issued documents are immutable in the database (MUT-568, AC1)', () => {
    const unique = () => Math.random().toString(36).slice(2, 10);
    async function oneDocument() {
      const org = await store.organizations.create({ name: 'Imm', slug: `imm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      await raw.$executeRaw`INSERT INTO "issued_document_counters" VALUES (${org.id}::uuid, 'RECEIPT', 1, 2)`;
      const id = crypto.randomUUID();
      await raw.$executeRaw`INSERT INTO "issued_documents" ("id","organizationId","docType","number","documentDate","currency","subtotalMinor","discountMinor","netMinor","vatRateBasisPoints","vatMinor","grossMinor","pricesIncludeVat","issuer","customer","language","style","ink","coreVersion","createdByUserId","requestKey")
        VALUES (${id}::uuid, ${org.id}::uuid, 'RECEIPT', 1, '2026-11-22', 'ILS', 100, 0, 100, 0, 0, 100, false, '{}', '{}', 'he', 'PROFESSIONAL', 'BLACK', '1.0.0', ${org.id}::uuid, ${unique()})`;
      await raw.$executeRaw`INSERT INTO "issued_document_lines" VALUES (${id}::uuid, 1, ${org.id}::uuid, 'x', 'GOODS', 1000, 100, 0, 100, false, 0, 0)`;
      await raw.$executeRaw`INSERT INTO "issued_document_copies" ("documentId","copyIndex","organizationId","producedByUserId","channel") VALUES (${id}::uuid, 0, ${org.id}::uuid, ${org.id}::uuid, 'DOWNLOAD')`;
      await raw.$executeRaw`INSERT INTO "issued_document_originals" ("documentId","organizationId","copyIndex","bytes","sha256") VALUES (${id}::uuid, ${org.id}::uuid, 0, '\x25504446'::bytea, ${'a'.repeat(64)})`;
      return { org, id };
    }

    it.each([
      ['UPDATE issued_documents', (id: string) => raw.$executeRaw`UPDATE "issued_documents" SET "netMinor" = 1 WHERE "id" = ${id}::uuid`],
      ['DELETE issued_documents', (id: string) => raw.$executeRaw`DELETE FROM "issued_documents" WHERE "id" = ${id}::uuid`],
      ['UPDATE issued_document_lines', (id: string) => raw.$executeRaw`UPDATE "issued_document_lines" SET "description" = 'y' WHERE "documentId" = ${id}::uuid`],
      ['DELETE issued_document_lines', (id: string) => raw.$executeRaw`DELETE FROM "issued_document_lines" WHERE "documentId" = ${id}::uuid`],
      ['DELETE issued_document_copies', (id: string) => raw.$executeRaw`DELETE FROM "issued_document_copies" WHERE "documentId" = ${id}::uuid`],
      // MUT-641: the signed original is as permanent as the document.
      ['UPDATE issued_document_originals', (id: string) => raw.$executeRaw`UPDATE "issued_document_originals" SET "sha256" = 'x' WHERE "documentId" = ${id}::uuid`],
      ['DELETE issued_document_originals', (id: string) => raw.$executeRaw`DELETE FROM "issued_document_originals" WHERE "documentId" = ${id}::uuid`],
    ] as const)('refuses %s', async (_label, run) => {
      const { id } = await oneDocument();
      await expect(run(id)).rejects.toThrow(/immutable/);
    });

    it.each(['issued_documents', 'issued_document_lines', 'issued_document_copies', 'issued_document_counters', 'issued_document_originals'])('refuses TRUNCATE %s', async (table) => {
      await expect(raw.$executeRawUnsafe(`TRUNCATE "${table}"`)).rejects.toThrow(/immutable|append-only/);
    });

    it('never moves a counter back, nor deletes it, once a document of its type exists', async () => {
      const { org } = await oneDocument();
      await expect(raw.$executeRaw`UPDATE "issued_document_counters" SET "next" = 1 WHERE "organizationId" = ${org.id}::uuid`).rejects.toThrow(/append-only/);
      await expect(raw.$executeRaw`DELETE FROM "issued_document_counters" WHERE "organizationId" = ${org.id}::uuid`).rejects.toThrow(/append-only/);
    });

    it('keeps the documents when the profile is purged (R-D1: kept 7 years)', async () => {
      const { org, id } = await oneDocument();
      await raw.$executeRaw`DELETE FROM "organizations" WHERE "id" = ${org.id}::uuid`;
      const left = await raw.$queryRaw<Array<{ n: bigint }>>`SELECT count(*)::bigint AS n FROM "issued_documents" WHERE "id" = ${id}::uuid`;
      expect(left[0]!.n).toBe(1n);
    });
  });
}
