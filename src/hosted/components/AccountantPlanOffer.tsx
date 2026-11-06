/* eslint-disable react-refresh/only-export-components */
import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLanguage } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import type { AccountantPlanBilling, ClientBooksSummary, MeWithClientBooks } from '../api/client';
import { billingQuery, useStartAccountantCheckout } from '../data/billingQueries';
import { currencyOfCountry } from '../data/billingView';
import { countryOptions } from '../data/countries';
import { formatDecimal } from '../format/DecimalAmount';

/**
 * MUT-562 over MUT-565's contract (ADR-251): the Accountant plan's offer (SL6): the monthly price from GET /v1/billing
 * `accountantPlan.catalog` (in the chosen country's currency, both before one is picked), a country, and Subscribe →
 * Stripe Checkout (`plan: 'accountant'`), back to `returnPath`. Shown only when the server sends the plan's fields.
 */

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

export function AccountantPlanOffer({ returnPath }: { returnPath: string }) {
  const { t, language } = useLanguage();
  const ids = useId();
  const billing = useQuery(billingQuery);
  const checkout = useStartAccountantCheckout();
  const [country, setCountry] = useState('');
  const plan = (billing.data as { accountantPlan?: AccountantPlanBilling | null } | undefined)?.accountantPlan ?? null;
  const prices = plan
    ? (['ILS', 'USD'] as const)
        .filter((currency) => plan.catalog[currency] && (!country || currencyOfCountry(country) === currency))
        .map((currency) => formatDecimal(decimalOf(plan.catalog[currency]!.month), currency, language))
    : [];
  return (
    <div className="hp-plan-offer">
      <p className="hp-plan-offer-price">
        {t('hosted.accountantPlan.name')}
        {prices.length > 0 && <> · {t('hosted.accountantPlan.price', { price: prices.join(' / ') })}</>}
      </p>
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
      {checkout.isError && (
        <p className="hp-field-error" role="alert">
          {t('hosted.accountantPlan.failed')}
        </p>
      )}
      <Button variant="primary" className="hp-block" disabled={!country || checkout.isPending} aria-busy={checkout.isPending} onClick={() => checkout.mutate({ country, returnPath })}>
        {t('hosted.accountantPlan.subscribe')}
      </Button>
    </div>
  );
}
