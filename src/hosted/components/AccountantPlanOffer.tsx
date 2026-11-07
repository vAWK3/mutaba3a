/* eslint-disable react-refresh/only-export-components */
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { ApiError, apiErrorReason, type AccountantPlanBilling, type ClientBooksSummary, type MeWithClientBooks } from '../api/client';
import { billingQuery, useStartAccountantCheckout } from '../data/billingQueries';
import { checkoutRouteOf, currencyOfCountry } from '../data/billingView';
import { Banner, BuyerChoice } from './billingParts';
import { countryName, countryOptions } from '../data/countries';
import { formatDecimal } from '../format/DecimalAmount';
import { countPublicPage, trackPortal } from '../analytics/portalAnalytics';

/**
 * MUT-562 over MUT-565's contract (ADR-251): the Accountant plan's offer (SL6): the monthly price from GET /v1/billing
 * `accountantPlan.catalog` (in the chosen country's currency, both before one is picked), a country, who is buying (the
 * Subscribe step's own choice and rule, `BuyerChoice` + `checkoutRouteOf`), and Subscribe → Stripe Checkout
 * (`plan: 'accountant'`), back to `returnPath`. Subscribe stays off until a price shows. Shown only when the server sends the plan's fields.
 *
 * Counts (contract 2.8.0): `accountant_plan_offer_shown {place}` once per view, and `billing_checkout_started
 * {plan: 'accountant'}` when Checkout opens. `invite` is the public accept page, outside the signed-in shell where the
 * consent is read, so it counts the public pages' cookieless way (ADR-250, as `accountant_accepted`); the desk's places
 * use the consented tracker.
 */
export type PlanOfferPlace = 'invite' | 'client_books';

function countOffer(place: PlanOfferPlace): void {
  if (place === 'invite') countPublicPage({ event: 'accountant_plan_offer_shown', properties: { place } });
  else void trackPortal('accountant_plan_offer_shown', { place });
}

function countCheckout(place: PlanOfferPlace, currency: 'ILS' | 'USD'): void {
  const properties = { plan: 'accountant', interval: 'month', currency } as const;
  if (place === 'invite') countPublicPage({ event: 'billing_checkout_started', properties });
  else void trackPortal('billing_checkout_started', properties);
}

/** The plan's state covers client books now (paid or retrying a payment). */
export function planCovers(summary: Pick<ClientBooksSummary, 'plan'> | undefined): boolean {
  return summary?.plan.state === 'ACTIVE' || summary?.plan.state === 'GRACE';
}

/** MUT-565's card rule: a cap, at it, and no plan covering. */
export function atFreeCap(summary: ClientBooksSummary | undefined): boolean {
  return summary !== undefined && summary.cap !== null && summary.count >= summary.cap && !planCovers(summary);
}

export function clientBooksOf(me: unknown): ClientBooksSummary | undefined {
  return (me as MeWithClientBooks | undefined)?.clientBooks;
}

/** A minor-unit price as a decimal string, two places (ILS and USD). */
const decimalOf = (minor: number) => `${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;

/** What a refused Accountant Checkout tells the person: the Subscribe step's own copy where it has one. */
function checkoutRefusal(error: unknown): 'contactUs' | 'failed' {
  return error instanceof ApiError && apiErrorReason(error) === 'COUNTRY_NEEDS_BUSINESS' ? 'contactUs' : 'failed';
}

export function AccountantPlanOffer({ returnPath, place }: { returnPath: string; place: PlanOfferPlace }) {
  const { t, language } = useLanguage();
  const ids = useId();
  const billing = useQuery(billingQuery);
  const checkout = useStartAccountantCheckout();
  const [country, setCountry] = useState('');
  const [buyer, setBuyer] = useState<'person' | 'business'>('person');
  // Once per view: a re-render (a price arriving, a country picked) is the same view
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    countOffer(place);
  }, [place]);
  const plan = (billing.data as { accountantPlan?: AccountantPlanBilling | null } | undefined)?.accountantPlan ?? null;
  const prices = plan
    ? (['ILS', 'USD'] as const)
        .filter((currency) => plan.catalog[currency] && (!country || currencyOfCountry(country) === currency))
        .map((currency) => formatDecimal(decimalOf(plan.catalog[currency]!.month), currency, language))
    : [];
  // The Subscribe step's rule (checkoutRouteOf): a person in a country we can't sell to individuals is asked to write
  const route = billing.data?.countries && country ? checkoutRouteOf(country, buyer, billing.data.countries) : null;
  const refusal = checkout.isError ? checkoutRefusal(checkout.error) : null;
  const contactUs = route === 'contact-us' || refusal === 'contactUs';
  // Subscribe waits for a price on screen (the catalog) and a country this buyer can pay from
  const canSubscribe = prices.length > 0 && country !== '' && route !== null && !contactUs && !checkout.isPending;
  return (
    <div className="hp-plan-offer">
      <p className="hp-plan-offer-price">
        {t('hosted.accountantPlan.name')}
        {prices.length > 0 && <> · {t('hosted.accountantPlan.price', { price: prices.join(' / ') })}</>}
      </p>
      {billing.isError && (
        <p className="hp-field-error" role="alert">
          {t('hosted.accountantPlan.priceFailed')}{' '}
          <button type="button" className="hp-link-button press" onClick={() => void billing.refetch()}>
            {t('hosted.accountantPlan.retry')}
          </button>
        </p>
      )}
      <div className="hp-field">
        <label htmlFor={`${ids}-country`}>{t('hosted.accountantPlan.country')}</label>
        <Select id={`${ids}-country`} value={country} onChange={(e) => setCountry(e.target.value)}>
          <option value="">{t('hosted.accountantPlan.pickCountry')}</option>
          {countryOptions(language).map((option) => (
            <option key={option.code} value={option.code}>
              {option.name}
            </option>
          ))}
        </Select>
      </div>
      <BuyerChoice idPrefix={ids} value={buyer} onChange={setBuyer} consumerEverywhere={billing.data?.countries.consumerEverywhere === true} />
      {contactUs && country && <Banner tone="info" text={t('hosted.billing.subscribe.contactUs', { country: countryName(country, language) })} />}
      {refusal === 'failed' && (
        <p className="hp-field-error" role="alert">
          {t('hosted.accountantPlan.failed')}
        </p>
      )}
      <Button variant="primary" className="hp-block" disabled={!canSubscribe} aria-busy={checkout.isPending} onClick={() => checkout.mutate({ country, buyer, returnPath }, { onSuccess: () => countCheckout(place, currencyOfCountry(country)) })}>
        {t('hosted.accountantPlan.subscribe')}
      </Button>
    </div>
  );
}
