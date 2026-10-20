import { useState } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/Input';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useLanguage } from '../../lib/i18n/core';
import { isolate, isolateAmount } from '../../lib/utils';
import type { Currency, HostedProfile } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { canAddClient, incomeAffordancesFor, type IncomeKind } from '../data/incomeAffordances';
import { useCreateIncome } from '../data/incomeQueries';
import { useCustomerDirectory } from '../data/queries';
import { formatDecimal } from '../format/DecimalAmount';
import { formatDay, todayInZone } from '../format/dates';
import { ClientPicker } from './ClientPicker';
import { Drawer } from './Drawer';
import { ProjectPicker } from './ProjectPicker';
import { useToast } from './Toast';
import { useMatterCascade } from './useMatterCascade';
import { usePendingPicks } from './usePendingPicks';
import { mapIncomeError } from './incomeApiErrors';
import { trackPortal } from '../analytics/portalAnalytics';
import {
  DETAIL_FIELDS,
  INCOME_CURRENCIES,
  PAYMENT_METHODS,
  amountError,
  incomeFormSchema,
  parseIncomeAmount,
  toCreateIncomeRequest,
  type IncomeFormValues,
} from './incomeForm';

/**
 * Add income on the signed-in user's personal profile (MUT-133). Create-only,
 * like ConversionDrawer. Laid out like the local IncomeDrawer's fast path
 * (design 1A): kind, amount, client and (Owed) what it was for up front; the
 * fields with sensible defaults behind "More details", whose summary line
 * names the defaults in use. An error in a hidden field opens it.
 *
 * Writes POST /v1/income with an attempt-scoped Idempotency-Key, so a retry
 * after a dropped connection replays instead of writing twice. A success says
 * so in the polite status slot (design 3A): the new row is often off screen.
 */

export interface IncomeCaptureDrawerProps {
  profile: HostedProfile;
  /** The kind the page asked for (?newIncome=); falls back to the first kind the rules allow. */
  initialKind: IncomeKind;
  /** Prefilled from Client detail. */
  defaultCustomerId?: string;
  onClose: () => void;
  /** Called after a successful save, before the drawer closes; the page decides where focus goes (review #4). */
  onSaved?: () => void;
}

const FORM_ID = 'hosted-income-form';

function defaultCurrency(profile: HostedProfile): Currency {
  return (INCOME_CURRENCIES as readonly string[]).includes(profile.defaultCurrency) ? profile.defaultCurrency : 'USD';
}

export function IncomeCaptureDrawer({ profile, initialKind, defaultCustomerId, onClose, onSaved }: IncomeCaptureDrawerProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const attempt = useAttemptKey();
  const create = useCreateIncome(profile.id);
  const customers = useCustomerDirectory(profile.id);
  const { kinds, customer: customerRule } = incomeAffordancesFor(profile);
  const today = todayInZone(profile.timezone);
  const [detailsToggled, setDetailsToggled] = useState<boolean | null>(null);
  // Values a server error's message names (e.g. the matter's currency), per field, from the last refused save
  const [errorParams, setErrorParams] = useState<Partial<Record<string, Record<string, string>>>>({});

  const form = useForm<IncomeFormValues>({
    resolver: zodResolver(incomeFormSchema({ today, customerRule })),
    defaultValues: {
      kind: kinds.includes(initialKind) ? initialKind : kinds[0],
      amount: '',
      currency: defaultCurrency(profile),
      occurredOn: today,
      customerId: defaultCustomerId ?? '',
      projectId: '',
      title: '',
      dueDate: '',
      method: 'CASH',
      notes: '',
    },
  });
  const { control, handleSubmit, setError, formState } = form;
  const clientFlash = useMatterCascade(form, profile.id, 'customerId');
  const picks = usePendingPicks();
  const [kind, currency, occurredOn, customerId, dueDate, method, amount] = useWatch({
    control,
    name: ['kind', 'currency', 'occurredOn', 'customerId', 'dueDate', 'method', 'amount'],
  });

  const hiddenError = DETAIL_FIELDS.some((field) => formState.errors[field]);
  // An error in a hidden field always opens it, even after the person collapsed it (review #2).
  const detailsOpen = hiddenError || (detailsToggled ?? false);
  const clientRequired = kind === 'owed' || customerRule === 'linked-required';

  const errorText = (field: keyof IncomeFormValues): string | null => {
    const message = formState.errors[field]?.message;
    if (!message) return null;
    if (field === 'amount' && message === 'hosted.income.errors.currencyMismatch') {
      const detail = amountError(parseIncomeAmount(amount, currency), currency);
      return t(message, detail?.params);
    }
    return t(message, errorParams[field]);
  };

  const summary = [
    currency,
    occurredOn === today ? t('hosted.income.summaryToday') : formatDay(occurredOn, language),
    kind === 'owed'
      ? dueDate
        ? t('hosted.income.summaryDue', { date: formatDay(dueDate, language) })
        : t('hosted.income.summaryDueDefault')
      : t(method === 'BANK' ? 'hosted.income.summaryBank' : 'hosted.income.summaryCash'),
  ].join(' · ');

  const savedMessage = (values: IncomeFormValues, canonical: string): string => {
    const shown = isolateAmount(formatDecimal(canonical, values.currency, language));
    const client = values.customerId ? customers.data?.get(values.customerId)?.name : undefined;
    if (values.kind === 'owed') return t('hosted.income.saved.owed', { amount: shown, client: isolate(client ?? '—') });
    return client ? t('hosted.income.saved.received', { amount: shown, client: isolate(client) }) : t('hosted.income.saved.receivedNoClient', { amount: shown });
  };

  const onSubmit = async (values: IncomeFormValues) => {
    // A pending save keeps Save focusable (aria-disabled): disabling a focused button blurs it in
    // Chromium, and the drawer could then not hand focus back (review #3).
    if (create.isPending) return;
    const body = toCreateIncomeRequest(values);
    try {
      await create.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
      attempt.succeeded();
      // Opt-in usage counts (MUT-155): the kind and currency only, never the amount or client
      void trackPortal('income_recorded', { currency: values.currency, paid: values.kind === 'received' });
      showToast(savedMessage(values, body.amount), { tone: 'info' });
      onSaved?.();
      onClose();
    } catch (error) {
      const mapped = mapIncomeError(error);
      setErrorParams(Object.fromEntries(mapped.fields.map(({ field, params }) => [field, params])));
      for (const { field, key } of mapped.fields) setError(field as keyof IncomeFormValues, { type: 'server', message: key });
      if (mapped.toast) showToast(t(mapped.toast));
    }
  };

  const fieldError = (field: keyof IncomeFormValues) => {
    const text = errorText(field);
    return text ? <p className="form-error">{text}</p> : null;
  };

  return (
    <Drawer
      title={t('hosted.income.drawerTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} aria-disabled={create.isPending || picks.pending || undefined}>
            {create.isPending ? t('common.saving') : t('hosted.income.save')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={picks.guard(handleSubmit(onSubmit))} noValidate>
          {kinds.length > 1 && (
            <div className="form-group">
              <span className="form-label" id="hosted-income-kind-label">
                {t('hosted.income.kind')}
              </span>
              <Controller
                name="kind"
                control={control}
                render={({ field }) => (
                  <SegmentedControl<IncomeKind>
                    labelledBy="hosted-income-kind-label"
                    value={field.value}
                    onChange={field.onChange}
                    options={kinds.map((value) => ({ value, label: t(value === 'owed' ? 'hosted.income.kindOwed' : 'hosted.income.kindReceived') }))}
                  />
                )}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="hosted-income-amount">
              {t('hosted.income.amount')}
            </label>
            <Controller
              name="amount"
              control={control}
              render={({ field }) => (
                <input
                  id="hosted-income-amount"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  className="input"
                  autoComplete="off"
                  placeholder={t('hosted.income.amountPlaceholder')}
                  aria-invalid={Boolean(formState.errors.amount)}
                  {...field}
                />
              )}
            />
            {fieldError('amount')}
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="hosted-income-client">
              {t(clientRequired ? 'hosted.income.client' : 'hosted.income.clientOptional')}
            </label>
            <Controller
              name="customerId"
              control={control}
              render={({ field }) => (
                <ClientPicker id="hosted-income-client" profileId={profile.id} value={field.value} onChange={field.onChange} placeholder={t('hosted.income.clientPlaceholder')} canCreate={canAddClient(profile)} flashSignal={clientFlash} onCreatingChange={picks.track} />
              )}
            />
            {fieldError('customerId')}
          </div>

          {kind === 'owed' && (
            <div className="form-group">
              <label className="form-label" htmlFor="hosted-income-title">
                {t('hosted.income.whatFor')}
              </label>
              <Controller
                name="title"
                control={control}
                render={({ field }) => (
                  <input id="hosted-income-title" type="text" className="input" placeholder={t('hosted.income.whatForPlaceholder')} {...field} />
                )}
              />
            </div>
          )}

          <button
            type="button"
            className="form-disclosure"
            aria-expanded={detailsOpen}
            aria-controls="hosted-income-details"
            onClick={() => setDetailsToggled(!detailsOpen)}
          >
            <svg className="form-disclosure-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
            </svg>
            <span className="form-disclosure-label">{t(detailsOpen ? 'hosted.income.fewerDetails' : 'hosted.income.moreDetails')}</span>
            {!detailsOpen && (
              <span className="form-disclosure-summary" data-testid="income-defaults">
                {summary}
              </span>
            )}
          </button>

          {detailsOpen && (
            <div id="hosted-income-details">
              <div className="form-row">
                <div className="form-group">
                  <label className="form-label" htmlFor="hosted-income-currency">
                    {t('hosted.income.currency')}
                  </label>
                  <Controller
                    name="currency"
                    control={control}
                    render={({ field }) => (
                      <Select id="hosted-income-currency" {...field}>
                        {INCOME_CURRENCIES.map((code) => (
                          <option key={code} value={code}>
                            {code}
                          </option>
                        ))}
                      </Select>
                    )}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="hosted-income-date">
                    {t('hosted.income.date')}
                  </label>
                  <Controller
                    name="occurredOn"
                    control={control}
                    render={({ field }) => <input id="hosted-income-date" type="date" className="input" max={today} {...field} />}
                  />
                  {fieldError('occurredOn')}
                </div>
              </div>

              {kind === 'owed' ? (
                <div className="form-group">
                  <label className="form-label" htmlFor="hosted-income-due">
                    {t('hosted.income.dueDate')}
                  </label>
                  <Controller
                    name="dueDate"
                    control={control}
                    render={({ field }) => <input id="hosted-income-due" type="date" className="input" min={occurredOn || undefined} {...field} />}
                  />
                  <p className="form-hint">{t('hosted.income.dueDateHint')}</p>
                  {fieldError('dueDate')}
                </div>
              ) : (
                <div className="form-group">
                  <span className="form-label" id="hosted-income-method-label">
                    {t('hosted.income.method')}
                  </span>
                  <Controller
                    name="method"
                    control={control}
                    render={({ field }) => (
                      <SegmentedControl
                        labelledBy="hosted-income-method-label"
                        value={field.value}
                        onChange={field.onChange}
                        options={PAYMENT_METHODS.map((value) => ({ value, label: t(`hosted.payments.method.${value}`) }))}
                      />
                    )}
                  />
                </div>
              )}

              <div className="form-group">
                <label className="form-label" htmlFor="hosted-income-matter">
                  {t('hosted.income.matter')}
                </label>
                <Controller
                  name="projectId"
                  control={control}
                  render={({ field }) => (
                    <ProjectPicker
                      id="hosted-income-matter"
                      profileId={profile.id}
                      customerId={customerId || undefined}
                      value={field.value}
                      onChange={field.onChange}
                      placeholder={t('hosted.income.matterPlaceholder')}
                      canCreate={canAddClient(profile)}
                      currency={currency}
                      onCreatingChange={picks.track}
                    />
                  )}
                />
                {fieldError('projectId')}
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="hosted-income-notes">
                  {t('hosted.income.notes')}
                </label>
                <Controller
                  name="notes"
                  control={control}
                  render={({ field }) => (
                    <textarea id="hosted-income-notes" className="input" placeholder={t('hosted.income.notesPlaceholder')} rows={2} {...field} />
                  )}
                />
              </div>
            </div>
          )}
      </form>
    </Drawer>
  );
}
