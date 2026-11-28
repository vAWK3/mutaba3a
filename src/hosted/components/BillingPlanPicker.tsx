import { EntityTypeahead } from '../../components/ui/EntityTypeahead';
import { Input } from '../../components/ui/Input';
import { useLanguage, useT } from '../../lib/i18n/core';
import { countrySuggestions, matchCountry } from '../data/countries';
import { useLimitsLine, usePlanPrice, type AddressDraft, type BillingPlan, type PlanName } from '../data/billingPlans';
import { RadioCards } from './RadioCards';

/**
 * MUT-702 Part B (ADR-288, wireframes v3): the Subscribe step's plan row and the billing address, shared with the
 * onboarding Solo trial's address step. The address is free text; the country is typed and must match a country (it
 * sets the currency and the VAT). The helpers are in data/billingPlans.ts.
 */
export function PlanRow({
  idPrefix,
  plans,
  value,
  country,
  onChange,
  offerNote,
}: {
  idPrefix: string;
  plans: BillingPlan[];
  value: PlanName;
  country: string | null;
  onChange: (plan: PlanName) => void;
  /** MUT-703's seam (offers plan §11.2): a first-year line under a plan's limits line; none today. */
  offerNote?: (plan: BillingPlan) => string | null;
}) {
  const t = useT();
  const price = usePlanPrice();
  const limits = useLimitsLine();
  return (
    <div className="hp-billing-field" data-testid="billing-plan-row">
      <span id={`${idPrefix}-plan`} className="input-label">
        {t('hosted.billing.plans.label')}
      </span>
      <RadioCards
        name={`${idPrefix}-plan`}
        labelledBy={`${idPrefix}-plan`}
        value={value}
        onChange={onChange}
        options={plans.map((plan) => {
          const line = price(plan, country);
          // MUT-705: Firm says its staff seats are coming (MUT-305/306).
          const base = plan.plan === 'firm' ? `${limits(plan.limits)} · ${t('hosted.billing.plans.staffSoon')}` : limits(plan.limits);
          const offer = offerNote?.(plan) ?? null;
          const note = offer ? `${base} · ${offer}` : base;
          return { value: plan.plan, label: line ? `${t(`hosted.plan.name.${plan.plan}`)} · ${line}` : t(`hosted.plan.name.${plan.plan}`), note };
        })}
      />
    </div>
  );
}

export function BillingAddressFields({ idPrefix, draft, onChange }: { idPrefix: string; draft: AddressDraft; onChange: (draft: AddressDraft) => void }) {
  const t = useT();
  const { language } = useLanguage();
  const suggestions = draft.country ? [] : countrySuggestions(draft.countryText, language);
  const noMatch = draft.countryText.trim() !== '' && draft.country === null && suggestions.length === 0;
  const set = (field: 'line1' | 'city' | 'postalCode') => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [field]: e.target.value });
  return (
    <fieldset className="hp-billing-field hp-billing-address" data-testid="billing-address">
      <legend className="input-label">{t('hosted.billing.address.title')}</legend>
      <div className="input-wrapper">
        <label htmlFor={`${idPrefix}-country`} className="input-label">
          {t('hosted.billing.address.country')}
        </label>
        <EntityTypeahead
          id={`${idPrefix}-country`}
          inputValue={draft.countryText}
          onInputChange={(text) => onChange({ ...draft, countryText: text, country: matchCountry(text) })}
          options={suggestions.map((o) => ({ id: o.code, label: o.name, isNew: false }))}
          onSelect={(option) => onChange({ ...draft, countryText: option.label, country: option.id })}
          {...(noMatch ? { describedBy: `${idPrefix}-country-none` } : {})}
        />
        {noMatch && (
          <p id={`${idPrefix}-country-none`} className="input-error-message">
            {t('hosted.billing.address.noMatch')}
          </p>
        )}
      </div>
      <Input id={`${idPrefix}-line1`} label={t('hosted.billing.address.line1')} value={draft.line1} onChange={set('line1')} autoComplete="address-line1" />
      <div className="hp-billing-address-row">
        <Input id={`${idPrefix}-city`} label={t('hosted.billing.address.city')} value={draft.city} onChange={set('city')} autoComplete="address-level2" />
        <Input id={`${idPrefix}-postal`} label={t('hosted.billing.address.postalCode')} value={draft.postalCode} onChange={set('postalCode')} autoComplete="postal-code" />
      </div>
    </fieldset>
  );
}
