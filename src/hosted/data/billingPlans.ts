import { useLanguage, useT } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { Language } from '../../lib/i18n/types';
import type { BillingAddress, BillingOverview, BillingPlan } from '../api/client';
import { formatMinor } from '../components/billingText';
import { countryName } from './countries';

/**
 * MUT-702 Part B (ADR-286, wireframes v3): the plans on sale and the billing address, as the Subscribe step and the
 * onboarding Solo trial read them. Prices and limits come from GET /v1/billing `plans`; nothing here names an amount.
 */

export type { BillingAddress, BillingPlan };
export type PlanName = BillingPlan['plan'];

export interface AddressDraft {
  countryText: string;
  /** The matched country, or null while the text names none. */
  country: string | null;
  line1: string;
  city: string;
  postalCode: string;
}

export const EMPTY_ADDRESS: AddressDraft = { countryText: '', country: null, line1: '', city: '', postalCode: '' };

const ISRAEL = 'IL';

/** The saved address from GET /v1/billing (a nullable union, generated as `unknown`). */
export function savedAddressOf(billing: BillingOverview | undefined): BillingAddress | null {
  return (billing?.billingAddress ?? null) as BillingAddress | null;
}

/** A saved address, ready to edit, its country named in the reader's language. */
export function draftOf(address: BillingAddress | null, language: Language): AddressDraft {
  if (!address) return EMPTY_ADDRESS;
  return { countryText: countryName(address.country, language), country: address.country, line1: address.line1, city: address.city, postalCode: address.postalCode };
}

/** The address to send, or null until every field is filled and the country matched. */
export function addressOf(draft: AddressDraft): BillingAddress | null {
  const [line1, city, postalCode] = [draft.line1.trim(), draft.city.trim(), draft.postalCode.trim()];
  return draft.country && line1 && city && postalCode ? { country: draft.country, line1, city, postalCode } : null;
}

/** The plans on sale less the person's current one (the plan they're on isn't offered), each sellable somewhere. */
export function plansOnOffer(billing: BillingOverview | undefined): BillingPlan[] {
  return (billing?.plans ?? []).filter((p) => p.plan !== billing?.currentPlan && (p.catalog.ILS !== null || p.catalog.USD !== null));
}

/** A plan's monthly price: both currencies before a country is known; after, its currency, with "+ VAT" in Israel. */
export function monthlyPriceOf(plan: BillingPlan, country: string | null, language: Language, t: (key: string, vars?: Record<string, string>) => string): string | null {
  if (!country) {
    const { ILS, USD } = plan.catalog;
    if (ILS && USD) return `${formatMinor(ILS.month, 'ILS', language)} ${t('hosted.billing.plan.or')} ${formatMinor(USD.month, 'USD', language)}`;
    return ILS ? formatMinor(ILS.month, 'ILS', language) : USD ? formatMinor(USD.month, 'USD', language) : null;
  }
  const currency = country === ISRAEL ? 'ILS' : 'USD';
  const pair = plan.catalog[currency];
  if (!pair) return null;
  const price = formatMinor(pair.month, currency, language);
  return country === ISRAEL ? `${price} ${t('hosted.billing.plans.plusVat')}` : price;
}

/** The plan row's price line ("₪39.00 or $12.00 a month", "₪89.00 + VAT a month"). */
export function usePlanPrice(): (plan: BillingPlan, country: string | null) => string | null {
  const t = useT();
  const { language } = useLanguage();
  return (plan, country) => {
    const price = monthlyPriceOf(plan, country, language, t);
    return price ? t('hosted.billing.plans.perMonth', { price }) : null;
  };
}

/** Basel Q5 (2026-11-26): one short limits line under each plan. */
export function useLimitsLine(): (limits: BillingPlan['limits']) => string {
  const t = useT();
  const tp = useTp();
  return (limits) =>
    t('hosted.billing.plans.limits', {
      businesses: tp('hosted.billing.plans.businesses', limits.businesses),
      documents: tp('hosted.billing.plans.documents', limits.documentsPerMonth),
      scans: tp('hosted.billing.plans.scans', limits.scansPerMonth),
    });
}
