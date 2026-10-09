/* eslint-disable no-console */
/**
 * Money v1 end-to-end run over HTTP: Malafat's own Mutaba3a client (the code
 * the Partner's browser requests reach through /api/admin/money/*) driving a
 * running Mutaba3a server. Every milestone, every state transition, and the
 * security edges (auth, scopes, tenant isolation, idempotency, optimistic
 * concurrency, preview tokens). Creates its own throwaway organizations;
 * organizations are never deleted (audit retention), so run it against a
 * dev/staging database, never production.
 *
 *   MUTABA3A_ADMIN_TOKEN=… E2E_BASE_URL=http://localhost:8787 \
 *   MALAFAT_WEB_DIR=/path/to/malafat/crm-platform/apps/web \
 *   npx tsx e2e/money-v1.e2e.mts
 *
 * Run it from the Malafat monorepo root with `npx tsx <path-to-this-file>` if
 * the Mutaba3a checkout has no tsx of its own.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const MALAFAT_WEB_DIR = process.env.MALAFAT_WEB_DIR ?? resolve(import.meta.dirname, '../../../malafat/crm-platform/apps/web');
type ClientModule = typeof import('../../../malafat/crm-platform/apps/web/src/features/money/application/mutaba3a-client');
const loaded = (await import(pathToFileURL(resolve(MALAFAT_WEB_DIR, 'src/features/money/application/mutaba3a-client.ts')).href)) as unknown as { default?: ClientModule } & ClientModule;
const { createMutaba3aClient, MoneyConnectionError } = (loaded.createMutaba3aClient ? loaded : loaded.default!) as ClientModule;

const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:8787';
const ADMIN = process.env.MUTABA3A_ADMIN_TOKEN;
if (!ADMIN) {
  console.error('MUTABA3A_ADMIN_TOKEN is not set');
  process.exit(1);
}
const ALL_SCOPES = ['integration:read', 'integration:write', 'customers:read', 'customers:write', 'projects:read', 'projects:write', 'agreements:read', 'agreements:write', 'payments:read', 'payments:write', 'attachments:read', 'attachments:write', 'summaries:read', 'audit:read'];

let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail?: unknown): void {
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL  ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
  }
}
function minor(s: string): bigint {
  const neg = s.startsWith('-');
  const [i, f = ''] = s.replace('-', '').split('.');
  const v = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  return neg ? -v : v;
}
function sum(xs: string[]): bigint {
  return xs.reduce((a, x) => a + minor(x), 0n);
}
async function expectError(name: string, fn: () => Promise<unknown>, want: Partial<{ reason: string; code: string; conflictReason: string; validationReason: string }>): Promise<void> {
  try {
    await fn();
    check(name, false, 'resolved instead of failing');
  } catch (e) {
    if (!(e instanceof MoneyConnectionError)) {
      check(name, false, String(e));
      return;
    }
    const got = { reason: e.reason, code: e.code, conflictReason: e.conflictReason, validationReason: e.validationReason };
    const ok = Object.entries(want).every(([k, v]) => (got as Record<string, unknown>)[k] === v);
    check(name, ok, got);
  }
}
let n = 0;
const key = (action: string) => `malafat-${action}-tenant-e2e-${String(++n).padStart(4, '0')}-${Date.now()}`;

async function admin<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-token': ADMIN }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json as T;
}

const client = createMutaba3aClient({ baseUrl: BASE });

// ---------- Provisioning (operator) ----------
const RUN = Date.now().toString(36);
const TENANT = `tenant-e2e-${RUN}`;
const org = await admin<{ id: string; slug: string }>('/admin/v1/organizations', { name: 'E2E Law Firm', slug: `e2e-${RUN}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
const issued = await admin<{ secret: string; apiKey: { id: string; scopes: string[] } }>(`/admin/v1/organizations/${org.id}/api-keys`, { name: 'Malafat', scopes: ALL_SCOPES });
const KEY = issued.secret;
const narrow = await admin<{ secret: string }>(`/admin/v1/organizations/${org.id}/api-keys`, { name: 'narrow', scopes: ['customers:read'] });
const NARROW = narrow.secret;
const other = await admin<{ id: string }>('/admin/v1/organizations', { name: 'Other Firm', slug: `other-${RUN}`, defaultCurrency: 'USD', timezone: 'Asia/Jerusalem' });
const otherKey = await admin<{ secret: string }>(`/admin/v1/organizations/${other.id}/api-keys`, { name: 'Malafat', scopes: ALL_SCOPES });
const OTHER = otherKey.secret;
check('admin: organization + full key + narrow key + second organization provisioned', Boolean(KEY && NARROW && OTHER));

// ---------- M1: integration ----------
const before = await client.getIntegration(KEY);
check('M1 integration status before bind: no integration, no missing scopes', before.integration === null && before.missingScopes.length === 0, { integration: before.integration, missing: before.missingScopes });
const bindKey = key('bind');
const bound = await client.bind(KEY, { externalTenantId: TENANT, displayName: 'E2E Law Firm' }, bindKey);
check('M1 bind creates the integration', bound.created === true && bound.integration.externalTenantId === TENANT, bound);
const replay = await client.bind(KEY, { externalTenantId: TENANT, displayName: 'E2E Law Firm' }, bindKey);
check('M1 bind replay with the same key and body returns the stored outcome (same integration, stored 201 replayed)', replay.integration.id === bound.integration.id && replay.integration.connectedAt === bound.integration.connectedAt, replay);
await expectError('M1 bind with the same key and a different body → IDEMPOTENCY_KEY_REUSED', () => client.bind(KEY, { externalTenantId: 'tenant-other', displayName: 'X' }, bindKey), { code: 'IDEMPOTENCY_KEY_REUSED' });
await expectError('SEC the same Malafat tenant cannot bind to a second organization → ORGANIZATION_MISMATCH', () => client.bind(OTHER, { externalTenantId: TENANT, displayName: 'Impostor' }, key('bind')), { reason: 'organization_mismatch' });
await expectError('SEC forged key → unauthenticated', () => client.getIntegration('mut_test_aaaaaaaa_' + 'b'.repeat(43)), { reason: 'invalid_key' });
await expectError('SEC narrow key lacks integration:read → 403 with missing scopes', () => client.getIntegration(NARROW), { reason: 'missing_scopes' });

// ---------- M2: customers, projects, import ----------
const cust = await client.createCustomer(KEY, { name: 'Acme Ltd', email: 'acme@example.test', externalReference: { provider: 'MALAFAT', externalId: 'client-1' } }, key('customer'));
check('M2 customer created with external reference', cust.created === true && cust.entity.id.length > 0, cust);
const custAgain = await client.createCustomer(KEY, { name: 'Acme Ltd', externalReference: { provider: 'MALAFAT', externalId: 'client-1' } }, key('customer'));
check('M2 same external id links to the existing customer (no duplicate)', custAgain.created === false && custAgain.entity.id === cust.entity.id, custAgain);
const proj = await client.createProject(KEY, { customerId: cust.entity.id, name: 'Acme v. State', currency: 'ILS', externalReference: { provider: 'MALAFAT', externalId: 'matter-1' } }, key('project'));
check('M2 project created in ILS', proj.created === true && proj.entity.currency === 'ILS', proj);
const projUsd = await client.createProject(KEY, { customerId: cust.entity.id, name: 'Acme USD advisory', currency: 'USD', externalReference: { provider: 'MALAFAT', externalId: 'matter-2' } }, key('project'));
check('M2 second project in USD', projUsd.created === true && projUsd.entity.currency === 'USD');
const byExt = await client.listCustomers(KEY, { externalId: 'client-1' });
check('M2 list customers by external id', byExt.items.length === 1 && byExt.items[0]!.id === cust.entity.id);
const plan = await client.importPreview(KEY, [
  { entityType: 'CUSTOMER', externalId: 'client-2', name: 'Beta Holdings' },
  { entityType: 'PROJECT', externalId: 'matter-3', name: 'Beta lease', currency: 'ILS', customerExternalId: 'client-2' },
  { entityType: 'CUSTOMER', externalId: 'client-1', name: 'Acme Ltd' },
]);
check('M2 import preview plans create/create/link', plan.rows.map((r) => r.action).join(',') === 'create,create,link', plan.rows);
const committed = await client.importCommit(KEY, [
  { entityType: 'CUSTOMER', externalId: 'client-2', name: 'Beta Holdings' },
  { entityType: 'PROJECT', externalId: 'matter-3', name: 'Beta lease', currency: 'ILS', customerExternalId: 'client-2' },
  { entityType: 'CUSTOMER', externalId: 'client-1', name: 'Acme Ltd' },
], plan.previewToken, key('import'));
check('M2 import commit: 2 created, 1 linked, 0 failed', committed.totals.created === 2 && committed.totals.linked === 1 && committed.totals.failed === 0, committed.totals);
const beta = (await client.listCustomers(KEY, { externalId: 'client-2' })).items[0]!;
const betaProj = (await client.listProjects(KEY, { externalId: 'matter-3' })).items[0]!;
check('M2 imported customer and project are listed', Boolean(beta && betaProj));
const fresh = await client.getCustomer(KEY, cust.entity.id);
const patched = await client.patchCustomer(KEY, cust.entity.id, { vatTreatment: 'STANDARD_RATED', notes: 'e2e' }, fresh.version);
check('M2 PATCH customer with If-Match bumps the version', patched.version === fresh.version + 1 && patched.vatTreatment === 'STANDARD_RATED', patched);
await expectError('M2 PATCH with a stale version → 409', () => client.patchCustomer(KEY, cust.entity.id, { notes: 'stale' }, fresh.version), { reason: 'conflict' });
await expectError('SEC other organization cannot read this customer (404, not 403)', () => client.getCustomer(OTHER, cust.entity.id), { reason: 'not_found' });
await expectError('SEC narrow key cannot create customers', () => client.createCustomer(NARROW, { name: 'x', externalReference: { provider: 'MALAFAT', externalId: 'z' } }, key('customer')), { reason: 'missing_scopes' });
const narrowList = await client.listCustomers(NARROW);
check('SEC narrow key can list customers (its one scope)', narrowList.items.length >= 2);

// ---------- M3: VAT, fixed-fee agreement, retainer ----------
const vat = await client.setVatRate(KEY, { rateBasisPoints: 1800, effectiveFrom: '2026-01-01' });
check('M3 VAT rate 18 % set from 2026-01-01', vat.entity.rateBasisPoints === 1800, vat);
const vatAgain = await client.setVatRate(KEY, { rateBasisPoints: 1800, effectiveFrom: '2026-01-01' });
check('M3 same VAT rate again is idempotent (created=false)', vatAgain.created === false);
const rates = await client.listVatRates(KEY);
check('M3 VAT rates list has the rate in force', rates.rates.length === 1);

const agreementBody = {
  projectId: proj.entity.id,
  amount: '10000.00',
  pricingBasis: 'VAT_EXCLUSIVE' as const,
  agreementDate: '2026-10-01',
  description: 'Litigation fee',
  installments: [
    { label: 'On signing', percentBasisPoints: 5000, trigger: { type: 'IMMEDIATE' as const } },
    { label: 'On judgment', percentBasisPoints: 5000, trigger: { type: 'MANUAL' as const } },
  ],
};
const ap = await client.previewAgreement(KEY, agreementBody);
check('M3 fixed-fee preview: 10000 net → 1800 VAT → 11800 gross, two installments', minor(ap.totals.gross) === 1180000n && ap.installments.length === 2, ap.totals);
await expectError('M3 create with a forged preview token → 409 PREVIEW_STALE', () => client.createAgreement(KEY, { ...agreementBody, previewToken: 'f'.repeat(64) }, key('agreement')), { conflictReason: 'PREVIEW_STALE' });
const agKey = key('agreement');
const ag = await client.createAgreement(KEY, { ...agreementBody, previewToken: ap.previewToken }, agKey);
check('M3 agreement created; IMMEDIATE installment posted, MANUAL pending', ag.installments.filter((i) => i.receivableId).length === 1, ag.installments.map((i) => [i.label, i.status]));
const agReplay = await client.createAgreement(KEY, { ...agreementBody, previewToken: ap.previewToken }, agKey);
check('M3 create replay returns the same agreement', agReplay.agreement.id === ag.agreement.id);
let recv = await client.listReceivables(KEY, { projectId: proj.entity.id });
check('M3 one DUE receivable of 5900 gross (net 5000 + VAT 900), due end of month', recv.items.length === 1 && minor(recv.items[0]!.gross) === 590000n && recv.items[0]!.status === 'DUE' && recv.items[0]!.dueDate === '2026-10-31', recv.items);
const manual = ag.installments.find((i) => !i.receivableId)!;
const trig = await client.triggerInstallment(KEY, manual.id, { dueDate: '2026-11-30' }, key('trigger'));
check('M3 manual installment triggered → receivable due 2026-11-30', trig.receivable.dueDate === '2026-11-30', trig);
const trigAgain = await client.triggerInstallment(KEY, manual.id, {}, key('trigger'));
check('M3 triggering an already posted installment is idempotent: created=false, same receivable', trigAgain.created === false && trigAgain.receivable.id === trig.receivable.id, trigAgain);
const sup = await client.addSupplement(KEY, ag.agreement.id, { amount: '1000.00', description: 'Extra hearing', effectiveDate: '2026-10-05', distribution: 'NEW_INSTALLMENT', newInstallment: { label: 'Extra hearing', trigger: { type: 'IMMEDIATE' } } }, key('supplement'));
check('M3 supplement as a new IMMEDIATE installment: three installments, +1000 contractual', sup.installments.length === 3 && minor(sup.effect.contractualDelta) === 100000n && sup.effect.installmentsCreated.length === 1, sup.effect);
recv = await client.listReceivables(KEY, { projectId: proj.entity.id });
check('M3 three receivables on the fixed-fee project totalling 12980', recv.items.length === 3 && sum(recv.items.map((r) => r.gross)) === 1298000n, recv.items.map((r) => r.gross));

const retBody = { projectId: betaProj.id, monthlyAmount: '2000.00', pricingBasis: 'VAT_EXCLUSIVE' as const, startMonth: '2026-07', billingDay: 1, paymentTerms: 'EOM' as const, description: 'Monthly retainer' };
const rp = await client.previewRetainer(KEY, retBody);
check('M3 retainer preview: Jul–Oct due now, next charge 2026-11-01', rp.chargesDueNow.length === 4 && rp.nextChargeDate === '2026-11-01', rp);
const ret = await client.createRetainer(KEY, { ...retBody, previewToken: rp.previewToken }, key('retainer'));
check('M3 retainer created with four posted charges, version 1', ret.charges.length === 4 && ret.versions.length === 1 && ret.charges.every((c) => c.version === 1), ret.charges.map((c) => c.serviceMonth));

// ---------- M5: change terms, cancel preview, prorated cancel ----------
const changeBody = { effectiveMonth: '2026-11', monthlyAmount: '2500.00', reason: 'Scope grew' };
const cp = await client.previewRetainerChange(KEY, ret.agreement.id, changeBody);
check('M5 change preview: previous 2000 → next 2500 from 2026-11, first charged 2026-11, no generated month at or after it', minor(cp.previous.monthlyAmount) === 200000n && minor(cp.next.monthlyAmount) === 250000n && cp.chargesKept.length === 0 && cp.firstChargedMonth === '2026-11' && cp.changed.join() === 'monthlyAmount', cp);
await expectError('M5 change with nothing changed → CHANGE_NOTHING_CHANGED', () => client.previewRetainerChange(KEY, ret.agreement.id, { effectiveMonth: '2026-11', reason: 'noop' }), { validationReason: 'CHANGE_NOTHING_CHANGED' });
await expectError('M5 change effective at or before the current version → CHANGE_EFFECTIVE_INVALID', () => client.previewRetainerChange(KEY, ret.agreement.id, { effectiveMonth: '2026-07', monthlyAmount: '1.00', reason: 'late' }), { validationReason: 'CHANGE_EFFECTIVE_INVALID' });
const backdated = await client.previewRetainerChange(KEY, ret.agreement.id, { effectiveMonth: '2026-09', monthlyAmount: '2200.00', reason: 'backdated' });
check('M5 a change effective in an already charged month keeps Sep and Oct at their terms (versions, not edits)', backdated.chargesKept.join() === '2026-09,2026-10' && backdated.firstChargedMonth === '2026-11', backdated);
const changed = await client.changeRetainer(KEY, ret.agreement.id, { ...changeBody, previewToken: cp.previewToken }, key('retainer-change'));
check('M5 change applied: two versions, charges unchanged', changed.versions.length === 2 && changed.charges.length === 4, changed.versions);
const cancelPreview = await client.previewRetainerCancel(KEY, ret.agreement.id, { effectiveDate: '2026-10-15', finalMonth: 'PRORATE' });
check('M5 cancel preview PRORATE 15/31 of October: posted charge, credit adjustment, stops from 2026-11', cancelPreview.finalCharge?.posted === true && cancelPreview.finalCharge.days === 15 && cancelPreview.adjustment !== null && cancelPreview.stoppedFrom === '2026-11', cancelPreview);
await expectError('M5 cancel that credits a posted month without the token → PREVIEW_TOKEN_REQUIRED', () => client.cancelRetainer(KEY, ret.agreement.id, { effectiveDate: '2026-10-15', finalMonth: 'PRORATE' }, key('retainer-cancel')), { validationReason: 'PREVIEW_TOKEN_REQUIRED' });
const cancelled = await client.cancelRetainer(KEY, ret.agreement.id, { effectiveDate: '2026-10-15', finalMonth: 'PRORATE', previewToken: cancelPreview.previewToken }, key('retainer-cancel'));
const octCharge = cancelled.charges.find((c) => c.serviceMonth === '2026-10')!;
const octRecv = (await client.listReceivables(KEY, { projectId: betaProj.id })).items.find((r) => r.id === octCharge.receivableId)!;
check('M5 cancelled: October receivable credited down to the prorated gross', cancelled.agreement.status === 'CANCELLED' && minor(octRecv.credited) === minor(cancelPreview.adjustment!.amount) && minor(octRecv.outstanding) === minor(cancelPreview.finalCharge!.gross), { status: cancelled.agreement.status, octRecv });
const octCredits = await client.listCredits(KEY, octCharge.receivableId);
check('M5 the cancellation credit is listed on the receivable', octCredits.credits.length === 1);
await expectError('M5 changing a cancelled retainer → conflict', () => client.previewRetainerChange(KEY, ret.agreement.id, { effectiveMonth: '2026-12', monthlyAmount: '1.00', reason: 'x' }), { reason: 'conflict' });

// ---------- M4: payments ----------
const openAcme = (await client.listReceivables(KEY, { customerId: cust.entity.id, status: 'OPEN' })).items;
const allocPreview = await client.previewAllocations(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '7000.00', strategy: 'OLDEST_FIRST' });
check('M4 allocation preview spends 7000 oldest-first across ILS receivables, nothing unallocated', minor(allocPreview.allocated) === 700000n && minor(allocPreview.unallocated) === 0n && allocPreview.eligible.length === openAcme.length, allocPreview.allocations);
await expectError('M4 payment with a forged token → 409 PREVIEW_STALE', () => client.createPayment(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '7000.00', receivedOn: '2026-10-08', method: 'BANK', allocations: allocPreview.allocations, previewToken: 'a'.repeat(64) }, key('payment')), { conflictReason: 'PREVIEW_STALE' });
const payKey = key('payment');
const pay = await client.createPayment(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '7000.00', receivedOn: '2026-10-08', method: 'BANK', reference: 'TRX-1', allocations: allocPreview.allocations, previewToken: allocPreview.previewToken }, payKey);
check('M4 payment POSTED, fully allocated', pay.status === 'POSTED' && minor(pay.unallocated) === 0n && pay.allocations.length === allocPreview.allocations.length, pay);
const payReplay = await client.createPayment(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '7000.00', receivedOn: '2026-10-08', method: 'BANK', reference: 'TRX-1', allocations: allocPreview.allocations, previewToken: allocPreview.previewToken }, payKey);
check('M4 payment replay returns the same payment', payReplay.id === pay.id);
const op = await client.getOperation(KEY, payKey);
check('M4 GET /v1/operations/{key} → COMPLETED with the payment', op?.status === 'COMPLETED' && (op.response as { id?: string })?.id === pay.id, op);
check('M4 operations lookup of an unknown key → null', (await client.getOperation(KEY, 'never-used-key-0001')) === null);
const afterPay = (await client.listReceivables(KEY, { customerId: cust.entity.id })).items;
check('M4 first receivable (5900) PAID, the next PARTIALLY_PAID, 7000 paid in total', afterPay.some((r) => r.status === 'PAID') && afterPay.some((r) => r.status === 'PARTIALLY_PAID') && sum(afterPay.map((r) => r.paid)) === 700000n, afterPay.map((r) => [r.gross, r.paid, r.status]));

const unallocPreview = await client.previewAllocations(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '10000.00', allocations: [] });
const pay2 = await client.createPayment(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '10000.00', receivedOn: '2026-10-08', method: 'CASH', allocations: [], previewToken: unallocPreview.previewToken }, key('payment'));
check('M4 unallocated payment recorded (allocate later)', minor(pay2.unallocated) === 1000000n, pay2);
const laterPreview = await client.previewAllocations(KEY, { paymentId: pay2.id, strategy: 'OLDEST_FIRST' });
const outstandingBefore = sum((await client.listReceivables(KEY, { customerId: cust.entity.id, status: 'OPEN' })).items.filter((r) => r.currency === 'ILS').map((r) => r.outstanding));
check('M4 allocate-later preview spends what is outstanding, rest stays unallocated', minor(laterPreview.allocated) === outstandingBefore && minor(laterPreview.unallocated) === 1000000n - outstandingBefore, laterPreview);
const allocated = await client.allocatePayment(KEY, pay2.id, { allocations: laterPreview.allocations, previewToken: laterPreview.previewToken }, key('payment-allocate'));
check('M4 allocation applied to the payment', minor(allocated.allocated) === outstandingBefore, allocated);
const settled = (await client.listReceivables(KEY, { customerId: cust.entity.id, currency: 'ILS' })).items;
check('M4 every ILS receivable of the customer is PAID', settled.every((r) => r.status === 'PAID' && minor(r.outstanding) === 0n), settled.map((r) => r.status));
const usdPreview = await client.previewAllocations(KEY, { customerId: cust.entity.id, currency: 'USD', amount: '10.00', strategy: 'OLDEST_FIRST' });
check('M4 allocations never cross a currency: USD preview finds no eligible ILS receivables', usdPreview.warnings.includes('NO_ELIGIBLE_RECEIVABLES') && usdPreview.eligible.length === 0 && minor(usdPreview.unallocated) === 1000n, usdPreview);

const rev = await client.reversePayment(KEY, pay.id, { reason: 'Bounced cheque' }, key('payment-reverse'));
check('M4 payment reversed: status REVERSED, allocations released', rev.status === 'REVERSED' && rev.reversalReason === 'Bounced cheque', rev);
await expectError('M4 reversing again → ALREADY_REVERSED', () => client.reversePayment(KEY, pay.id, { reason: 'again' }, key('payment-reverse')), { conflictReason: 'ALREADY_REVERSED' });
const afterRev = (await client.listReceivables(KEY, { customerId: cust.entity.id, currency: 'ILS' })).items;
check('M4 after reversal 7000 is outstanding again across the receivables', sum(afterRev.map((r) => r.outstanding)) === 700000n, afterRev.map((r) => [r.gross, r.paid, r.outstanding, r.status]));
const toCredit = afterRev.find((r) => minor(r.outstanding) > 0n)!;
const credit = await client.creditReceivable(KEY, toCredit.id, { amount: '100.00', reason: 'Goodwill' }, key('credit'));
check('M4 credit of 100 reduces the outstanding by 100', minor(credit.receivable.outstanding) === minor(toCredit.outstanding) - 10000n && minor(credit.credit.amount) === 10000n, credit);
await expectError('M4 credit above the outstanding → refused', () => client.creditReceivable(KEY, toCredit.id, { amount: '999999.00', reason: 'too much' }, key('credit')), { reason: 'validation' });
const corrected = await client.createPayment(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '6900.00', receivedOn: '2026-10-08', method: 'BANK', replacesPaymentId: pay.id, allocations: [], previewToken: (await client.previewAllocations(KEY, { customerId: cust.entity.id, currency: 'ILS', amount: '6900.00', allocations: [] })).previewToken }, key('payment'));
const payAfter = await client.getPayment(KEY, pay.id);
check('M4 corrected payment links both ways', corrected.replacesPaymentId === pay.id && payAfter.replacedByPaymentId === corrected.id);
const payments = await client.listPayments(KEY, { customerId: cust.entity.id });
check('M4 payments list shows three payments', payments.items.length === 3, payments.items.map((p) => [p.number, p.status]));
await expectError('SEC other organization cannot read the payment', () => client.getPayment(OTHER, pay.id), { reason: 'not_found' });
await expectError('SEC narrow key cannot record payments', () => client.createPayment(NARROW, { customerId: cust.entity.id, currency: 'ILS', amount: '1.00', receivedOn: '2026-10-08', method: 'CASH', allocations: [], previewToken: 'a'.repeat(64) }, key('payment')), { reason: 'missing_scopes' });

// ---------- M6: summaries, audit, attachments ----------
const orgSummary = await client.getOrganizationSummary(KEY);
for (const block of orgSummary.currencies) {
  check(`M6 org summary ${block.currency}: outstanding = overdue + dueToday + notYetDue`, minor(block.outstanding) === minor(block.overdue) + minor(block.dueToday) + minor(block.notYetDue), block);
  check(`M6 org summary ${block.currency}: outstanding equals the sum of its customers`, minor(block.outstanding) === sum(block.customers.map((c) => c.outstanding)), block.customers);
  const openRecv = (await client.listReceivables(KEY, { currency: block.currency, status: 'OPEN' })).items;
  check(`M6 org summary ${block.currency}: equals the open receivables' outstanding`, minor(block.outstanding) === sum(openRecv.map((r) => r.outstanding)), { summary: block.outstanding, receivables: openRecv.map((r) => r.outstanding) });
}
const ilsBlock = orgSummary.currencies.find((c) => c.currency === 'ILS')!;
const activePayments = (await client.listPayments(KEY, { status: 'POSTED' })).items.filter((p) => p.currency === 'ILS');
check('M6 org summary ILS unallocated equals the POSTED payments\' unallocated', minor(ilsBlock.unallocated) === sum(activePayments.map((p) => p.unallocated)), { summary: ilsBlock.unallocated, payments: activePayments.map((p) => p.unallocated) });
const onlyIls = await client.getOrganizationSummary(KEY, 'ILS');
check('M6 ?currency=ILS narrows to one block', onlyIls.currencies.length === 1 && onlyIls.currencies[0]!.currency === 'ILS');
const custSummary = await client.getCustomerSummary(KEY, cust.entity.id);
const acmeRow = ilsBlock.customers.find((c) => c.customerId === cust.entity.id)!;
check('M6 customer summary agrees with the organization row and has a status', custSummary.currencies.find((c) => c.currency === 'ILS')!.outstanding === acmeRow.outstanding && typeof acmeRow.status === 'string', { custSummary, acmeRow });
const projSummary = await client.getProjectSummary(KEY, proj.entity.id);
check('M6 fixed project summary: kind FIXED, agreed 12980, paid/credited/outstanding consistent', projSummary.kind === 'FIXED' && minor(projSummary.agreed!) === 1298000n && minor(projSummary.posted) - minor(projSummary.paid) - minor(projSummary.credited) === minor(projSummary.outstanding), projSummary);
const betaSummary = await client.getProjectSummary(KEY, betaProj.id);
check('M6 cancelled retainer project summary: kind RETAINER, status CANCELLED or OUTSTANDING/OVERDUE', betaSummary.kind === 'RETAINER' && ['CANCELLED', 'OUTSTANDING', 'OVERDUE'].includes(betaSummary.status), betaSummary);
const usdSummary = await client.getProjectSummary(KEY, projUsd.entity.id);
check('M6 project with no agreement: kind NONE, status NONE', usdSummary.kind === 'NONE' && usdSummary.status === 'NONE', usdSummary);
const audit = await client.listAudit(KEY, { entityType: 'payment', entityId: pay.id });
check('M6 audit for the payment lists recorded + reversed', audit.items.length >= 2 && audit.items.some((e) => e.action.includes('revers')) && audit.items.every((e) => e.requestId), audit.items.map((e) => e.action));
const allAudit = await client.listAudit(KEY, { limit: 5 });
check('M6 audit paginates with a cursor', allAudit.items.length === 5 && typeof allAudit.nextCursor === 'string');
await expectError('SEC narrow key cannot read audit', () => client.listAudit(NARROW), { reason: 'missing_scopes' });
await expectError('SEC other organization cannot read this project summary', () => client.getProjectSummary(OTHER, proj.entity.id), { reason: 'not_found' });
await expectError('M6 attachments without a bucket → attachments_not_configured (503)', () => client.createUpload(KEY, { kind: 'INVOICE', filename: 'inv.pdf', mimeType: 'application/pdf', sizeBytes: 1000, projectId: proj.entity.id }), { reason: 'attachments_not_configured' });
await expectError('M6 attachments list without a bucket → attachments_not_configured too (Malafat renders "not configured")', () => client.listAttachments(KEY, { projectId: proj.entity.id }), { reason: 'attachments_not_configured' });

// ---------- Reconcile + disconnect ----------
const recon = await fetch(`${BASE}/v1/retainers/reconcile`, { method: 'POST', headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' }, body: '{}' });
check('reconcile endpoint runs lazy posting idempotently (nothing new to post)', recon.status === 200 && (await recon.json()).chargesCreated === 0);
const disc = await client.disconnect(KEY);
check('M1 disconnect revokes the key', disc.apiKeyRevoked === true);
await expectError('M1 revoked key → 401', () => client.getIntegration(KEY), { reason: 'revoked' });

console.log('');
console.log(`e2e: ${passed} passed, ${failures.length} failed`);
for (const f of failures) console.log(`  ✗ ${f}`);
process.exit(failures.length === 0 ? 0 : 1);
