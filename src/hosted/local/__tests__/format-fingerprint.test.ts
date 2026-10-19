import { describe, expect, it } from 'vitest';
import { MemoryLedgerStore } from '../../../../server/src/repositories/memory.js';

/**
 * D1 (MUT-286 plan §13.3, brief §2.5): a persisted local snapshot carries a
 * `formatVersion`; a shape change to a persisted `ports.ts` record without a
 * matching version bump + migration would silently corrupt a restore. TS
 * interfaces are erased at runtime, so there is no way to reflect over
 * `ports.ts` and derive this mechanically — this hand-maintains an expected
 * "fingerprint" (field name → runtime kind) for a representative record of
 * each type, computed from an *actual* record a real `MemoryLedgerStore`
 * produces (not just the type declaration, which could drift from what the
 * store actually returns). A field added, removed, renamed, or changed in
 * kind (e.g. a date that used to be a string) changes the computed
 * fingerprint and fails this test — the same spirit as a snapshot test: the
 * fix is either to revert the shape change or to bump `LOCAL_FORMAT_VERSION`
 * and add a migration (`migrations/index.ts`), never to update the constants
 * below without doing one of those first.
 *
 * Three of the snapshot's 27 persisted record types, per the plan's own
 * scoping judgement call: customers, receivables and organizations are
 * central to every local-mode screen; the mechanism is proven once and the
 * same technique applies to any other record a future ticket adds coverage
 * for.
 */

type FieldKind = 'string' | 'number' | 'boolean' | 'bigint' | 'Date' | 'null' | 'object' | 'undefined';

function kindOf(value: unknown): FieldKind {
  if (value === null) return 'null';
  if (value instanceof Date) return 'Date';
  if (typeof value === 'object') return 'object';
  return typeof value as FieldKind;
}

/** Field name → runtime kind, sorted by key so fingerprint order never depends on property insertion order. */
function fingerprint(record: Record<string, unknown>): Record<string, FieldKind> {
  const out: Record<string, FieldKind> = {};
  for (const key of Object.keys(record).sort()) out[key] = kindOf(record[key]);
  return out;
}

const EXPECTED_ORGANIZATION_FINGERPRINT: Record<string, FieldKind> = {
  createdAt: 'Date',
  defaultCurrency: 'string',
  id: 'string',
  name: 'string',
  ownerUserId: 'null',
  personalOwnerUserId: 'null',
  profileType: 'null',
  slug: 'string',
  timezone: 'string',
  version: 'number',
};

const EXPECTED_CUSTOMER_FINGERPRINT: Record<string, FieldKind> = {
  archivedAt: 'null',
  createdAt: 'Date',
  email: 'null',
  id: 'string',
  name: 'string',
  notes: 'null',
  organizationId: 'string',
  phone: 'null',
  status: 'string',
  updatedAt: 'Date',
  vatTreatment: 'null',
  version: 'number',
};

const EXPECTED_RECEIVABLE_FINGERPRINT: Record<string, FieldKind> = {
  agreementId: 'null',
  createdAt: 'Date',
  createdByUserId: 'string',
  creditedMinor: 'bigint',
  currency: 'string',
  customerId: 'string',
  deletedAt: 'null',
  dueDate: 'string',
  grossMinor: 'bigint',
  id: 'string',
  netMinor: 'bigint',
  organizationId: 'string',
  origin: 'string',
  originId: 'null',
  paidMinor: 'bigint',
  postedAt: 'Date',
  postingDate: 'string',
  projectId: 'null',
  status: 'string',
  title: 'string',
  vatMinor: 'bigint',
  vatRateBasisPoints: 'number',
  vatTreatment: 'string',
  version: 'number',
};

describe('local snapshot format fingerprint (D1)', () => {
  it('Organization matches the checked-in fingerprint', async () => {
    const store = new MemoryLedgerStore();
    const organization = await store.organizations.create({ name: 'Fixture Co', slug: 'fixture-org', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    expect(fingerprint(organization)).toEqual(EXPECTED_ORGANIZATION_FINGERPRINT);
  });

  it('CustomerRecord matches the checked-in fingerprint', async () => {
    const store = new MemoryLedgerStore();
    const organization = await store.organizations.create({ name: 'Fixture Co', slug: 'fixture-org', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const customer = await store.customers.create({ organizationId: organization.id, name: 'Fixture Client', email: null, phone: null, notes: null }, new Date());
    expect(fingerprint(customer)).toEqual(EXPECTED_CUSTOMER_FINGERPRINT);
  });

  it('ReceivableRecord (ADJUSTMENT origin) matches the checked-in fingerprint', async () => {
    const store = new MemoryLedgerStore();
    const organization = await store.organizations.create({ name: 'Fixture Co', slug: 'fixture-org', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const customer = await store.customers.create({ organizationId: organization.id, name: 'Fixture Client', email: null, phone: null, notes: null }, new Date());
    const receivable = await store.receivables.createAdjustment(
      {
        organizationId: organization.id,
        customerId: customer.id,
        projectId: null,
        currency: 'ILS',
        netMinor: 10_000n,
        vatMinor: 0n,
        grossMinor: 10_000n,
        vatTreatment: 'OUT_OF_SCOPE',
        vatRateBasisPoints: 0,
        title: 'Fixture receivable',
        dueDate: '2026-01-01',
        postingDate: '2026-01-01',
        postedAt: new Date('2026-01-01T00:00:00.000Z'),
        createdByUserId: 'fixture-user',
        requestId: null,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(fingerprint(receivable)).toEqual(EXPECTED_RECEIVABLE_FINGERPRINT);
  });
});
