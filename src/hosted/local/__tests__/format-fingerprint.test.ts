import { describe, expect, it } from 'vitest';
import { storeWithEveryRecord } from './helpers/everyRecord.js';

/**
 * D1 (MUT-286 plan §13.3, brief §2.5): a persisted local snapshot carries a
 * `formatVersion`; a shape change to a persisted `ports.ts` record without a
 * matching version bump + migration would silently corrupt a restore. TS
 * interfaces are erased at runtime, so this hand-maintains an expected
 * "fingerprint" (field name → runtime kinds) per snapshot map, computed from
 * *actual* records a real `MemoryLedgerStore` produces (`helpers/everyRecord.ts`
 * fills every map through the store's own repository methods). A field
 * added, removed, renamed, or changed in kind changes the computed
 * fingerprint and fails this test. The fix is either to revert the shape
 * change or to bump `LOCAL_FORMAT_VERSION` and add a migration
 * (`migrations/index.ts`), never to update the table below without doing one
 * of those first.
 *
 * MUT-287 (eng review R3, resolves TD-171): every map is covered, not three of
 * 27, and a map added to the snapshot without a row here fails the first
 * test, so nothing new reaches devices unwatched. A field's kinds are the
 * union across the fixture's records of that map (e.g. `null|string` for a
 * field one record leaves empty); the fixture fills every nullable field once
 * (review D10), and a test keeps it that way. `counters` holds plain numbers:
 * `(value)`.
 */

type Fingerprint = Record<string, string>;

const EXPECTED: Record<string, Fingerprint> = {
  agrs: { agreementDate: 'string', amountMinor: 'bigint', awardedAmountMinor: 'bigint|null', billingDay: 'null|number', cancelEffectiveDate: 'null|string', cancelEffectiveMonth: 'null|string', cancelledAt: 'Date|null', commissionRateBasisPoints: 'null|number', createdAt: 'Date', currency: 'string', customerId: 'string', description: 'null|string', endMonth: 'null|string', finalMonth: 'null|string', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', outcome: 'null|string', outcomeDate: 'null|string', outcomeNote: 'null|string', outcomeRecordedAt: 'Date|null', paymentTerms: 'string', pricingBasis: 'string', projectId: 'string', startMonth: 'null|string', status: 'string', type: 'string', updatedAt: 'Date', upfrontTreatment: 'null|string', vatMinor: 'bigint', vatRateBasisPoints: 'number', vatTreatment: 'string', version: 'number' },
  allocs: { amountMinor: 'bigint', createdAt: 'Date', id: 'string', organizationId: 'string', paymentId: 'string', receivableId: 'string' },
  charges: { agreementId: 'string', amountMinor: 'bigint', chargeDate: 'string', createdAt: 'Date', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', postedAt: 'Date', rateBasisPoints: 'number', receivableId: 'string', serviceMonth: 'string', vatMinor: 'bigint', vatTreatment: 'string', version: 'number' },
  convs: { amountMinor: 'bigint', createdAt: 'Date', createdByUserId: 'string', currency: 'string', deletedAt: 'Date|null', id: 'string', notes: 'null|string', occurredOn: 'string', organizationId: 'string', toAmountMinor: 'bigint', toCurrency: 'string', updatedAt: 'Date', version: 'number' },
  counters: { '(value)': 'number' },
  credits: { amountMinor: 'bigint', createdAt: 'Date', effectiveDate: 'string', id: 'string', netMinor: 'bigint', organizationId: 'string', reason: 'string', receivableId: 'string', requestId: 'null|string', vatMinor: 'bigint' },
  custs: { archivedAt: 'Date|null', createdAt: 'Date', email: 'null|string', id: 'string', name: 'string', notes: 'null|string', organizationId: 'string', phone: 'null|string', status: 'string', updatedAt: 'Date', vatTreatment: 'null|string', version: 'number' },
  expCats: { archivedAt: 'Date|null', color: 'null|string', createdAt: 'Date', id: 'string', name: 'string', organizationId: 'string', updatedAt: 'Date', version: 'number' },
  expGroups: { createdAt: 'Date', createdByUserId: 'string', deletedAt: 'Date|null', endOn: 'null|string', id: 'string', name: 'string', notes: 'null|string', organizationId: 'string', startOn: 'string', updatedAt: 'Date', version: 'number' },
  expReceipts: { completedAt: 'Date|null', createdAt: 'Date', deletedAt: 'Date|null', expenseId: 'string', filename: 'string', id: 'string', mimeType: 'string', organizationId: 'string', requestId: 'null|string', sizeBytes: 'number', status: 'string', storageKey: 'string', uploadedByUserId: 'string' },
  exps: { amountMinor: 'bigint', categoryId: 'null|string', createdAt: 'Date', createdByUserId: 'string', currency: 'string', customerId: 'null|string', deletedAt: 'Date|null', id: 'string', notes: 'null|string', occurredOn: 'string', organizationId: 'string', projectId: 'null|string', title: 'null|string', updatedAt: 'Date', vendor: 'null|string', version: 'number' },
  files: { completedAt: 'Date|null', createdAt: 'Date', customerId: 'string', deletedAt: 'Date|null', filename: 'string', id: 'string', invoiceDate: 'null|string', invoiceNumber: 'null|string', kind: 'string', mimeType: 'string', organizationId: 'string', paymentId: 'null|string', projectId: 'null|string', requestId: 'null|string', sizeBytes: 'number', status: 'string', storageKey: 'string', uploadedByKeyId: 'null|string' },
  groupMarks: { createdAt: 'Date', expenseId: 'string', groupId: 'string', mode: 'string', organizationId: 'string', updatedAt: 'Date' },
  inbox: { amountMinor: 'bigint', captureSource: 'null|string', createdAt: 'Date', currency: 'string', id: 'string', kind: 'string', note: 'null|string', occurredOn: 'string', updatedAt: 'Date', userId: 'string', version: 'number' },
  insts: { agreementId: 'string', amountMinor: 'bigint', dueDateOverride: 'null|string', grossMinor: 'bigint', id: 'string', isCommission: 'boolean', label: 'string', netMinor: 'bigint', organizationId: 'string', paymentTerms: 'string', position: 'number', postedAt: 'Date|null', postingDate: 'null|string', rateBasisPoints: 'number', receivableId: 'null|string', triggerDate: 'null|string', triggerType: 'string', vatMinor: 'bigint', vatTreatment: 'string', version: 'number', voidedAt: 'Date|null' },
  ints: { connectedAt: 'Date', connectedByApiKeyId: 'string', disconnectedAt: 'Date|null', displayName: 'string', externalTenantId: 'string', id: 'string', organizationId: 'string', provider: 'string', status: 'string' },
  members: { createdAt: 'Date', organizationId: 'string', userId: 'string' },
  orgs: { createdAt: 'Date', defaultCurrency: 'string', id: 'string', name: 'string', ownerUserId: 'string', personalOwnerUserId: 'string', profileType: 'string', slug: 'string', timezone: 'string', version: 'number' },
  pays: { allocatedMinor: 'bigint', amountMinor: 'bigint', captureSource: 'null|string', createdAt: 'Date', createdByUserId: 'string', currency: 'string', customerId: 'string', id: 'string', method: 'string', notes: 'null|string', number: 'string', organizationId: 'string', origin: 'string', projectId: 'null|string', receivedOn: 'string', reference: 'null|string', replacesPaymentId: 'null|string', requestId: 'null|string', reversalReason: 'null|string', reversedAt: 'Date|null', status: 'string', updatedAt: 'Date', version: 'number' },
  people: { createdAt: 'Date', displayName: 'string', email: 'string', failedSignIns: 'number', id: 'string', lastSignInAt: 'Date|null', locale: 'string', lockedUntil: 'Date|null', malafatSuggestions: 'null|object', passwordChangedAt: 'Date', passwordHash: 'null|string', status: 'string', updatedAt: 'Date' },
  projs: { archivedAt: 'Date|null', createdAt: 'Date', currency: 'string', customerId: 'string', id: 'string', name: 'string', organizationId: 'string', status: 'string', updatedAt: 'Date', vatTreatment: 'null|string', version: 'number' },
  props: { agreedAmountMinor: 'bigint|null', agreementId: 'null|string', clientApprovalNote: 'null|string', clientApprovedOn: 'null|string', commissionRateBasisPoints: 'null|number', createdAt: 'Date', currency: 'string', customerId: 'string', id: 'string', note: 'null|string', organizationId: 'string', pricingBasis: 'string', projectId: 'string', proposedAmountMinor: 'bigint', proposedOn: 'string', requestId: 'null|string', status: 'string', updatedAt: 'Date', upfrontTreatment: 'null|string', version: 'number', withdrawnAt: 'Date|null', withdrawnReason: 'null|string' },
  rates: { createdAt: 'Date', effectiveFrom: 'string', id: 'string', organizationId: 'string', rateBasisPoints: 'number' },
  recs: { agreementId: 'null|string', createdAt: 'Date', createdByUserId: 'null|string', creditedMinor: 'bigint', currency: 'string', customerId: 'string', deletedAt: 'Date|null', dueDate: 'string', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', origin: 'string', originId: 'null|string', paidMinor: 'bigint', postedAt: 'Date', postingDate: 'string', projectId: 'null|string', status: 'string', title: 'null|string', vatMinor: 'bigint', vatRateBasisPoints: 'number', vatTreatment: 'string', version: 'number' },
  refs: { createdAt: 'Date', entityId: 'string', entityType: 'string', externalId: 'string', id: 'string', organizationId: 'string', provider: 'string' },
  supps: { agreementId: 'string', amountMinor: 'bigint', createdAt: 'Date', description: 'null|string', distribution: 'string', effectiveDate: 'string', id: 'string', organizationId: 'string', requestId: 'null|string', resultingAmountMinor: 'bigint' },
  versions: { agreementId: 'string', billingDay: 'number', createdAt: 'Date', effectiveMonth: 'string', endMonth: 'null|string', grossMinor: 'bigint', id: 'string', monthlyAmountMinor: 'bigint', netMinor: 'bigint', organizationId: 'string', paymentTerms: 'string', pricingBasis: 'string', rateBasisPoints: 'number', reason: 'string', requestId: 'null|string', vatMinor: 'bigint', vatTreatment: 'string', version: 'number' },
};

function kindOf(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Date) return 'Date';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

/** Field name → every kind it takes across the map's records, sorted, so order never depends on insertion. */
function fingerprintOf(records: Iterable<unknown>): Fingerprint {
  const kinds: Record<string, Set<string>> = {};
  for (const record of records) {
    if (record === null || typeof record !== 'object' || record instanceof Date) {
      (kinds['(value)'] ??= new Set()).add(kindOf(record));
      continue;
    }
    for (const [field, value] of Object.entries(record)) (kinds[field] ??= new Set()).add(kindOf(value));
  }
  return Object.fromEntries(Object.keys(kinds).sort().map((field) => [field, [...kinds[field]!].sort().join('|')]));
}

describe('local snapshot format fingerprint (D1, every map)', () => {
  it('has a case for every map the snapshot persists', async () => {
    const maps = (await storeWithEveryRecord()).snapshot().maps;
    expect(Object.keys(maps).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('fills every map in the fixture, so no fingerprint is computed from nothing', async () => {
    const maps = (await storeWithEveryRecord()).snapshot().maps as unknown as Record<string, Map<string, unknown>>;
    const empty = Object.keys(maps).filter((key) => maps[key]!.size === 0);
    expect(empty).toEqual([]);
  });

  it('sees every field with a value at least once, so a kind change in a usually-empty field fails too (review D10)', async () => {
    const maps = (await storeWithEveryRecord()).snapshot().maps as unknown as Record<string, Map<string, unknown>>;
    const onlyNull = Object.keys(maps).flatMap((key) => Object.entries(fingerprintOf(maps[key]!.values())).filter(([, kinds]) => kinds === 'null').map(([field]) => `${key}.${field}`));
    expect(onlyNull).toEqual([]);
  });

  it.each(Object.keys(EXPECTED).sort())('%s matches the checked-in fingerprint', async (key) => {
    const maps = (await storeWithEveryRecord()).snapshot().maps as unknown as Record<string, Map<string, unknown>>;
    expect(fingerprintOf(maps[key]!.values())).toEqual(EXPECTED[key]);
  });
});
