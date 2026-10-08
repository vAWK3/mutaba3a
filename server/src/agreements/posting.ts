import { dueDateFor, type IsoDate } from '../dates.js';
import type { AgreementRecord, LedgerStore, Organization } from '../repositories/ports.js';
import { chargeDate, chargeMonths } from '../retainers/schedule.js';
import { computeVat } from '../vat.js';
import { installmentDueDate, postingDateFor } from './compose.js';

/**
 * Lazy posting (brief §2.2): installments with a DATE trigger whose date has
 * arrived become receivables, and recurring retainers get one charge per
 * service month whose charge date has arrived. Runs at the start of every
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
      await audit(store, organization.id, actor, 'installment.posted', 'installment', installment.id, { agreementId: agreement.id, receivableId: result.receivable.id, trigger: 'DATE' });
    }
  }

  for (const retainer of await store.agreements.listRetainers(organization.id)) {
    chargesCreated += await generateCharges(store, organization, retainer, today, now, actor);
  }

  return { installmentsPosted, chargesCreated, today };
}

export async function generateCharges(store: LedgerStore, organization: Organization, retainer: AgreementRecord, today: IsoDate, now: Date, actor: PostingActor): Promise<number> {
  if (!retainer.startMonth || !retainer.billingDay) return 0;
  const months = chargeMonths(
    { startMonth: retainer.startMonth, billingDay: retainer.billingDay, endMonth: retainer.endMonth ?? undefined, cancelEffectiveMonth: retainer.cancelEffectiveMonth ?? undefined, finalMonth: retainer.finalMonth ?? undefined },
    today,
  );
  const existing = new Set((await store.agreements.listCharges(organization.id, retainer.id)).map((c) => c.serviceMonth));
  let created = 0;
  for (const month of months) {
    if (existing.has(month)) continue;
    const date = chargeDate(month, retainer.billingDay);
    const vat = computeVat({ amountMinor: retainer.amountMinor, pricingBasis: retainer.pricingBasis, treatment: retainer.vatTreatment, rateBasisPoints: retainer.vatRateBasisPoints });
    const result = await store.agreements.createPostedCharge(
      {
        organizationId: organization.id,
        agreementId: retainer.id,
        customerId: retainer.customerId,
        projectId: retainer.projectId,
        currency: retainer.currency,
        serviceMonth: month,
        chargeDate: date,
        amountMinor: retainer.amountMinor,
        netMinor: vat.netMinor,
        vatMinor: vat.vatMinor,
        grossMinor: vat.grossMinor,
        vatTreatment: retainer.vatTreatment,
        rateBasisPoints: vat.rateBasisPoints,
        dueDate: dueDateFor(date, retainer.paymentTerms),
      },
      now,
    );
    if (result.created) {
      created += 1;
      await audit(store, organization.id, actor, 'retainer.charged', 'retainer_charge', result.charge.id, { agreementId: retainer.id, serviceMonth: month, receivableId: result.receivable.id });
    }
  }
  return created;
}

async function audit(store: LedgerStore, organizationId: string, actor: PostingActor, action: string, entityType: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
  await store.audit.append({ organizationId, actorType: actor.actorType, actorId: actor.actorId, action, entityType, entityId, metadata, requestId: actor.requestId });
}
