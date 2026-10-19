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
 * field one record leaves empty). `counters` holds plain numbers: `(value)`.
 */

type Fingerprint = Record<string, string>;

const EXPECTED: Record<string, Fingerprint> = {
  agrs: { agreementDate: 'string', amountMinor: 'bigint', awardedAmountMinor: 'null', billingDay: 'null|number', cancelEffectiveDate: 'null', cancelEffectiveMonth: 'null', cancelledAt: 'null', commissionRateBasisPoints: 'null', createdAt: 'Date', currency: 'string', customerId: 'string', description: 'string', endMonth: 'null', finalMonth: 'null', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', outcome: 'null', outcomeDate: 'null', outcomeNote: 'null', outcomeRecordedAt: 'null', paymentTerms: 'string', pricingBasis: 'string', projectId: 'string', startMonth: 'null|string', status: 'string', type: 'string', updatedAt: 'Date', upfrontTreatment: 'null', vatMinor: 'bigint', vatRateBasisPoints: 'number', vatTreatment: 'string', version: 'number' },
  allocs: { amountMinor: 'bigint', createdAt: 'Date', id: 'string', organizationId: 'string', paymentId: 'string', receivableId: 'string' },
  charges: { agreementId: 'string', amountMinor: 'bigint', chargeDate: 'string', createdAt: 'Date', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', postedAt: 'Date', rateBasisPoints: 'number', receivableId: 'string', serviceMonth: 'string', vatMinor: 'bigint', vatTreatment: 'string', version: 'number' },
  convs: { amountMinor: 'bigint', createdAt: 'Date', createdByUserId: 'string', currency: 'string', deletedAt: 'null', id: 'string', notes: 'null', occurredOn: 'string', organizationId: 'string', toAmountMinor: 'bigint', toCurrency: 'string', updatedAt: 'Date', version: 'number' },
  counters: { '(value)': 'number' },
  credits: { amountMinor: 'bigint', createdAt: 'Date', effectiveDate: 'string', id: 'string', netMinor: 'bigint', organizationId: 'string', reason: 'string', receivableId: 'string', requestId: 'null', vatMinor: 'bigint' },
  custs: { archivedAt: 'null', createdAt: 'Date', email: 'null', id: 'string', name: 'string', notes: 'null', organizationId: 'string', phone: 'null', status: 'string', updatedAt: 'Date', vatTreatment: 'null', version: 'number' },
  expCats: { archivedAt: 'null', color: 'null', createdAt: 'Date', id: 'string', name: 'string', organizationId: 'string', updatedAt: 'Date', version: 'number' },
  expGroups: { createdAt: 'Date', createdByUserId: 'string', deletedAt: 'null', endOn: 'string', id: 'string', name: 'string', notes: 'null', organizationId: 'string', startOn: 'string', updatedAt: 'Date', version: 'number' },
  expReceipts: { completedAt: 'Date', createdAt: 'Date', deletedAt: 'null', expenseId: 'string', filename: 'string', id: 'string', mimeType: 'string', organizationId: 'string', requestId: 'null', sizeBytes: 'number', status: 'string', storageKey: 'string', uploadedByUserId: 'string' },
  exps: { amountMinor: 'bigint', categoryId: 'string', createdAt: 'Date', createdByUserId: 'string', currency: 'string', customerId: 'string', deletedAt: 'null', id: 'string', notes: 'null', occurredOn: 'string', organizationId: 'string', projectId: 'string', title: 'string', updatedAt: 'Date', vendor: 'string', version: 'number' },
  files: { completedAt: 'Date', createdAt: 'Date', customerId: 'string', deletedAt: 'null', filename: 'string', id: 'string', invoiceDate: 'string', invoiceNumber: 'string', kind: 'string', mimeType: 'string', organizationId: 'string', paymentId: 'null', projectId: 'null', requestId: 'null', sizeBytes: 'number', status: 'string', storageKey: 'string', uploadedByKeyId: 'string' },
  groupMarks: { createdAt: 'Date', expenseId: 'string', groupId: 'string', mode: 'string', organizationId: 'string', updatedAt: 'Date' },
  inbox: { amountMinor: 'bigint', captureSource: 'null', createdAt: 'Date', currency: 'string', id: 'string', kind: 'string', note: 'string', occurredOn: 'string', updatedAt: 'Date', userId: 'string', version: 'number' },
  insts: { agreementId: 'string', amountMinor: 'bigint', dueDateOverride: 'null', grossMinor: 'bigint', id: 'string', isCommission: 'boolean', label: 'string', netMinor: 'bigint', organizationId: 'string', paymentTerms: 'string', position: 'number', postedAt: 'Date|null', postingDate: 'null|string', rateBasisPoints: 'number', receivableId: 'null|string', triggerDate: 'null', triggerType: 'string', vatMinor: 'bigint', vatTreatment: 'string', version: 'number', voidedAt: 'null' },
  ints: { connectedAt: 'Date', connectedByApiKeyId: 'string', disconnectedAt: 'null', displayName: 'string', externalTenantId: 'string', id: 'string', organizationId: 'string', provider: 'string', status: 'string' },
  members: { createdAt: 'Date', organizationId: 'string', userId: 'string' },
  orgs: { createdAt: 'Date', defaultCurrency: 'string', id: 'string', name: 'string', ownerUserId: 'string', personalOwnerUserId: 'string', profileType: 'string', slug: 'string', timezone: 'string', version: 'number' },
  pays: { allocatedMinor: 'bigint', amountMinor: 'bigint', captureSource: 'null', createdAt: 'Date', createdByUserId: 'string', currency: 'string', customerId: 'string', id: 'string', method: 'string', notes: 'null', number: 'string', organizationId: 'string', origin: 'string', projectId: 'string', receivedOn: 'string', reference: 'null', replacesPaymentId: 'null', requestId: 'null', reversalReason: 'null', reversedAt: 'null', status: 'string', updatedAt: 'Date', version: 'number' },
  people: { createdAt: 'Date', displayName: 'string', email: 'string', failedSignIns: 'number', id: 'string', lastSignInAt: 'null', locale: 'string', lockedUntil: 'null', malafatSuggestions: 'null', passwordChangedAt: 'Date', passwordHash: 'null', status: 'string', updatedAt: 'Date' },
  projs: { archivedAt: 'null', createdAt: 'Date', currency: 'string', customerId: 'string', id: 'string', name: 'string', organizationId: 'string', status: 'string', updatedAt: 'Date', vatTreatment: 'null', version: 'number' },
  props: { agreedAmountMinor: 'null', agreementId: 'null', clientApprovalNote: 'null', clientApprovedOn: 'null', commissionRateBasisPoints: 'null', createdAt: 'Date', currency: 'string', customerId: 'string', id: 'string', note: 'null', organizationId: 'string', pricingBasis: 'string', projectId: 'string', proposedAmountMinor: 'bigint', proposedOn: 'string', requestId: 'null', status: 'string', updatedAt: 'Date', upfrontTreatment: 'null', version: 'number', withdrawnAt: 'null', withdrawnReason: 'null' },
  rates: { createdAt: 'Date', effectiveFrom: 'string', id: 'string', organizationId: 'string', rateBasisPoints: 'number' },
  recs: { agreementId: 'string', createdAt: 'Date', createdByUserId: 'null', creditedMinor: 'bigint', currency: 'string', customerId: 'string', deletedAt: 'null', dueDate: 'string', grossMinor: 'bigint', id: 'string', netMinor: 'bigint', organizationId: 'string', origin: 'string', originId: 'string', paidMinor: 'bigint', postedAt: 'Date', postingDate: 'string', projectId: 'string', status: 'string', title: 'null', vatMinor: 'bigint', vatRateBasisPoints: 'number', vatTreatment: 'string', version: 'number' },
  refs: { createdAt: 'Date', entityId: 'string', entityType: 'string', externalId: 'string', id: 'string', organizationId: 'string', provider: 'string' },
  supps: { agreementId: 'string', amountMinor: 'bigint', createdAt: 'Date', description: 'string', distribution: 'string', effectiveDate: 'string', id: 'string', organizationId: 'string', requestId: 'null', resultingAmountMinor: 'bigint' },
  versions: { agreementId: 'string', billingDay: 'number', createdAt: 'Date', effectiveMonth: 'string', endMonth: 'null', grossMinor: 'bigint', id: 'string', monthlyAmountMinor: 'bigint', netMinor: 'bigint', organizationId: 'string', paymentTerms: 'string', pricingBasis: 'string', rateBasisPoints: 'number', reason: 'string', requestId: 'null', vatMinor: 'bigint', vatTreatment: 'string', version: 'number' },
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

  it.each(Object.keys(EXPECTED).sort())('%s matches the checked-in fingerprint', async (key) => {
    const maps = (await storeWithEveryRecord()).snapshot().maps as unknown as Record<string, Map<string, unknown>>;
    expect(fingerprintOf(maps[key]!.values())).toEqual(EXPECTED[key]);
  });
});
