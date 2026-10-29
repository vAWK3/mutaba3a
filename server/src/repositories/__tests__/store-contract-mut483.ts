import { describe, expect, it } from 'vitest';
import { composeCorrection, correctionWrite, type CorrectTermsBody } from '../../agreements/correct-terms-compose.js';
import { ledgerEntries, type LedgerEntry } from '../../statements/lines.js';
import { bucketize, unallocatedOf } from '../../summaries/compute.js';
import { MemoryLedgerStore } from '../memory.js';
import type { CreateInstallmentInput, CreatePaymentInput, LedgerStore, Organization } from '../ports.js';

/**
 * MUT-483 storage contract (ADR-227): `receivables.periodSources` reads the organization's rows a period figure needs,
 * in one snapshot: every receivable that isn't deleted, the credits on them, and every payment of any status, a payment
 * with no client included (D4); `?currency=` narrows all three; another organization never appears. Each row carries
 * exactly the ledger fields (a narrow select). Both stores give the same ledger lines for the same writes, and those
 * lines are each customer's statement lines plus the clientless payments'.
 */
const RECEIVABLE_FIELDS = ['id', 'customerId', 'currency', 'origin', 'postingDate', 'grossMinor', 'paidMinor', 'creditedMinor', 'deletedAt', 'createdAt'].sort();
const CREDIT_FIELDS = ['id', 'receivableId', 'amountMinor', 'effectiveDate', 'createdAt'].sort();
const PAYMENT_FIELDS = ['id', 'customerId', 'currency', 'amountMinor', 'receivedOn', 'status', 'reversalReason', 'reversedAt', 'updatedAt', 'createdAt'].sort();
const VIEW = { asOf: '2026-10-29', timezone: 'Asia/Jerusalem' };

export function describeLedgerStoreMut483Contract(name: string, makeStore: () => Promise<LedgerStore>): void {
  const unique = () => Math.random().toString(36).slice(2, 10);
  const at = (ms: number) => new Date(Date.UTC(2026, 9, 29, 9, 0, 0, ms));
  const inst = (position: number, amount: bigint, trigger: 'MANUAL' | 'IMMEDIATE', label: string): CreateInstallmentInput => ({ position, label, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, vatTreatment: 'EXEMPT', rateBasisPoints: 0, triggerType: trigger, triggerDate: null, paymentTerms: null, dueDateOverride: null });

  /**
   * One customer with an ILS and a USD matter: an ILS fee of ₪600 + ₪400 (the first posted 2026-10-01), a USD fee
   * posted 2026-10-02, a ₪50 credit, a kept payment, a reversed one, an Owed, a voided Owed, a capture with no client,
   * an undone capture and a USD payment. Another organization has its own rows.
   */
  async function firm(store: LedgerStore) {
    const o: Organization = await store.organizations.create({ name: 'Firm', slug: `firm-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const person = (await store.users.create({ email: `n-${unique()}@firm.ps`, displayName: 'Nour', passwordHash: null, locale: 'en', personal: { name: 'Personal', slug: `p-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' }, at: at(0) })).user.id;
    const c = await store.customers.create({ organizationId: o.id, name: 'Haddad', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(1));
    const ils = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Case', currency: 'ILS' }, at(2));
    const usd = await store.projects.create({ organizationId: o.id, customerId: c.id, name: 'Deal', currency: 'USD' }, at(3));
    const agreement = (projectId: string, currency: string, installments: CreateInstallmentInput[]) => {
      const amount = installments.reduce((s, i) => s + i.amountMinor, 0n);
      return store.agreements.create({ organizationId: o.id, projectId, customerId: c.id, type: 'FIXED', currency, pricingBasis: 'VAT_INCLUSIVE', vatTreatment: 'EXEMPT', vatRateBasisPoints: 0, amountMinor: amount, netMinor: amount, vatMinor: 0n, grossMinor: amount, agreementDate: '2026-10-01', description: null, paymentTerms: 'EOM', startMonth: null, billingDay: null, endMonth: null, installments }, at(4));
    };
    const fee = await agreement(ils.id, 'ILS', [inst(1, 60_000n, 'IMMEDIATE', 'On signing'), inst(2, 40_000n, 'MANUAL', 'On judgment')]);
    const signing = (await store.agreements.postInstallment(o.id, fee.installments[0]!.id, { postingDate: '2026-10-01', dueDate: '2026-10-31', at: at(5) }))!.receivable;
    const dollars = await agreement(usd.id, 'USD', [inst(1, 7_000n, 'IMMEDIATE', 'On signing')]);
    const usdCharge = (await store.agreements.postInstallment(o.id, dollars.installments[0]!.id, { postingDate: '2026-10-02', dueDate: '2026-10-31', at: at(6) }))!.receivable;
    const credit = (await store.receivables.credit(o.id, signing.id, { amountMinor: 5_000n, netMinor: 5_000n, vatMinor: 0n, reason: 'Goodwill', effectiveDate: '2026-10-03', requestId: null }, at(7)))!.credit;
    const payment = (amountMinor: bigint, allocations: Array<{ receivableId: string; amountMinor: bigint }>, currency = 'ILS', receivedOn = '2026-10-05'): CreatePaymentInput => ({ organizationId: o.id, customerId: c.id, projectId: null, currency, amountMinor, receivedOn, method: 'BANK', reference: null, receiptNumber: null, notes: null, replacesPaymentId: null, requestId: null, createdByUserId: null, origin: 'INTEGRATION', captureSource: null, allocations });
    const kept = (await store.payments.create(payment(30_000n, [{ receivableId: signing.id, amountMinor: 30_000n }]), at(8))).payment;
    const bounced = (await store.payments.create(payment(2_000n, [{ receivableId: signing.id, amountMinor: 2_000n }], 'ILS', '2026-10-06'), at(9))).payment;
    await store.payments.reverse(o.id, bounced.id, 'Bounced', at(10));
    const owedInput = (title: string, grossMinor: bigint) => ({ organizationId: o.id, customerId: c.id, projectId: null, currency: 'ILS', netMinor: grossMinor, vatMinor: 0n, grossMinor, vatTreatment: 'OUT_OF_SCOPE' as const, vatRateBasisPoints: 0, title, dueDate: '2026-10-31', postingDate: '2026-10-07', postedAt: at(11), createdByUserId: person, requestId: null });
    const owed = await store.receivables.createAdjustment(owedInput('Work', 1_500n), at(11));
    const voided = await store.receivables.createAdjustment(owedInput('Mistake', 900n), at(12));
    await store.receivables.softDeleteAdjustment(o.id, voided.id, at(13));
    const capture = (customerId: string | null, amountMinor: bigint, ms: number) => store.payments.capture({ organizationId: o.id, customerId, projectId: null, currency: 'ILS', amountMinor, receivedOn: '2026-10-08', method: 'CASH', notes: null, requestId: null, createdByUserId: person, captureSource: null }, at(ms));
    const clientless = (await capture(null, 700n, 14)).payment;
    const undone = (await capture(c.id, 300n, 15)).payment;
    await store.payments.undoCapture(o.id, undone.id, person, at(16));
    const usdPayment = (await store.payments.create(payment(1_000n, [], 'USD'), at(17))).payment;

    const stranger = await store.organizations.create({ name: 'Other', slug: `other-${unique()}`, defaultCurrency: 'ILS', timezone: 'Asia/Jerusalem' });
    const theirs = await store.customers.create({ organizationId: stranger.id, name: 'Not ours', email: null, phone: null, notes: null, vatTreatment: 'EXEMPT' }, at(18));
    await store.payments.create({ ...payment(9_999n, []), organizationId: stranger.id, customerId: theirs.id }, at(19));

    return { o, c, person, fee, signing, usdCharge, credit, kept, bounced, owed, voided, clientless, undone, usdPayment, payment };
  }

  /** A ledger line without its source row and with ids replaced by what they name, to compare across stores. */
  const shape = (entries: readonly LedgerEntry[], names: ReadonlyMap<string, string>) =>
    entries.map((e) => [names.get(e.id.replace(/:reversal$/, ''))! + (e.id.endsWith(':reversal') ? ':reversal' : ''), e.kind, e.date, e.currency, e.customerId === null ? null : 'customer', e.debitMinor, e.creditMinor]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  describe(`${name} LedgerStore MUT-483 contract`, () => {
    it('periodSources reads every live receivable, their credits and every payment of any status, clientless included; never another organization', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const all = await store.receivables.periodSources(f.o.id, null);
      expect(all.receivables.map((r) => r.id).sort()).toEqual([f.signing.id, f.usdCharge.id, f.owed.id].sort());
      expect(all.credits.map((x) => [x.id, x.receivableId, x.amountMinor])).toEqual([[f.credit.id, f.signing.id, 5_000n]]);
      expect(all.payments.map((p) => [p.id, p.status, p.customerId]).sort()).toEqual(
        [
          [f.kept.id, 'POSTED', f.c.id],
          [f.bounced.id, 'REVERSED', f.c.id],
          [f.clientless.id, 'POSTED', null],
          [f.undone.id, 'REVERSED', f.c.id],
          [f.usdPayment.id, 'POSTED', f.c.id],
        ].sort(),
      );
      // A narrow read: exactly the fields a ledger line reads.
      expect(Object.keys(all.receivables[0]!).sort()).toEqual(RECEIVABLE_FIELDS);
      expect(Object.keys(all.credits[0]!).sort()).toEqual(CREDIT_FIELDS);
      expect(Object.keys(all.payments[0]!).sort()).toEqual(PAYMENT_FIELDS);
    });

    it('?currency narrows receivables, credits and payments to that currency', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const usd = await store.receivables.periodSources(f.o.id, 'USD');
      expect(usd.receivables.map((r) => r.id)).toEqual([f.usdCharge.id]);
      expect(usd.credits).toEqual([]);
      expect(usd.payments.map((p) => p.id)).toEqual([f.usdPayment.id]);
      const ils = await store.receivables.periodSources(f.o.id, 'ILS');
      expect(ils.receivables.every((r) => r.currency === 'ILS') && ils.payments.every((p) => p.currency === 'ILS')).toBe(true);
      expect(ils.credits).toHaveLength(1);
      expect(await store.receivables.periodSources(f.o.id, 'JOD')).toEqual({ receivables: [], credits: [], payments: [] });
    });

    it('its lines are every customer\'s statement lines plus the clientless payments\', and the same in the memory store', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const entries = ledgerEntries(await store.receivables.periodSources(f.o.id, null), VIEW);
      const fromStatements = [
        ...ledgerEntries(await store.receivables.statementSources(f.o.id, f.c.id, 'ILS'), VIEW),
        ...ledgerEntries(await store.receivables.statementSources(f.o.id, f.c.id, 'USD'), VIEW),
      ];
      const clientless = entries.filter((e) => e.customerId === null);
      expect(clientless.map((e) => [e.kind, e.id])).toEqual([['PAYMENT', f.clientless.id]]);
      const key = (e: LedgerEntry) => `${e.kind}:${e.id}:${e.date}:${e.debitMinor}:${e.creditMinor}`;
      expect(entries.map(key).sort()).toEqual([...fromStatements, ...clientless].map(key).sort());

      const memory = new MemoryLedgerStore();
      const m = await firm(memory);
      const names = (x: typeof f) => new Map(Object.entries({ signing: x.signing.id, usdCharge: x.usdCharge.id, credit: x.credit.id, kept: x.kept.id, bounced: x.bounced.id, owed: x.owed.id, clientless: x.clientless.id, usdPayment: x.usdPayment.id }).map(([k, v]) => [v, k]));
      const reference = ledgerEntries(await memory.receivables.periodSources(m.o.id, null), VIEW);
      expect(shape(entries, names(f))).toEqual(shape(reference, names(m)));
    });

    it('a MUT-444 correction\'s released allocation makes no line: the payment stays one line, the old charge is credited on its date and reposted', async () => {
      const store = await makeStore();
      const f = await firm(store);
      const before = ledgerEntries(await store.receivables.periodSources(f.o.id, 'ILS'), VIEW);
      const body: CorrectTermsBody = { amount: '1200.00', pricingBasis: 'VAT_INCLUSIVE', installments: [{ label: 'On signing', amount: '800.00', trigger: { type: 'IMMEDIATE' } }, { label: 'On judgment', amount: '400.00', trigger: { type: 'MANUAL' } }] };
      const agreement = (await store.agreements.getById(f.o.id, f.fee.agreement.id))!;
      const composed = await composeCorrection(store, f.o, agreement, body, VIEW.asOf);
      expect((await store.agreements.correct(f.o.id, agreement.id, correctionWrite(composed, agreement, { reasonCode: 'ENTERED_BY_MISTAKE', note: null }, VIEW.asOf, 'req-483'), at(20))).kind).toBe('updated');
      const after = ledgerEntries(await store.receivables.periodSources(f.o.id, 'ILS'), VIEW);
      const payments = (es: readonly LedgerEntry[]) => es.filter((e) => e.kind === 'PAYMENT' || e.kind === 'PAYMENT_REVERSAL').map((e) => [e.id, e.date, e.creditMinor, e.debitMinor]).sort();
      expect(payments(after)).toEqual(payments(before));
      const added = after.filter((e) => !before.some((b) => b.id === e.id)).map((e) => [e.kind, e.date, e.debitMinor, e.creditMinor]).sort();
      // The ₪600 charge, less its ₪50 credit, is credited ₪550 on its own date; the new ₪800 posts on that date.
      expect(added).toEqual([['CHARGE', '2026-10-01', 80_000n, 0n], ['CREDIT', '2026-10-01', 0n, 55_000n]].sort());

      // The balance (Σ lines) is the summary's outstanding − unallocated, released rows notwithstanding (ADR-227 §3.2).
      const receivables = (await store.receivables.list(f.o.id, { currency: 'ILS', status: 'OPEN' }, { limit: 100, cursor: null })).items;
      const posted = (await store.payments.list(f.o.id, { status: 'POSTED' }, { limit: 100, cursor: null })).items.filter((p) => p.currency === 'ILS');
      const balance = after.reduce((s, e) => s + e.debitMinor - e.creditMinor, 0n);
      expect(balance).toBe(bucketize(receivables, VIEW.asOf).outstanding - unallocatedOf(posted).amount);
    });
  });
}
