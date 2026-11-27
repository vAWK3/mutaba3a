import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import type { Schemas } from '../../api/client';
import { mapDeskError, type DeskBanner } from '../../components/accountantErrors';
import { ProfileBanner } from '../../components/ProfileBanner';
import { ACCOUNTANT_CUSTOMERS_KEY, useCustomerCheckout } from '../../data/accountantCustomersQueries';
import { markActivating } from '../../data/activating';
import { leaveFor } from '../../data/billingQueries';
import { countryOptions } from '../../data/countries';

/**
 * MUT-768 (accountant channel, DR-3, B13): the Take card pane of the Customer drawer. What the activation needs and
 * the create route did not take: the plan (the ones on sale), how often it is paid, what kind of buyer, the billing
 * country and address. "Continue to Stripe" opens Checkout in this tab; Stripe sends the accountant back to the desk,
 * where the row reads Activating until the list says paid (data/activating.ts).
 */
const FORM_ID = 'hosted-desk-take-card-form';
const DESK_PATH = '/client-books';

const schema = z.object({
  plan: z.enum(['solo', 'business', 'firm']),
  interval: z.enum(['month', 'year']),
  buyer: z.enum(['business', 'person']),
  country: z.string().regex(/^[A-Z]{2}$/, 'hosted.desk.required'),
  line1: z.string().trim().min(1, 'hosted.desk.required'),
  city: z.string().trim().min(1, 'hosted.desk.required'),
  postalCode: z.string().trim().min(1, 'hosted.desk.required'),
});
type Values = z.infer<typeof schema>;

export function TakeCardPane({ userId, onBack }: { userId: string; onBack: () => void }) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const checkout = useCustomerCheckout();
  const [banner, setBanner] = useState<DeskBanner | null>(null);
  const form = useForm<Values>({ resolver: zodResolver(schema) as never, defaultValues: { plan: 'solo', interval: 'month', buyer: 'business', country: '', line1: '', city: '', postalCode: '' } });
  const { register, handleSubmit, formState } = form;

  const onSubmit = async (values: Values) => {
    setBanner(null);
    const body: Schemas['ActivationCheckoutRequest'] = {
      plan: values.plan,
      interval: values.interval,
      country: values.country,
      buyer: values.buyer,
      address: { country: values.country, line1: values.line1.trim(), city: values.city.trim(), postalCode: values.postalCode.trim() },
      returnPath: DESK_PATH,
    };
    try {
      const redirect = await checkout.mutateAsync({ userId, body });
      // Marked before leaving: the page is gone once the browser navigates.
      markActivating(userId);
      leaveFor(redirect);
    } catch (error) {
      const mapped = mapDeskError(error);
      if (mapped.refetchDesk) void queryClient.invalidateQueries({ queryKey: ACCOUNTANT_CUSTOMERS_KEY });
      setBanner(mapped.banner);
    }
  };

  const fieldError = (field: keyof Values) => {
    const message = formState.errors[field]?.message;
    return message ? (
      <p className="form-error" id={`${FORM_ID}-${field}-error`}>
        {t(message)}
      </p>
    ) : null;
  };
  const describedBy = (field: keyof Values) => (formState.errors[field] ? `${FORM_ID}-${field}-error` : undefined);
  const textField = (field: 'line1' | 'city', label: string, autoComplete: string) => (
    <div className="form-group">
      <label className="form-label" htmlFor={`${FORM_ID}-${field}`}>
        {label}
      </label>
      <input id={`${FORM_ID}-${field}`} className="input" dir="auto" autoComplete={autoComplete} aria-invalid={Boolean(formState.errors[field])} aria-describedby={describedBy(field)} {...register(field)} />
      {fieldError(field)}
    </div>
  );

  return (
    <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate>
      <h4>{t('hosted.desk.next.takeCard')}</h4>
      {banner && <ProfileBanner banner={banner} />}
      <div className="form-group">
        <label className="form-label" htmlFor={`${FORM_ID}-plan`}>
          {t('hosted.desk.takeCard.plan')}
        </label>
        <Select id={`${FORM_ID}-plan`} {...register('plan')}>
          {(['solo', 'business', 'firm'] as const).map((plan) => (
            <option key={plan} value={plan}>
              {t(`hosted.desk.takeCard.plans.${plan}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor={`${FORM_ID}-interval`}>
          {t('hosted.desk.takeCard.interval')}
        </label>
        <Select id={`${FORM_ID}-interval`} {...register('interval')}>
          <option value="month">{t('hosted.desk.takeCard.monthly')}</option>
          <option value="year">{t('hosted.desk.takeCard.yearly')}</option>
        </Select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor={`${FORM_ID}-buyer`}>
          {t('hosted.desk.takeCard.buyer')}
        </label>
        <Select id={`${FORM_ID}-buyer`} {...register('buyer')}>
          <option value="business">{t('hosted.desk.takeCard.company')}</option>
          <option value="person">{t('hosted.desk.takeCard.person')}</option>
        </Select>
      </div>
      <div className="form-group">
        <label className="form-label" htmlFor={`${FORM_ID}-country`}>
          {t('hosted.desk.takeCard.country')}
        </label>
        <Select id={`${FORM_ID}-country`} aria-invalid={Boolean(formState.errors.country)} aria-describedby={describedBy('country')} {...register('country')}>
          <option value="">{t('hosted.desk.takeCard.countryChoose')}</option>
          {countryOptions(language).map((country) => (
            <option key={country.code} value={country.code}>
              {country.name}
            </option>
          ))}
        </Select>
        {fieldError('country')}
      </div>
      {textField('line1', t('hosted.desk.takeCard.address'), 'street-address')}
      {textField('city', t('hosted.desk.takeCard.city'), 'address-level2')}
      <div className="form-group">
        <label className="form-label" htmlFor={`${FORM_ID}-postalCode`}>
          {t('hosted.desk.takeCard.postalCode')}
        </label>
        <input id={`${FORM_ID}-postalCode`} className="input" dir="ltr" autoComplete="postal-code" aria-invalid={Boolean(formState.errors.postalCode)} aria-describedby={describedBy('postalCode')} {...register('postalCode')} />
        {fieldError('postalCode')}
      </div>
      <div className="hp-desk-next">
        <Button type="submit" isLoading={checkout.isPending}>
          {t('hosted.desk.takeCard.stripe')}
        </Button>
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('hosted.desk.takeCard.back')}
        </Button>
      </div>
    </form>
  );
}
