import { dueDateFor, type IsoDate, type IsoMonth } from '../dates.js';
import type { AgreementRecord, LedgerStore, Organization } from '../repositories/ports.js';
import { chargeDate, chargeMonths } from '../retainers/schedule.js';
import { prorate } from '../retainers/proration.js';
import { effectiveEndMonth, termsFor, termsTimeline } from '../retainers/terms.js';
import { computeVat } from '../vat.js';
import { installmentDueDate, postingDateFor } from './compose.js';

/**
 * Lazy posting (brief §2.2): installments with a DATE trigger whose date has
 * arrived become receivables (and, since M8 D16, IMMEDIATE installments a
 * crash left unposted between create and post), and recurring retainers get
 * one charge per service month whose charge date has arrived. Runs at the start of every
 * read that renders agreements or receivables and on `POST /v1/retainers/
 * reconcile`; the store makes both operations idempotent, so running it
 * twice (or concurrently) can never double-post.
 */
export interface PostingSummary {
  installmentsPosted: number;
  chargesCreated: number;
  today: IsoDate;
}

export interface PostingActor {
  actorType: 'API_KEY' | 'SYSTEM';
  actorId: string | null;
  requestId: string | null;
}

export async function postDueItems(store: LedgerStore, organization: Organization, today: IsoDate, now: Date, actor: PostingActor): Promise<PostingSummary> {
  let installmentsPosted = 0;
  let chargesCreated = 0;

  for (const installment of await store.agreements.listUnpostedDue(organization.id, today)) {
    const agreement = await store.agreements.getById(organization.id, installment.agreementId);
    if (!agreement) continue;
    const postingDate = postingDateFor(installment, agreement.agreementDate, today);
    const result = await store.agreements.postInstallment(organization.id, installment.id, { postingDate, dueDate: installmentDueDate(installment, agreement, postingDate), at: now });
    if (result?.created) {
      installmentsPosted += 1;
      await audit(store, organization.id, actor, 'installment.posted', 'installment', installment.id, { agreementId: agreement.id, receivableId: result.receivable.id, trigger: installment.triggerType });
    }
  }

  for (const retainer of await store.agreements.listRetainers(organization.id)) {
    chargesCreated += await generateCharges(store, organization, retainer, today, now, actor);
  }

  return { installmentsPosted, chargesCreated, today };
}

export async function generateCharges(store: LedgerStore, organization: Organization, retainer: AgreementRecord, today: IsoDate, now: Date, actor: PostingActor): Promise<number> {
  if (!retainer.startMonth || !retainer.billingDay) return 0;
  const timeline = termsTimeline(retainer, await store.agreements.listVersions(organization.id, retainer.id));
  const months = chargeMonthsAcrossVersions(retainer, timeline, today);
  const existing = new Set((await store.agreements.listCharges(organization.id, retainer.id)).map((c) => c.serviceMonth));
  let created = 0;
  for (const month of months) {
    if (existing.has(month)) continue;
    const terms = termsFor(timeline, month);
    const date = chargeDate(month, terms.billingDay);
    // The cancellation month under PRORATE charges the days up to and including the cancellation date (M5 decision 4).
    const amountMinor = retainer.finalMonth === 'PRORATE' && retainer.cancelEffectiveDate && month === retainer.cancelEffectiveMonth ? prorate({ amountMinor: terms.monthlyAmountMinor, effectiveDate: retainer.cancelEffectiveDate }).amountMinor : terms.monthlyAmountMinor;
    const vat = computeVat({ amountMinor, pricingBasis: terms.pricingBasis, treatment: terms.vatTreatment, rateBasisPoints: terms.rateBasisPoints });
    const result = await store.agreements.createPostedCharge(
      {
        organizationId: organization.id,
        agreementId: retainer.id,
        customerId: retainer.customerId,
        projectId: retainer.projectId,
        currency: retainer.currency,
        serviceMonth: month,
        chargeDate: date,
        amountMinor,
        netMinor: vat.netMinor,
        vatMinor: vat.vatMinor,
        grossMinor: vat.grossMinor,
        vatTreatment: terms.vatTreatment,
        rateBasisPoints: vat.rateBasisPoints,
        dueDate: dueDateFor(date, terms.paymentTerms),
        version: terms.version,
      },
      now,
    );
    if (result.created) {
      created += 1;
      await audit(store, organization.id, actor, 'retainer.charged', 'retainer_charge', result.charge.id, { agreementId: retainer.id, serviceMonth: month, receivableId: result.receivable.id, version: terms.version, ...(amountMinor !== terms.monthlyAmountMinor ? { prorated: true } : {}) });
    }
  }
  return created;
}

/**
 * Service months chargeable today when the billing day may differ per version:
 * each month is tested against the billing day of the terms in force for it,
 * and the end month is the latest version's.
 */
export function chargeMonthsAcrossVersions(retainer: AgreementRecord, timeline: ReturnType<typeof termsTimeline>, today: IsoDate): IsoMonth[] {
  if (!retainer.startMonth) return [];
  const endMonth = effectiveEndMonth(timeline) ?? undefined;
  const months: IsoMonth[] = [];
  for (const month of chargeMonths({ startMonth: retainer.startMonth, billingDay: 1, endMonth, cancelEffectiveMonth: retainer.cancelEffectiveMonth ?? undefined, finalMonth: retainer.finalMonth ?? undefined }, today)) {
    const terms = termsFor(timeline, month);
    if (chargeDate(month, terms.billingDay) <= today) months.push(month);
  }
  return months;
}

async function audit(store: LedgerStore, organizationId: string, actor: PostingActor, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await store.audit.append({ organizationId, actorType: actor.actorType, actorId: actor.actorId, action, entityType, entityId, metadata, requestId: actor.requestId });
}
