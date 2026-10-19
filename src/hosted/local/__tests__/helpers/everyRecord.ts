import { MemoryLedgerStore } from '../../../../../server/src/repositories/memory.js';

/**
 * A store with at least one record in every map of `LocalSnapshotMaps`
 * (MUT-287, eng review R3), for the snapshot fingerprint test. Every record
 * comes from the store's own repository methods, never a hand-built object,
 * at fixed dates and in a fixed order, so the same fields are present with
 * the same kinds on every run. Each step names the map(s) it fills.
 */
const AT = new Date('2026-10-01T08:00:00.000Z');
const LATER = new Date('2026-10-05T08:00:00.000Z');

export async function storeWithEveryRecord(): Promise<MemoryLedgerStore> {
  const store = new MemoryLedgerStore();

  // orgs, people, members: a person with their personal profile
  const { user } = await store.users.create({
    email: 'rana@studio.ps',
    displayName: 'Rana Saleh',
    passwordHash: null,
    locale: 'en',
    personal: { name: 'Personal', slug: 'personal-rana', defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' },
    at: AT,
  });
  const [membership] = await store.memberships.listByUser(user.id);
  if (!membership) throw new Error('the fixture person has no profile');
  const org = membership.organizationId;

  // ints: a Malafat connection
  await store.integrations.connect({ organizationId: org, provider: 'MALAFAT', externalTenantId: 'tenant-1', displayName: 'Haddad Law', connectedByApiKeyId: 'key-1', at: AT });

  // custs, projs, refs: a client and a matter, each linked to its Malafat id
  const customer = await store.customers.create({ organizationId: org, name: 'Ramallah Bakery', email: null, phone: null, notes: null }, AT);
  const project = await store.projects.create({ organizationId: org, customerId: customer.id, name: 'Menu design', currency: 'ILS' }, AT);
  await store.externalReferences.link({ organizationId: org, provider: 'MALAFAT', externalId: 'mal-customer-1', entityType: 'CUSTOMER', entityId: customer.id }, AT);

  // rates: a VAT rate
  await store.vatRates.upsert(org, 1700, '2026-01-01', AT);

  // agrs, insts, recs: a fixed agreement with one posted installment
  const fixed = await store.agreements.create(
    {
      organizationId: org, projectId: project.id, customerId: customer.id, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, amountMinor: 90_000n, netMinor: 90_000n, vatMinor: 0n, grossMinor: 90_000n,
      agreementDate: '2026-10-01', description: 'Menu design', paymentTerms: 'IMMEDIATE', startMonth: null, billingDay: null, endMonth: null,
      installments: [
        { position: 1, label: 'First half', amountMinor: 45_000n, netMinor: 45_000n, vatMinor: 0n, grossMinor: 45_000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, triggerType: 'IMMEDIATE', triggerDate: null, paymentTerms: 'IMMEDIATE', dueDateOverride: null },
        { position: 2, label: 'Second half', amountMinor: 45_000n, netMinor: 45_000n, vatMinor: 0n, grossMinor: 45_000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, triggerType: 'MANUAL', triggerDate: null, paymentTerms: 'IMMEDIATE', dueDateOverride: null },
      ],
    },
    AT,
  );
  const posted = await store.agreements.postInstallment(org, fixed.installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-01', at: AT });
  if (!posted) throw new Error('the fixture installment did not post');

  // supps: a supplement on the fixed agreement
  await store.agreements.applySupplement(
    org,
    fixed.agreement.id,
    {
      supplement: { amountMinor: 10_000n, description: 'Extra page', effectiveDate: '2026-10-02', distribution: 'LAST_UNPOSTED', requestId: null },
      installmentUpdates: [{ id: fixed.installments[1]!.id, amountMinor: 55_000n, netMinor: 55_000n, vatMinor: 0n, grossMinor: 55_000n }],
      newInstallments: [],
      totals: { amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n, grossMinor: 100_000n },
      expectedVersion: fixed.agreement.version,
    },
    AT,
  );

  // charges, versions: a retainer with a version and a posted monthly charge
  const retainer = await store.agreements.create(
    {
      organizationId: org, projectId: project.id, customerId: customer.id, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, amountMinor: 20_000n, netMinor: 20_000n, vatMinor: 0n, grossMinor: 20_000n,
      agreementDate: '2026-10-01', description: 'Monthly support', paymentTerms: 'EOM', startMonth: '2026-10', billingDay: 1, endMonth: null, installments: [],
    },
    AT,
  );
  await store.agreements.appendVersion(
    {
      organizationId: org, agreementId: retainer.agreement.id, version: 2, effectiveMonth: '2026-11', monthlyAmountMinor: 25_000n, netMinor: 25_000n, vatMinor: 0n,
      grossMinor: 25_000n, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, billingDay: 1, paymentTerms: 'EOM', endMonth: null,
      reason: 'New scope', requestId: null, expectedAgreementVersion: retainer.agreement.version,
    },
    AT,
  );
  await store.agreements.createPostedCharge(
    {
      organizationId: org, agreementId: retainer.agreement.id, customerId: customer.id, projectId: project.id, currency: 'ILS', serviceMonth: '2026-10',
      chargeDate: '2026-10-01', amountMinor: 20_000n, netMinor: 20_000n, vatMinor: 0n, grossMinor: 20_000n, vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, dueDate: '2026-10-31',
    },
    AT,
  );

  // pays, allocs, counters: part of the installment paid
  await store.payments.create(
    {
      organizationId: org, customerId: customer.id, projectId: project.id, currency: 'ILS', amountMinor: 20_000n, receivedOn: '2026-10-03', method: 'BANK',
      reference: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: user.id, origin: 'CAPTURE', captureSource: null,
      allocations: [{ receivableId: posted.receivable.id, amountMinor: 20_000n }],
    },
    LATER,
  );

  // credits: a credit note on what is left
  await store.receivables.credit(org, posted.receivable.id, { amountMinor: 5_000n, netMinor: 5_000n, vatMinor: 0n, reason: 'Discount', effectiveDate: '2026-10-04', requestId: null }, LATER);

  // props: a fee proposal on a second matter (one open proposal per matter)
  const second = await store.projects.create({ organizationId: org, customerId: customer.id, name: 'Logo', currency: 'ILS' }, AT);
  await store.feeProposals.create(
    { organizationId: org, projectId: second.id, customerId: customer.id, currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', proposedAmountMinor: 30_000n, proposedOn: '2026-10-02', note: null, requestId: null },
    AT,
  );

  // files: a READY document
  const document = await store.attachments.create(
    { organizationId: org, kind: 'INVOICE', filename: 'invoice-014.pdf', mimeType: 'application/pdf', sizeBytes: 1024, customerId: customer.id, projectId: null, paymentId: null, invoiceNumber: 'INV-014', invoiceDate: '2026-10-01', uploadedByKeyId: 'key-1', requestId: null },
    AT,
  );
  await store.attachments.setKey(org, document.id, `org/${org}/attachments/${document.id}`);
  await store.attachments.complete(org, document.id, AT);

  // expCats, exps, expReceipts: a categorized expense with a READY receipt
  const category = await store.expenseCategories.create(org, { name: 'Travel', color: null }, AT);
  const expense = await store.expenses.create(
    { organizationId: org, occurredOn: '2026-10-02', amountMinor: 4_500n, currency: 'ILS', title: 'Taxi', vendor: 'Yellow Cab', categoryId: category.id, customerId: customer.id, projectId: project.id, notes: null, createdByUserId: user.id },
    AT,
  );
  const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expense.id, filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: 512, uploadedByUserId: user.id, requestId: null }, AT);
  await store.expenseReceipts.setKey(org, receipt.id, `org/${org}/expense-receipts/${receipt.id}`);
  await store.expenseReceipts.complete(org, receipt.id, AT);

  // convs: a conversion
  await store.conversions.create({ organizationId: org, occurredOn: '2026-10-03', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 36_500n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, AT);

  // expGroups, groupMarks: a trip group with one expense left out
  const group = await store.expenseGroups.create({ organizationId: org, name: 'Amman trip', startOn: '2026-10-01', endOn: '2026-10-05', notes: null, createdByUserId: user.id }, AT);
  await store.expenseGroups.setOverride(org, group.id, expense.id, 'excluded', AT);

  // inbox: a captured, not yet filed entry
  await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 1_200n, currency: 'ILS', occurredOn: '2026-10-04', note: 'Parking', captureSource: null }, AT);

  return store;
}
