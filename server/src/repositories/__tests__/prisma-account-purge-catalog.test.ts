import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { closureDeadline, GRACE_MS } from '../../accounts/closure.js';
import { PrismaLedgerStore } from '../prisma.js';
import { PURGE_PROFILE_TABLES, PURGE_PROFILE_TABLES_EXEMPT, PURGE_UNKEYED_USER_COLUMNS, PURGE_USER_COLUMNS } from '../prisma-purge-tables.js';

/**
 * MUT-333 AC4/AC5 (R14), against Postgres itself: every table the schema has is known to the purge, and after a
 * purge no value anywhere in the database names the person: their id, email or name, in any text, uuid, JSON or
 * array column of any table. The catalog is read, never listed here, so a table added later is checked too.
 */
const url = process.env.MUTABA3A_TEST_DATABASE_URL;

if (!url) {
  describe.skip('Prisma account purge catalog (set MUTABA3A_TEST_DATABASE_URL to run)', () => {
    it('skipped', () => {});
  });
} else {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const store = PrismaLedgerStore.connect(url);
  afterAll(async () => {
    await db.$disconnect();
    await store.disconnect();
  });

  /** Kept on purpose, with no person in them (D9): stripe_events are event ids, email_deliveries digests. */
  const OUTSIDE_PROFILES = new Set(['_prisma_migrations', 'users', 'organizations', 'sessions', 'inbox_entries', 'user_idempotency_keys', 'terms_acceptances', 'billing_accounts', 'account_setup_tokens', 'signup_reviews', 'stripe_events', 'email_deliveries', 'email_suppressions', 'passkeys', 'webauthn_challenges', 'user_feature_grants',
    // MUT-434: a person's grants and decided requests cascade with them (PURGE_USER_COLUMNS), codes and tokens with the
    // grant; clients are anonymous registrations naming no one.
    'oauth_clients', 'oauth_authorization_requests', 'oauth_grants', 'oauth_codes', 'oauth_tokens']);

  describe('Prisma account purge catalog (MUT-333)', () => {
    it('knows every table with an organizationId column', async () => {
      const rows = await db.$queryRaw<Array<{ table_name: string }>>`SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'organizationId'`;
      const known = new Set<string>([...PURGE_PROFILE_TABLES, ...Object.keys(PURGE_PROFILE_TABLES_EXEMPT)]);
      expect(rows.map((r) => r.table_name).filter((t) => !known.has(t))).toEqual([]);
      // ...and no listed table has gone (a stale name would make the purge's DELETE fail).
      expect([...known].filter((t) => !rows.some((r) => r.table_name === t))).toEqual([]);
    });

    it('knows every foreign key to users', async () => {
      const rows = await db.$queryRaw<Array<{ table: string; column: string }>>`
        SELECT c.relname AS table, a.attname AS column
          FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid
          JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = k.conkey[1]
         WHERE k.contype = 'f' AND k.confrelid = 'public.users'::regclass`;
      const found = rows.map((r) => `${r.table}.${r.column}`).sort();
      expect(found).toEqual(Object.keys(PURGE_USER_COLUMNS).sort());
    });

    it('knows every table there is, profile or not', async () => {
      const rows = await db.$queryRaw<Array<{ tablename: string }>>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
      const known = new Set<string>([...PURGE_PROFILE_TABLES, ...Object.keys(PURGE_PROFILE_TABLES_EXEMPT), ...OUTSIDE_PROFILES]);
      expect(rows.map((r) => r.tablename).filter((t) => !known.has(t))).toEqual([]);
    });

    it('leaves no value naming the person anywhere once the purge and the storage queue are done (AC4, AC5, R14)', async () => {
      const unique = randomUUID().slice(0, 8);
      const T0 = new Date(Date.UTC(2026, 9, 24, 10));
      const DUE = new Date(T0.getTime() + GRACE_MS + 1000);
      const displayName = `Zeina Catalog ${unique}`;
      const firm = await store.organizations.create({ name: 'Firm', slug: `firm-${unique}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
      const { user, personalOrganization } = await store.users.create({
        email: `zeina-${unique}@catalog.ps`,
        displayName,
        passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
        locale: 'ar',
        organizationId: firm.id,
        personal: { name: `Personal ${unique}`, slug: `personal-${unique}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
        at: T0,
      });
      const session = await store.sessions.create({ userId: user.id, tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '0'), kind: 'cookie', at: T0, idleExpiresAt: DUE, absoluteExpiresAt: DUE, userAgent: 'catalog' });
      for (const organizationId of [personalOrganization.id, firm.id]) {
        const expense = await store.expenses.create({ organizationId, occurredOn: '2026-10-20', amountMinor: 1_000n, currency: 'ILS', title: 'Paper', vendor: 'Kiosk', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id }, T0);
        await store.expenseReceipts.create({ organizationId, expenseId: expense.id, filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, receivedOn: '2026-10-20', uploadedByUserId: user.id, requestId: null }, T0);
        await store.conversions.create({ organizationId, occurredOn: '2026-10-20', amountMinor: 100n, currency: 'USD', toAmountMinor: 360n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, T0);
        await store.expenseGroups.create({ organizationId, name: 'Trip', startOn: '2026-10-01', endOn: null, notes: null, createdByUserId: user.id }, T0);
      }
      // MUT-115: a passkey, a session it opened and an open creation challenge go with the person.
      const passkey = await store.passkeys.create({ userId: user.id, credentialId: `cred-${unique}`, publicKey: new Uint8Array([1]), signCount: 0, transports: ['internal'], deviceType: 'multiDevice', backedUp: true, aaguid: '00000000-0000-0000-0000-000000000000', name: displayName.slice(0, 64), at: T0, limit: 10, audit: [] });
      await store.sessions.create({ userId: user.id, tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '2'), kind: 'device', at: T0, idleExpiresAt: DUE, absoluteExpiresAt: DUE, userAgent: null, passkeyId: passkey.id });
      await store.passkeys.createChallenge({ challenge: `challenge-${unique}`, purpose: 'creation', userId: user.id, at: T0, expiresAt: DUE });
      // MUT-433 (C1): an operator-granted feature flag goes with the person (FK cascade).
      await store.features.grant({ userId: user.id, feature: 'agent_access', grantedBy: 'admin', at: T0, audit: [] });
      await store.inboxEntries.create({ userId: user.id, kind: 'INCOME', amountMinor: 500n, currency: 'ILS', occurredOn: '2026-10-20', note: 'cash', captureSource: null }, T0);
      await store.users.acceptTerms({ userId: user.id, version: '2026-10-19', locale: 'ar', textSha256: 'f'.repeat(64), surface: 'portal', clientRelease: null, at: T0, audit: [firm.id, personalOrganization.id].map((organizationId) => ({ organizationId, actorType: 'USER', actorId: user.id, action: 'user.terms_accepted', entityType: 'user', entityId: user.id, requestId: null })) });
      await store.audit.append({ organizationId: firm.id, actorType: 'ADMIN', actorId: null, action: 'user.created', entityType: 'user', entityId: user.id, metadata: { email: user.email, displayName }, requestId: null });
      await store.audit.append({ organizationId: firm.id, actorType: 'SYSTEM', actorId: null, action: 'billing.account_linked', entityType: 'billing_account', entityId: randomUUID(), metadata: { userId: user.id }, requestId: null });
      await store.billing.saveAccount({ stripeCustomerId: `cus_${unique}`, userId: user.id, country: 'IL', currency: 'ILS', at: T0, linkAudit: [] });
      await store.accountSetup.issueSignup({ email: user.email, locale: 'ar', domainClass: 'BUSINESS', domainReasons: [], tokenDigest: randomUUID().replace(/-/g, '').padEnd(64, '1'), at: T0, expiresAt: DUE });
      const claim = await store.idempotency.claim({ organizationId: firm.id, key: `key-${unique}`, operation: 'POST /v1/expenses', fingerprint: 'f'.repeat(64), at: T0 });
      expect(claim).toBeTruthy();
      await store.idempotency.complete({ organizationId: firm.id, key: `key-${unique}`, responseStatus: 201, responseBody: { createdByUserId: user.id }, at: T0 });

      await store.users.requestClosure({ userId: user.id, at: T0, deleteAfter: closureDeadline(T0), endedSubscriptionIds: [], exceptSessionId: session.id, audit: [] });
      await store.accountPurge.claim(user.id, DUE);
      const outcome = await store.accountPurge.purge(user.id, DUE);
      for (const id of outcome!.deleteProfileIds) await store.accountPurge.finishStoragePurge(id);

      const needles = [user.id, user.email, displayName, personalOrganization.id];
      const columns = await db.$queryRaw<Array<{ table_name: string; column_name: string }>>`
        SELECT table_name, column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name <> '_prisma_migrations'
           AND data_type IN ('text', 'character varying', 'uuid', 'jsonb', 'json', 'ARRAY')`;
      const hits: string[] = [];
      for (const { table_name: table, column_name: column } of columns) {
        for (const needle of needles) {
          const [row] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(`SELECT count(*) AS n FROM "${table}" WHERE "${column}"::text LIKE $1`, `%${needle}%`);
          if (row && row.n > 0n) hits.push(`${table}.${column} ~ ${needle === user.id ? 'user id' : needle === personalOrganization.id ? 'personal profile id' : needle}`);
        }
      }
      // D8: the audit trail on a surviving profile keeps a tombstone: the bare user id as actor or subject, with
      // nothing else (no metadata, no email, no name). Everything else must be gone.
      const TOMBSTONE = new Set(['audit_events.actorId ~ user id', 'audit_events.entityId ~ user id']);
      expect(hits.filter((hit) => !TOMBSTONE.has(hit))).toEqual([]);
      // The firm is still there, with its records.
      expect(await store.organizations.getById(firm.id)).not.toBeNull();
      expect(PURGE_UNKEYED_USER_COLUMNS).toContain('receivables.createdByUserId');
    });
  });
}
