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

  // orgs (MUT-300): an owned Business profile with a pending firm request, and one with firm features on
  const audit = { actorId: user.id, requestId: null };
  for (const slug of ['studio-requested', 'studio-firm']) {
    const owned = await store.organizations.createOwned(user.id, { name: 'Studio', slug, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem', profileType: 'BUSINESS', at: AT }, 6, audit);
    if (owned.kind !== 'created') throw new Error('the fixture person is at the owned-profile cap');
    if (slug === 'studio-requested') await store.organizations.requestFirm(owned.organization.id, user.id, AT, audit);
    else await store.organizations.setFirm(owned.organization.id, { enabled: true, ownerUserIds: [] }, LATER, audit);
  }

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
  const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expense.id, filename: 'taxi.pdf', mimeType: 'application/pdf', sizeBytes: 512, receivedOn: '2026-10-02', uploadedByUserId: user.id, requestId: null }, AT);
  await store.expenseReceipts.setKey(org, receipt.id, `org/${org}/expense-receipts/${receipt.id}`);
  await store.expenseReceipts.complete(org, receipt.id, AT);

  // expReceipts (MUT-255): a library receipt with a reader's suggestion, approved into its own expense
  const scanned = await store.expenseReceipts.create(
    { organizationId: org, expenseId: null, filename: 'cafe.jpg', mimeType: 'image/jpeg', sizeBytes: 2048, receivedOn: '2026-10-02', suggested: { readerVersion: 'phone-1.0', totalMinor: { value: '1500', source: 'ocr', confidence: 0.9 } }, uploadedByUserId: user.id, requestId: null },
    AT,
  );
  await store.expenseReceipts.setKey(org, scanned.id, `org/${org}/expense-receipts/${scanned.id}`);
  await store.expenseReceipts.complete(org, scanned.id, AT);
  await store.expenseReceipts.fileAsExpense(
    {
      organizationId: org,
      receiptId: scanned.id,
      userId: user.id,
      expense: { organizationId: org, occurredOn: '2026-10-02', amountMinor: 1_500n, currency: 'ILS', title: null, vendor: 'Cafe', categoryId: null, customerId: null, projectId: null, notes: null, createdByUserId: user.id },
      approved: { occurredOn: '2026-10-02', amountMinor: '1500', currency: 'ILS', vendor: 'Cafe', categoryId: null },
    },
    AT,
  );

  // convs: a conversion
  await store.conversions.create({ organizationId: org, occurredOn: '2026-10-03', amountMinor: 10_000n, currency: 'USD', toAmountMinor: 36_500n, toCurrency: 'ILS', notes: null, createdByUserId: user.id }, AT);

  // expGroups, groupMarks: a trip group with one expense left out
  const group = await store.expenseGroups.create({ organizationId: org, name: 'Amman trip', startOn: '2026-10-01', endOn: '2026-10-05', notes: null, createdByUserId: user.id }, AT);
  await store.expenseGroups.setOverride(org, group.id, expense.id, 'excluded', AT);

  // inbox: a captured, not yet filed entry
  await store.inboxEntries.create({ userId: user.id, kind: 'EXPENSE', amountMinor: 1_200n, currency: 'ILS', occurredOn: '2026-10-04', note: 'Parking', captureSource: null }, AT);

  await fillEveryNullableField(store, org, user.id, { customer: customer.id, project: project.id, posted: posted.receivable.id, fixed: fixed.agreement.id, retainer: retainer.agreement.id });
  return store;
}

/**
 * A second record of each kind with every optional field set once (review
 * D10): a field the fixture only ever leaves null fingerprints as just
 * 'null', and a kind change in it (a Date that became a string) would pass.
 * Each still comes from the store's own operations: archive, soft delete,
 * reverse, cancel, record an outcome, withdraw.
 */
async function fillEveryNullableField(store: MemoryLedgerStore, org: string, userId: string, ids: { customer: string; project: string; posted: string; fixed: string; retainer: string }): Promise<void> {
  const need = <T>(value: T | null | undefined, what: string): T => {
    if (value === null || value === undefined) throw new Error(`fixture: ${what} failed`);
    return value;
  };
  const line = (position: number, amountMinor: bigint, extra: Partial<{ triggerType: 'IMMEDIATE' | 'DATE' | 'MANUAL'; triggerDate: string | null; dueDateOverride: string | null }> = {}) => ({
    position, label: `Line ${position}`, amountMinor, netMinor: amountMinor, vatMinor: 0n, grossMinor: amountMinor, vatTreatment: 'OUT_OF_SCOPE' as const, rateBasisPoints: 0,
    triggerType: extra.triggerType ?? ('MANUAL' as const), triggerDate: extra.triggerDate ?? null, paymentTerms: 'IMMEDIATE' as const, dueDateOverride: extra.dueDateOverride ?? null,
  });

  // people: a person with a password who signed in, then got locked out, and changed their Malafat suggestions
  const { user: other } = await store.users.create({
    email: 'nour@studio.ps', displayName: 'Nour', passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', locale: 'ar',
    personal: { name: 'Personal', slug: 'personal-nour', defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' }, at: AT,
  });
  await store.users.recordSignIn(other.id, AT);
  await store.users.recordFailedSignIn(other.id, LATER, new Date('2026-10-05T08:15:00.000Z'));
  await store.users.updateMalafatSuggestions(other.id, { off: true }, LATER);

  // ints: a connection that was later disconnected (on the other person's profile: one connection per profile and provider)
  const [otherMembership] = await store.memberships.listByUser(other.id);
  const otherOrg = need(otherMembership, 'second profile').organizationId;
  const integration = await store.integrations.connect({ organizationId: otherOrg, provider: 'MALAFAT', externalTenantId: 'tenant-2', displayName: 'Old firm', connectedByApiKeyId: 'key-2', at: AT });
  await store.integrations.disconnect(integration.id, LATER);

  // custs, projs: with every contact field and a VAT treatment, then archived
  const archivedClient = await store.customers.create({ organizationId: org, name: 'Old client', email: 'old@client.ps', phone: '+970590000000', notes: 'Moved away', vatTreatment: 'STANDARD_RATED' }, AT);
  const archivedMatter = await store.projects.create({ organizationId: org, customerId: archivedClient.id, name: 'Old matter', currency: 'ILS', vatTreatment: 'STANDARD_RATED' }, AT);
  await store.projects.archive(org, archivedMatter.id, LATER);
  await store.customers.archive(org, archivedClient.id, LATER);

  // insts, agrs: dated and overridden lines on an agreement that was cancelled, voiding them
  const cancelled = await store.agreements.create(
    {
      organizationId: org, projectId: ids.project, customerId: ids.customer, type: 'FIXED', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, amountMinor: 10_000n, netMinor: 10_000n, vatMinor: 0n, grossMinor: 10_000n,
      agreementDate: '2026-10-01', description: null, paymentTerms: 'IMMEDIATE', startMonth: null, billingDay: null, endMonth: null,
      installments: [line(1, 10_000n, { triggerType: 'DATE', triggerDate: '2026-12-01', dueDateOverride: '2026-12-15' })],
    },
    AT,
  );
  await store.agreements.cancel(org, cancelled.agreement.id, { cancelEffectiveMonth: null, cancelEffectiveDate: '2026-10-10', finalMonth: null }, LATER);

  // agrs: a retainer with an end month, cancelled from a month with a final-month rule; versions: an end month and a request id
  const ending = await store.agreements.create(
    {
      organizationId: org, projectId: ids.project, customerId: ids.customer, type: 'RECURRING', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, amountMinor: 5_000n, netMinor: 5_000n, vatMinor: 0n, grossMinor: 5_000n,
      agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: '2026-10', billingDay: 1, endMonth: '2027-06', installments: [],
    },
    AT,
  );
  const versioned = await store.agreements.appendVersion(
    {
      organizationId: org, agreementId: ending.agreement.id, version: 2, effectiveMonth: '2026-11', monthlyAmountMinor: 6_000n, netMinor: 6_000n, vatMinor: 0n,
      grossMinor: 6_000n, pricingBasis: 'VAT_EXCLUSIVE', vatTreatment: 'OUT_OF_SCOPE', rateBasisPoints: 0, billingDay: 1, paymentTerms: 'EOM', endMonth: '2027-06',
      reason: 'Raise', requestId: 'req-version', expectedAgreementVersion: ending.agreement.version,
    },
    AT,
  );
  need(versioned.kind === 'updated' ? versioned : null, 'appendVersion');
  await store.agreements.cancel(org, ending.agreement.id, { cancelEffectiveMonth: '2026-12', finalMonth: 'PRORATE' }, LATER);

  // agrs: a contingency agreement with its terms, awarded
  const contingency = await store.agreements.create(
    {
      organizationId: org, projectId: ids.project, customerId: ids.customer, type: 'CONTINGENCY', currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE',
      vatTreatment: 'OUT_OF_SCOPE', vatRateBasisPoints: 0, amountMinor: 0n, netMinor: 0n, vatMinor: 0n, grossMinor: 0n,
      agreementDate: '2026-10-01', description: 'Claim', paymentTerms: 'IMMEDIATE', startMonth: null, billingDay: null, endMonth: null,
      commissionRateBasisPoints: 2_500, upfrontTreatment: 'SEPARATE', installments: [],
    },
    AT,
  );
  const outcome = await store.agreements.recordOutcome(
    org,
    contingency.agreement.id,
    {
      outcome: 'AWARDED', outcomeDate: '2026-10-04', awardedAmountMinor: 400_000n, outcomeNote: 'Won at first instance', commissionRateBasisPoints: 2_500, upfrontTreatment: 'SEPARATE',
      commissionInstallment: { ...line(1, 100_000n), isCommission: true }, totals: { amountMinor: 100_000n, netMinor: 100_000n, vatMinor: 0n, grossMinor: 100_000n },
      upfrontReceivables: [], expectedVersion: contingency.agreement.version,
    },
    LATER,
  );
  need(outcome.kind === 'updated' ? outcome : null, 'recordOutcome');

  // supps: with a request id
  const fixedNow = need(await store.agreements.getById(org, ids.fixed), 'fixed agreement');
  const fixedLines = await store.agreements.listInstallments(org, ids.fixed);
  const unposted = need(fixedLines.find((i) => i.receivableId === null && !i.voidedAt), 'an unposted line');
  await store.agreements.applySupplement(
    org,
    ids.fixed,
    {
      supplement: { amountMinor: 1_000n, description: null, effectiveDate: '2026-10-03', distribution: 'LAST_UNPOSTED', requestId: 'req-supplement' },
      installmentUpdates: [{ id: unposted.id, amountMinor: unposted.amountMinor + 1_000n, netMinor: unposted.netMinor + 1_000n, vatMinor: 0n, grossMinor: unposted.grossMinor + 1_000n }],
      newInstallments: [],
      totals: { amountMinor: fixedNow.amountMinor + 1_000n, netMinor: fixedNow.netMinor + 1_000n, vatMinor: 0n, grossMinor: fixedNow.grossMinor + 1_000n },
      expectedVersion: fixedNow.version,
    },
    LATER,
  );

  // credits: with a request id
  await store.receivables.credit(org, ids.posted, { amountMinor: 1_000n, netMinor: 1_000n, vatMinor: 0n, reason: 'Goodwill', effectiveDate: '2026-10-04', requestId: 'req-credit' }, LATER);

  // recs: an adjustment with a title and its author, then voided
  const adjustment = await store.receivables.createAdjustment({
    organizationId: org, customerId: ids.customer, projectId: null, currency: 'ILS', netMinor: 3_000n, vatMinor: 0n, grossMinor: 3_000n, vatTreatment: 'OUT_OF_SCOPE',
    vatRateBasisPoints: 0, title: 'Court fee', dueDate: '2026-10-20', postingDate: '2026-10-01', postedAt: AT, createdByUserId: userId, requestId: 'req-adjustment',
  }, AT);
  await store.receivables.softDeleteAdjustment(org, adjustment.id, LATER);

  // pays: a captured payment with every note, reversed, and the payment that replaced it
  const mistaken = await store.payments.create(
    {
      organizationId: org, customerId: ids.customer, projectId: null, currency: 'USD', amountMinor: 5_000n, receivedOn: '2026-10-04', method: 'CASH',
      reference: 'RCPT-9', notes: 'Cash at the office', replacesPaymentId: null, requestId: 'req-pay', createdByUserId: userId, origin: 'CAPTURE', captureSource: 'ios', allocations: [],
    },
    LATER,
  );
  await store.payments.reverse(org, mistaken.payment.id, 'Wrong currency', LATER);
  await store.payments.create(
    {
      organizationId: org, customerId: ids.customer, projectId: null, currency: 'ILS', amountMinor: 18_000n, receivedOn: '2026-10-04', method: 'CASH',
      reference: null, notes: null, replacesPaymentId: mistaken.payment.id, requestId: null, createdByUserId: userId, origin: 'CAPTURE', captureSource: null, allocations: [],
    },
    LATER,
  );

  // props: one approved into an agreement with the client's note, one withdrawn
  const approvedMatter = await store.projects.create({ organizationId: org, customerId: ids.customer, name: 'Contract review', currency: 'ILS' }, AT);
  const approved = await store.feeProposals.create(
    {
      organizationId: org, projectId: approvedMatter.id, customerId: ids.customer, currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', proposedAmountMinor: 20_000n, proposedOn: '2026-10-02',
      note: 'Flat fee', commissionRateBasisPoints: 2_000, upfrontTreatment: 'CREDITED', requestId: 'req-proposal',
    },
    AT,
  );
  await store.feeProposals.transition(org, approved.id, ['PROPOSED'], { status: 'APPROVED', clientApprovedOn: '2026-10-03', clientApprovalNote: 'By phone', agreedAmountMinor: 19_000n, agreementId: ids.fixed }, LATER);
  const withdrawnMatter = await store.projects.create({ organizationId: org, customerId: ids.customer, name: 'Lease', currency: 'ILS' }, AT);
  const withdrawn = await store.feeProposals.create(
    { organizationId: org, projectId: withdrawnMatter.id, customerId: ids.customer, currency: 'ILS', pricingBasis: 'VAT_EXCLUSIVE', proposedAmountMinor: 5_000n, proposedOn: '2026-10-02', note: null, requestId: null },
    AT,
  );
  await store.feeProposals.transition(org, withdrawn.id, ['PROPOSED'], { status: 'WITHDRAWN', withdrawnAt: LATER, withdrawnReason: 'Client went elsewhere' }, LATER);

  // expCats: a coloured category, archived
  const category = await store.expenseCategories.create(org, { name: 'Old category', color: '#ff0000' }, AT);
  await store.expenseCategories.update(org, category.id, category.version, { archived: true }, LATER);

  // exps, expReceipts: an expense with notes and a receipt with a request id, both deleted
  const expense = await store.expenses.create(
    { organizationId: org, occurredOn: '2026-10-02', amountMinor: 900n, currency: 'ILS', title: null, vendor: null, categoryId: null, customerId: null, projectId: null, notes: 'Duplicate', createdByUserId: userId },
    AT,
  );
  const receipt = await store.expenseReceipts.create({ organizationId: org, expenseId: expense.id, filename: 'dup.pdf', mimeType: 'application/pdf', sizeBytes: 100, receivedOn: '2026-10-02', uploadedByUserId: userId, requestId: 'req-receipt' }, AT);
  await store.expenseReceipts.setKey(org, receipt.id, `org/${org}/expense-receipts/${receipt.id}`);
  await store.expenseReceipts.softDelete(org, receipt.id, LATER);
  await store.expenses.softDelete(org, expense.id, LATER);

  // expReceipts (MUT-255): a receipt waiting in the library, never read
  const waiting = await store.expenseReceipts.create({ organizationId: org, expenseId: null, filename: 'scan.png', mimeType: 'image/png', sizeBytes: 300, receivedOn: '2026-10-03', uploadedByUserId: userId, requestId: null }, AT);
  await store.expenseReceipts.setKey(org, waiting.id, `org/${org}/expense-receipts/${waiting.id}`);
  await store.expenseReceipts.complete(org, waiting.id, AT);

  // convs, expGroups: with notes, deleted
  const conversion = await store.conversions.create({ organizationId: org, occurredOn: '2026-10-03', amountMinor: 1_000n, currency: 'USD', toAmountMinor: 3_650n, toCurrency: 'ILS', notes: 'Twice by mistake', createdByUserId: userId }, AT);
  await store.conversions.softDelete(org, conversion.id, LATER);
  const group = await store.expenseGroups.create({ organizationId: org, name: 'Cancelled trip', startOn: '2026-11-01', endOn: null, notes: 'Postponed', createdByUserId: userId }, AT);
  await store.expenseGroups.softDelete(org, group.id, LATER);

  // files: a document on a matter and a payment, with a request id, deleted
  const document = await store.attachments.create(
    { organizationId: org, kind: 'RECEIPT', filename: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 10, customerId: ids.customer, projectId: ids.project, paymentId: mistaken.payment.id, invoiceNumber: null, invoiceDate: null, uploadedByKeyId: null, requestId: 'req-file' },
    AT,
  );
  await store.attachments.setKey(org, document.id, `org/${org}/attachments/${document.id}`);
  await store.attachments.softDelete(org, document.id, LATER);

  // inbox: with its capture source
  await store.inboxEntries.create({ userId, kind: 'INCOME', amountMinor: 50_000n, currency: 'ILS', occurredOn: '2026-10-04', note: null, captureSource: 'ios' }, AT);
}
