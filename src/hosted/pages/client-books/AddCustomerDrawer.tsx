import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '../../../components/ui/Button';
import { Select } from '../../../components/ui/Input';
import { useLanguage } from '../../../lib/i18n/core';
import type { Schemas } from '../../api/client';
import { mapDeskError, type DeskBanner } from '../../components/accountantErrors';
import { CodeReveal } from '../../components/CodeReveal';
import { Drawer } from '../../components/Drawer';
import { ProfileBanner } from '../../components/ProfileBanner';
import { ACCOUNTANT_CUSTOMERS_KEY, useCreateCustomer, useReissueLink } from '../../data/accountantCustomersQueries';
import { useAttemptKey } from '../../data/attemptKey';
import { countryName } from '../../data/countries';
import { DEFAULT_DESK_COUNTRY, DESK_COUNTRIES, deskCountryOf } from './deskCountries';

/**
 * MUT-768 (accountant channel, DR-4): Add customer. Five things on the first pane: the customer, their business, the
 * email, the language of the mail and the country (which sets the account's currency and time zone). The second pane
 * is the code the accountant says out loud, and where the link went. The plan, customer type and billing address are
 * asked at Take card (B13). Refusals are banners at the top of the drawer body; an existing address is one of them.
 */
const FORM_ID = 'hosted-desk-add-customer-form';

const schema = z.object({
  displayName: z.string().trim().min(1, 'hosted.desk.required'),
  profileName: z.string().trim().min(1, 'hosted.desk.required'),
  email: z.string().trim().min(1, 'hosted.desk.required').email('hosted.desk.invalidEmail'),
  locale: z.enum(['ar', 'en']),
  country: z.enum(['PS', 'IL', 'JO']),
});
type Values = z.infer<typeof schema>;

export function AddCustomerDrawer({ onClose }: { onClose: () => void }) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const create = useCreateCustomer();
  const reissue = useReissueLink();
  const attempt = useAttemptKey();
  const resendAttempt = useAttemptKey();
  const [banner, setBanner] = useState<DeskBanner | null>(null);
  const [added, setAdded] = useState<Schemas['ProvisionedCustomer'] | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const codeLabelId = useId();
  // Synchronous: two quick clicks both pass validation before the mutation reports pending.
  const submitting = useRef(false);

  const form = useForm<Values>({ resolver: zodResolver(schema) as never, defaultValues: { displayName: '', profileName: '', email: '', locale: language === 'ar' ? 'ar' : 'en', country: DEFAULT_DESK_COUNTRY } });
  const { register, handleSubmit, formState } = form;

  // The second pane takes focus, so a screen reader announces it.
  useEffect(() => {
    if (added) headingRef.current?.focus();
  }, [added]);

  const fail = (error: unknown) => {
    const mapped = mapDeskError(error);
    if (mapped.refetchDesk) void queryClient.invalidateQueries({ queryKey: ACCOUNTANT_CUSTOMERS_KEY });
    setBanner(mapped.banner);
  };

  const onSubmit = async (values: Values) => {
    if (submitting.current) return;
    submitting.current = true;
    setBanner(null);
    const place = deskCountryOf(values.country);
    const body: Schemas['ProvisionCustomerRequest'] = {
      email: values.email.trim().toLowerCase(),
      displayName: values.displayName.trim(),
      profileName: values.profileName.trim(),
      defaultCurrency: place.currency,
      timezone: place.timezone,
      locale: values.locale,
    };
    try {
      const answer = await create.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
      if (answer.status === 'exists') {
        setBanner({ tone: 'error', key: 'hosted.desk.errors.exists' });
        return;
      }
      attempt.succeeded();
      setAdded(answer);
    } catch (error) {
      fail(error);
    } finally {
      submitting.current = false;
    }
  };

  /** The link did not go out: send it again (which also makes a new code). */
  const resend = async () => {
    if (!added) return;
    setBanner(null);
    try {
      const link = await reissue.mutateAsync({ userId: added.customer.userId, idempotencyKey: resendAttempt.keyFor({ userId: added.customer.userId }) });
      resendAttempt.succeeded();
      setAdded({ ...added, ...(link.claimCode ? { claimCode: link.claimCode } : {}), linkExpiresAt: link.linkExpiresAt, mailSent: link.mailSent });
    } catch (error) {
      fail(error);
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

  if (added) {
    return (
      <Drawer
        title={t('hosted.desk.addDrawer.title')}
        onClose={onClose}
        closeLabel={t('common.close')}
        footer={
          <div className="drawer-footer-right">
            <Button type="button" onClick={onClose}>
              {t('hosted.desk.addDrawer.done')}
            </Button>
          </div>
        }
      >
        {banner && <ProfileBanner banner={banner} />}
        <h3 ref={headingRef} tabIndex={-1}>
          {t('hosted.desk.addDrawer.added')}
        </h3>
        {added.mailSent ? (
          <p className="hp-muted" dir="auto">
            {t('hosted.desk.addDrawer.sent', { email: added.customer.email })}
          </p>
        ) : (
          <ProfileBanner banner={{ tone: 'info', key: 'hosted.desk.addDrawer.notSent' }}>
            <Button type="button" variant="ghost" size="sm" onClick={() => void resend()} isLoading={reissue.isPending}>
              {t('hosted.desk.next.resend')}
            </Button>
          </ProfileBanner>
        )}
        {added.claimCode && (
          <>
            <p id={codeLabelId} className="hp-muted">
              {t('hosted.desk.addDrawer.code')}
            </p>
            <CodeReveal code={added.claimCode} labelledBy={codeLabelId} />
          </>
        )}
      </Drawer>
    );
  }

  return (
    <Drawer
      title={t('hosted.desk.addDrawer.title')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={create.isPending || undefined}>
            {create.isPending ? t('hosted.desk.addDrawer.submitting') : t('hosted.desk.addDrawer.submit')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit(onSubmit)} noValidate>
        {banner && <ProfileBanner banner={banner} />}
        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-name`}>
            {t('hosted.desk.addDrawer.name')}
          </label>
          <input id={`${FORM_ID}-name`} className="input" dir="auto" autoComplete="off" aria-invalid={Boolean(formState.errors.displayName)} aria-describedby={describedBy('displayName')} {...register('displayName')} />
          {fieldError('displayName')}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-business`}>
            {t('hosted.desk.addDrawer.business')}
          </label>
          <input id={`${FORM_ID}-business`} className="input" dir="auto" autoComplete="off" aria-invalid={Boolean(formState.errors.profileName)} aria-describedby={describedBy('profileName')} {...register('profileName')} />
          {fieldError('profileName')}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-email`}>
            {t('hosted.desk.addDrawer.email')}
          </label>
          <input id={`${FORM_ID}-email`} className="input" dir="ltr" inputMode="email" autoComplete="off" aria-invalid={Boolean(formState.errors.email)} aria-describedby={describedBy('email')} {...register('email')} />
          {fieldError('email')}
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-language`}>
            {t('hosted.desk.addDrawer.language')}
          </label>
          <Select id={`${FORM_ID}-language`} {...register('locale')}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </Select>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor={`${FORM_ID}-country`}>
            {t('hosted.desk.addDrawer.country')}
          </label>
          <Select id={`${FORM_ID}-country`} {...register('country')}>
            {DESK_COUNTRIES.map((country) => (
              <option key={country.code} value={country.code}>
                {countryName(country.code, language)}
              </option>
            ))}
          </Select>
        </div>
      </form>
    </Drawer>
  );
}
