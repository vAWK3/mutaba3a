import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Drawer } from './Drawer';
import { useDrawerStore, type IncomeStatus } from '../../lib/stores';
import {
  useTransaction,
  useCreateTransaction,
  useCreateReceivedIncome,
  useUpdateTransaction,
  useDeleteTransaction,
  useProjects,
  useBusinessProfiles,
  usePaymentRecords,
  useSettings,
  useClients,
  useTransactions,
} from '../../hooks/useQueries';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { Select } from '../ui';
import { useFeatureEnabled } from '../../lib/features/useFeatures';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import {
  amountInputCurrency,
  cn,
  currencyExponent,
  formatAmount,
  formatDate,
  formatPaymentDate,
  getLocaleFromLanguage,
  isolateAmount,
  nowISO,
  parseAmountInput,
  todayISO,
} from '../../lib/utils';
import {
  buildIncomeCreate,
  buildReceivedIncomeEntry,
  buildIncomeUpdate,
  isBelowRecordedTotal,
  recordedTotalMinor,
  resolveDefaultCurrency,
  shouldExpandDetails,
  type IncomeEntryValues,
} from '../../lib/incomeEntry';
import { useLanguage, useT } from '../../lib/i18n';
import { useToast } from '../../lib/toastStore';
import { ClientTypeahead } from '../ui/ClientTypeahead';
import { ProjectTypeahead } from '../ui/ProjectTypeahead';
import { useClientProjectCascade } from '../../lib/forms/useClientProjectCascade';
import type { TxStatus } from '../../types';
import { CURRENCIES, INCOME_STATUSES, schema, type FormData } from './incomeFormSchema';
import { paymentLocalDay } from '../../lib/dates';
import { BrandLoader } from '../brand/BrandLoader';

/**
 * IncomeDrawer
 *
 * Creating and editing income. The entry is the work record (MUT-5): what you
 * did, for how much, for whom. Those three fields are the fast path; status,
 * currency, dates, project, notes and (when it is already known) the profile
 * sit behind "More details", whose summary line names the defaults in use.
 *
 * Payment state (status, paidAt, received) belongs to payment records when an
 * entry has them (ADR-030): the drawer then shows the status read-only and
 * never writes those fields. Write rules live in lib/incomeEntry.ts.
 *
 * An entry with payments names the last one up front, with Edit Payment
 * (MUT-169): it hands over to the payment drawer, once unsaved changes here
 * are saved, since switching drawers would drop them.
 */

/** Fields rendered inside "More details"; an error in one of them opens it. */
const DETAIL_FIELDS = ['incomeStatus', 'dueDate', 'currency', 'occurredAt', 'projectId', 'notes'] as const;

/** setError type for the recorded-payments guard, rendered with the recorded total */
const BELOW_RECORDED = 'belowRecorded';
/** setError type for an amount whose symbol or code names another currency */
const CURRENCY_MISMATCH = 'currencyMismatch';

const STATUS_LABEL_KEYS: Record<IncomeStatus, string> = {
  earned: 'drawer.income.statusEarned',
  invoiced: 'drawer.income.statusInvoiced',
  received: 'drawer.income.statusReceived',
};

const STATUS_HINT_KEYS: Record<IncomeStatus, string> = {
  earned: 'drawer.income.statusEarnedHint',
  invoiced: 'drawer.income.statusInvoicedHint',
  received: 'drawer.income.statusReceivedHint',
};

// Map stored status to the drawer's three-step status: paid → received,
// unpaid → invoiced (the storage does not keep earned vs invoiced apart).
function getIncomeStatusFromTx(status: TxStatus): IncomeStatus {
  return status === 'paid' ? 'received' : 'invoiced';
}

export function IncomeDrawer() {
  const { incomeDrawer, closeIncomeDrawer, openPartialPaymentDrawer } = useDrawerStore();
  const { mode, transactionId, defaultStatus, defaultClientId, defaultProjectId, defaultProfileId, duplicateFromId } = incomeDrawer;
  const t = useT();
  const { language } = useLanguage();
  const locale = getLocaleFromLanguage(language);
  const { showToast } = useToast();
  const { profiles, activeProfileId, isAllProfiles, isLoading: profilesLoading } = useActiveProfile();

  const { data: existingTx, isLoading: txLoading } = useTransaction(transactionId || '');
  const { data: sourceTx } = useTransaction(duplicateFromId || '');
  const { data: projectsData = [] } = useProjects();
  const { data: businessProfiles = [] } = useBusinessProfiles();
  const { data: settings } = useSettings();
  const paymentRecordsQuery = usePaymentRecords(mode === 'edit' ? transactionId : undefined);
  const paymentRecords = paymentRecordsQuery.data ?? [];
  // Same cache entry ClientTypeahead already warms (both call useClients()
  // with no profileId), so this is a synchronous read, not a new fetch --
  // the after-save flash (MUT-81) captures the client's name at save time
  // rather than the announcer looking it up again when it resolves.
  const { data: clients = [] } = useClients();

  const createMutation = useCreateTransaction();
  const createReceivedMutation = useCreateReceivedIncome();
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const markSaved = useSavedFlashStore((s) => s.markSaved);

  const projectsEnabled = useFeatureEnabled('projects');

  // Payment records own this entry's payment state (ADR-030, ADR-039). Until
  // they have loaded the drawer can't know, so status, currency and Save wait.
  const recordsPending = mode === 'edit' && !!transactionId && !paymentRecordsQuery.isSuccess;
  const recordsFailed = recordsPending && paymentRecordsQuery.isError;
  const hasRecords = mode === 'edit' && paymentRecords.length > 0;
  const paymentStateLocked = hasRecords || recordsPending;
  const recordedMinor = recordedTotalMinor(paymentRecords);
  // The latest payment by the user's own day (a fast-add's paidAt is a UTC
  // instant), then by the stored value, so the pick never depends on list order
  const lastPaidAt = paymentRecords.reduce<string | undefined>((latest, r) => {
    if (!latest) return r.paidAt;
    const byDay = paymentLocalDay(r.paidAt).localeCompare(paymentLocalDay(latest));
    return byDay > 0 || (byDay === 0 && r.paidAt > latest) ? r.paidAt : latest;
  }, undefined);
  const paymentHintId = useId();

  // Determine initial profile
  const initialProfileId = useMemo(() => {
    if (existingTx?.profileId) return existingTx.profileId;
    if (defaultProfileId) return defaultProfileId;
    if (!isAllProfiles && activeProfileId) return activeProfileId;
    if (profiles.length === 1) return profiles[0].id;
    return '';
  }, [existingTx, defaultProfileId, isAllProfiles, activeProfileId, profiles]);

  // A profile the drawer could not work out is asked for up front, never hidden.
  const profileInFastPath = !profilesLoading && !initialProfileId;

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      incomeStatus: existingTx ? getIncomeStatusFromTx(existingTx.status) : defaultStatus || 'earned',
      profileId: initialProfileId,
      amount: '',
      // MUT-281: resolveDefaultCurrency returns the universal (9-code)
      // Currency; this drawer's own form still only offers the local app's
      // narrower set (MUT-282 widens it) -- no profile default can be a Gulf
      // code yet since nothing lets a profile be created with one.
      currency: resolveDefaultCurrency(undefined, settings) as FormData['currency'],
      occurredAt: todayISO(),
      clientId: defaultClientId || '',
      clientDraft: '',
      projectId: defaultProjectId || '',
      dueDate: '',
      title: '',
      notes: '',
    },
  });

  const { watch, setValue, reset } = form;
  // Switching to the payment drawer unmounts this form: anything typed and not
  // saved, including a client name typed but not picked, would be lost (MUT-169)
  const clientDraftText = watch('clientDraft');
  const hasUnsavedChanges = form.formState.isDirty || !!clientDraftText?.trim();
  const selectedStatus = watch('incomeStatus');
  const selectedClientId = watch('clientId');
  const watchedProfileId = watch('profileId');
  // While the business is still asked for and unanswered, a new client can't
  // be created: it would be filed in the default business (MUT-89 review)
  const businessStillAsked = profileInFastPath && !watchedProfileId;
  const watchedCurrency = watch('currency');
  const watchedOccurredAt = watch('occurredAt');
  // Set when the user picks a currency; from then on a profile change leaves it alone.
  const [currencyChosen, setCurrencyChosen] = useState(false);

  // Update profileId when initialProfileId changes
  useEffect(() => {
    if (initialProfileId && !watchedProfileId) {
      setValue('profileId', initialProfileId);
    }
  }, [initialProfileId, watchedProfileId, setValue]);

  // A new entry starts in the currency its client last used, else its
  // profile's, and follows a client or profile change until the user picks a
  // currency themselves (MUT-92). The client's newest income, archived or
  // not, is one list read (eng review D1).
  const selectedProfile = businessProfiles.find((p) => p.id === watchedProfileId);
  const profileCurrency = resolveDefaultCurrency(selectedProfile, settings);
  const followsDefaults = mode === 'create' && !duplicateFromId;
  const { data: clientLastIncome } = useTransactions(
    { clientId: selectedClientId, kind: 'income', includeArchived: true, limit: 1 },
    { enabled: followsDefaults && !!selectedClientId }
  );
  const clientCurrency = selectedClientId ? clientLastIncome?.[0]?.currency : undefined;
  const defaultCurrency = clientCurrency ?? profileCurrency;
  useEffect(() => {
    if (!followsDefaults || currencyChosen) return;
    // MUT-281: see the resolveDefaultCurrency cast above.
    setValue('currency', defaultCurrency as FormData['currency']);
  }, [followsDefaults, currencyChosen, defaultCurrency, setValue]);

  // Reset form when existing transaction loads
  useEffect(() => {
    if (existingTx) {
      reset({
        incomeStatus: getIncomeStatusFromTx(existingTx.status),
        profileId: existingTx.profileId || initialProfileId,
        amount: (existingTx.amountMinor / 10 ** currencyExponent(existingTx.currency)).toString(),
        // MUT-281: see the resolveDefaultCurrency cast above.
        currency: existingTx.currency as FormData['currency'],
        occurredAt: existingTx.occurredAt.split('T')[0],
        clientId: existingTx.clientId || '',
        clientDraft: '',
        projectId: existingTx.projectId || '',
        dueDate: existingTx.dueDate || '',
        title: existingTx.title || '',
        notes: existingTx.notes || '',
      });
    }
  }, [existingTx, reset, initialProfileId]);

  // Reset form when duplicating from source transaction
  useEffect(() => {
    if (duplicateFromId && sourceTx && mode === 'create') {
      // When duplicating, default to 'invoiced' (common use case: new invoice for same work)
      reset({
        incomeStatus: 'invoiced',
        profileId: sourceTx.profileId || initialProfileId,
        amount: (sourceTx.amountMinor / 10 ** currencyExponent(sourceTx.currency)).toString(),
        // MUT-281: see the resolveDefaultCurrency cast above.
        currency: sourceTx.currency as FormData['currency'],
        occurredAt: todayISO(),
        clientId: sourceTx.clientId || '',
        clientDraft: '',
        projectId: sourceTx.projectId || '',
        dueDate: '',
        title: sourceTx.title || '',
        notes: sourceTx.notes || '',
      });
    }
  }, [duplicateFromId, sourceTx, mode, reset, initialProfileId]);

  // The title is the work record: a new entry starts there.
  useEffect(() => {
    if (mode === 'create') form.setFocus('title');
  }, [mode, form]);

  // Bi-directional cascade between client and project fields
  // The client field flashes when picking a project fills it (MUT-318 A3)
  const [clientFlash, setClientFlash] = useState(0);
  const flashClient = useCallback(() => setClientFlash((n) => n + 1), []);
  useClientProjectCascade({ form, projectsData, onAutoFill: flashClient });

  const handleClientDraft = useCallback(
    (text: string) => setValue('clientDraft', text, { shouldValidate: !!form.formState.errors.clientDraft }),
    [setValue, form.formState.errors.clientDraft]
  );

  // "More details": an edit opens it when the entry holds something it would
  // hide; the user's own toggle (or an error inside it) wins after that.
  const [detailsToggled, setDetailsToggled] = useState<boolean | null>(null);
  const existingProfileCurrency = resolveDefaultCurrency(
    businessProfiles.find((p) => p.id === existingTx?.profileId),
    settings
  );
  const autoExpand =
    mode === 'edit' && !!existingTx && !profilesLoading && shouldExpandDetails(existingTx, existingProfileCurrency);
  const detailsOpen = detailsToggled ?? autoExpand;

  const onInvalid = (errors: FieldErrors<FormData>) => {
    const hiddenFields: (keyof FormData)[] = profileInFastPath ? [...DETAIL_FIELDS] : [...DETAIL_FIELDS, 'profileId'];
    if (hiddenFields.some((field) => field in errors)) setDetailsToggled(true);
  };

  const onSubmit = async (data: FormData) => {
    if (recordsPending) return; // the records are still loading
    const amountMinor = parseAmountInput(data.amount, { currency: data.currency });
    if (amountMinor === null) return; // the schema already reported it

    // "€100" in a USD entry is never quietly saved as $100; the currency sits under More details
    const typedCurrency = amountInputCurrency(data.amount);
    if (typedCurrency && typedCurrency !== data.currency) {
      form.setError('amount', { type: CURRENCY_MISMATCH, message: 'validation.amountCurrencyMismatch' });
      setDetailsToggled(true);
      return;
    }

    // The repository rejects this too (ADR-030); checking here turns it into
    // a translated field message instead of a thrown error.
    // Only an amount change is checked, as in the repository, so a legacy entry
    // with more recorded than its total can still be retitled.
    const amountChanged = !existingTx || amountMinor !== existingTx.amountMinor;
    if (hasRecords && amountChanged && isBelowRecordedTotal(amountMinor, paymentRecords)) {
      form.setError('amount', { type: BELOW_RECORDED, message: 'validation.amountBelowRecorded' });
      return;
    }

    const values: IncomeEntryValues = {
      incomeStatus: data.incomeStatus,
      profileId: data.profileId,
      amountMinor,
      currency: data.currency,
      occurredAt: data.occurredAt,
      clientId: data.clientId,
      projectId: data.projectId,
      dueDate: data.dueDate,
      title: data.title,
      notes: data.notes,
    };

    const clientName = values.clientId ? clients.find((c) => c.id === values.clientId)?.name : undefined;

    try {
      if (mode === 'edit') {
        // An edit never falls through to creating a new entry
        if (!transactionId || !existingTx) {
          showToast(t('drawer.income.saveFailed'), { type: 'error' });
          return;
        }
        await updateMutation.mutateAsync({
          id: transactionId,
          data: buildIncomeUpdate(values, { now: nowISO(), existing: existingTx, hasRecords }),
        });
        markSaved({ kind: 'income', ids: [transactionId], clientId: values.clientId, clientName, profileId: values.profileId });
      } else {
        const newTx =
          values.incomeStatus === 'received'
            ? await createReceivedMutation.mutateAsync({ data: buildReceivedIncomeEntry(values), paidAt: nowISO() })
            : await createMutation.mutateAsync(buildIncomeCreate(values));
        // Show toast with undo for duplicated transactions
        if (duplicateFromId && newTx) {
          showToast(t('toast.transactionDuplicated'), {
            action: {
              label: t('common.undo'),
              onClick: () => {
                deleteMutation.mutate(newTx.id);
              },
            },
            duration: 5000,
          });
        }
        if (newTx?.id) {
          markSaved({ kind: 'income', ids: [newTx.id], clientId: values.clientId, clientName, profileId: values.profileId });
        }
      }
      closeIncomeDrawer();
    } catch (error) {
      console.error('Failed to save income:', error);
      const name = error instanceof Error ? error.name : '';
      const message =
        name === 'PaymentRecordError'
          ? t('drawer.income.savePaymentsChanged')
          : t('drawer.income.saveFailed');
      showToast(message, { type: 'error' });
    }
  };

  // A client picked from "create" takes a moment to save. A save asked for in
  // that moment (the Save button, or the Enter the client field held and
  // replays) waits for it, so the entry keeps its client.
  const [clientCreating, setClientCreating] = useState(false);
  const saveQueued = useRef(false);
  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    if (clientCreating) {
      event.preventDefault();
      saveQueued.current = true;
      return;
    }
    void form.handleSubmit(onSubmit, onInvalid)(event);
  };
  useEffect(() => {
    if (clientCreating || !saveQueued.current) return;
    saveQueued.current = false;
    void form.handleSubmit(onSubmit, onInvalid)();
  });

  const handleDelete = async () => {
    if (!transactionId) return;
    if (!confirm(t('transactions.confirmDelete'))) return;

    try {
      await deleteMutation.mutateAsync(transactionId);
      closeIncomeDrawer();
    } catch (error) {
      console.error('Failed to delete income:', error);
    }
  };

  const errorText = (field: keyof FormData): string | null => {
    const error = form.formState.errors[field];
    if (!error?.message) return null;
    if (error.type === BELOW_RECORDED) {
      const amount = formatAmount(recordedMinor, existingTx?.currency ?? watchedCurrency, locale);
      return t(error.message, { amount: isolateAmount(amount) });
    }
    if (error.type === CURRENCY_MISMATCH) {
      return t(error.message, { typed: amountInputCurrency(form.getValues('amount')) ?? '', currency: watchedCurrency });
    }
    return t(error.message);
  };

  const clientDraftError =
    errorText('clientDraft') && (businessStillAsked ? t('drawer.income.chooseBusinessFirst') : errorText('clientDraft'));

  const isSubmitting = createMutation.isPending || updateMutation.isPending;

  if (mode === 'edit' && txLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={closeIncomeDrawer}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  const profileField = (
    <div className="form-group">
      <label className="form-label" htmlFor="income-profile">
        {t('drawer.transaction.profile')} *
      </label>
      <Controller
        name="profileId"
        control={form.control}
        render={({ field }) => (
          <Select
            id="income-profile"
            invalid={Boolean(form.formState.errors.profileId)}
            {...field}
          >
            <option value="">{t('drawer.transaction.profilePlaceholder')}</option>
            {businessProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </Select>
        )}
      />
      {errorText('profileId') && <p className="form-error">{errorText('profileId')}</p>}
    </div>
  );

  // Each part is its own <bdi> so an LTR code ("USD") and an RTL date can't
  // be reordered into one another in Arabic.
  const defaultsSummary = [
    t(STATUS_LABEL_KEYS[selectedStatus]),
    watchedCurrency,
    watchedOccurredAt ? formatDate(`${watchedOccurredAt}T00:00:00`, locale) : null,
    businessProfiles.length > 1 ? selectedProfile?.name : null,
  ]
    .filter((part): part is string => !!part)
    .flatMap((part, index) => [index > 0 ? ' · ' : null, <bdi key={`part-${index}`}>{part}</bdi>]);

  return (
    <Drawer
      title={mode === 'edit' ? t('drawer.income.editTitle') : t('drawer.income.title')}
      onClose={closeIncomeDrawer}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              >
                {t('common.delete')}
              </button>
            )}
          </div>
          <div className="drawer-footer-right">
            <button type="button" className="btn btn-secondary" onClick={closeIncomeDrawer}>
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              form="income-form"
              className="btn btn-primary"
              disabled={isSubmitting || recordsPending}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="income-form" onSubmit={handleFormSubmit} noValidate>
        {recordsFailed && (
          <div className="drawer-notice" role="alert" data-testid="income-records-failed">
            <div className="drawer-notice-body">{t('drawer.income.paymentsLoadFailed')}</div>
            <button type="button" className="btn btn-sm btn-secondary" onClick={() => void paymentRecordsQuery.refetch()}>
              {t('drawer.income.paymentsRetry')}
            </button>
          </div>
        )}

        {/* Fast path: what you did, for how much, for whom */}
        <div className="form-group">
          <label className="form-label" htmlFor="income-title">
            {t('drawer.income.titleLabel')}
          </label>
          <input
            id="income-title"
            type="text"
            className="input"
            placeholder={t('drawer.income.titlePlaceholder')}
            {...form.register('title')}
          />
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="income-amount">
            {t('drawer.transaction.amount')} *
          </label>
          <div className="input-with-prefix" dir="ltr" data-testid="income-amount-group">
            <span className="input-prefix">{watchedCurrency}</span>
            <input
              id="income-amount"
              type="text"
              inputMode="decimal"
              autoComplete="off"
              className={cn('input', form.formState.errors.amount && 'input-error')}
              placeholder={t('drawer.transaction.amountPlaceholder')}
              aria-invalid={!!form.formState.errors.amount}
              {...form.register('amount')}
            />
          </div>
          {errorText('amount') && <p className="form-error">{errorText('amount')}</p>}
        </div>

        {/* Asked before the client. Until it is answered the client field
            offers no "Create new", so a new client is filed in the business
            chosen, never the default one (MUT-89 review) */}
        {profileInFastPath && profileField}

        <div className="form-group">
          <label className="form-label">
            {t('drawer.transaction.client')}
          </label>
          <Controller
            name="clientId"
            control={form.control}
            render={({ field }) => (
              <ClientTypeahead
                profileId={watchedProfileId}
                value={field.value || ''}
                onChange={field.onChange}
                onPendingTextChange={handleClientDraft}
                onCreatingChange={setClientCreating}
                canCreate={!businessStillAsked}
                flashSignal={clientFlash}
              />
            )}
          />
          {/* With no business yet, Enter cannot create the client: the error says what will (MUT-89 review) */}
          {clientDraftError ? (
            <p className="form-error">{clientDraftError}</p>
          ) : (
            businessStillAsked && <p className="form-hint">{t('drawer.income.chooseBusinessFirst')}</p>
          )}
        </div>

        {/* Fix a payment's date from the entry (MUT-169), not only the client page */}
        {hasRecords && lastPaidAt && (
          <div className="form-group">
            <div className="drawer-notice drawer-notice--info">
              <div className="drawer-notice-body">
                {t('drawer.income.lastPayment', { date: formatPaymentDate(lastPaidAt, locale) })}
              </div>
              {/* aria-disabled, not disabled: it stays focusable, so the hint is read */}
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                aria-disabled={hasUnsavedChanges}
                aria-describedby={hasUnsavedChanges ? paymentHintId : undefined}
                onClick={() => {
                  if (hasUnsavedChanges) return;
                  closeIncomeDrawer();
                  // A tick later: this drawer's unmount first hands focus back to
                  // its own trigger, which the payment drawer then returns it to
                  const id = transactionId!;
                  setTimeout(() => openPartialPaymentDrawer({ transactionId: id, intent: 'editPayment' }), 0);
                }}
              >
                {t('transactions.partialPayment.editPayment')}
              </button>
            </div>
            {hasUnsavedChanges && (
              <p id={paymentHintId} className="form-hint">
                {t('drawer.income.saveBeforePayment')}
              </p>
            )}
          </div>
        )}

        <button
          type="button"
          className="form-disclosure"
          aria-expanded={detailsOpen}
          aria-controls="income-more-details"
          onClick={() => setDetailsToggled(!detailsOpen)}
        >
          <svg className="form-disclosure-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" />
          </svg>
          <span className="form-disclosure-label">
            {detailsOpen ? t('drawer.income.lessDetails') : t('drawer.income.moreDetails')}
          </span>
          {!detailsOpen && <span className="form-disclosure-summary" data-testid="income-defaults">{defaultsSummary}</span>}
        </button>

        {detailsOpen && (
          <div id="income-more-details">
            {/* Status: Earned / Invoiced / Received. Read-only once payments are recorded. */}
            <div className="form-group">
              <span className="form-label" id="income-status-label">
                {t('drawer.income.statusLabel')}
              </span>
              <div className="type-selector" role="group" aria-labelledby="income-status-label">
                {INCOME_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    className={cn('type-selector-btn', selectedStatus === status && 'active')}
                    aria-pressed={selectedStatus === status}
                    disabled={paymentStateLocked}
                    onClick={() => setValue('incomeStatus', status)}
                  >
                    <span className="type-selector-label">{t(STATUS_LABEL_KEYS[status])}</span>
                    <span className="type-selector-hint">{t(STATUS_HINT_KEYS[status])}</span>
                  </button>
                ))}
              </div>
              {hasRecords && <p className="form-hint">{t('drawer.income.paymentsRecordedHint')}</p>}
            </div>

            {/* Due Date (only for Earned/Invoiced - unpaid income) */}
            {selectedStatus !== 'received' && (
              <div className="form-group">
                <label className="form-label" htmlFor="income-due-date">
                  {t('drawer.income.dueDate')}
                </label>
                <input id="income-due-date" type="date" className="input" {...form.register('dueDate')} />
              </div>
            )}

            <div className="form-row">
              <div className="form-group">
                <label className="form-label" htmlFor="income-currency">
                  {t('drawer.transaction.currency')}
                </label>
                <Controller
                  name="currency"
                  control={form.control}
                  render={({ field }) => (
                    <Select
                      id="income-currency"
                      {...field}
                      disabled={paymentStateLocked}
                      onChange={(event) => {
                        setCurrencyChosen(true);
                        field.onChange(event);
                        if (form.formState.errors.amount?.type === CURRENCY_MISMATCH) form.clearErrors('amount');
                      }}
                    >
                      {CURRENCIES.map((currency) => (
                        <option key={currency} value={currency}>
                          {currency}
                        </option>
                      ))}
                    </Select>
                  )}
                />
              </div>
              <div className="form-group">
                <label className="form-label" htmlFor="income-date">
                  {t('drawer.transaction.date')}
                </label>
                <input
                  id="income-date"
                  type="date"
                  className={cn('input', form.formState.errors.occurredAt && 'input-error')}
                  {...form.register('occurredAt')}
                />
                {errorText('occurredAt') && <p className="form-error">{errorText('occurredAt')}</p>}
              </div>
            </div>
            {hasRecords && (
              <p className="form-hint">
                {t('drawer.income.currencyLockedHint', { currency: existingTx?.currency ?? watchedCurrency })}
              </p>
            )}

            {/* Project — optional grouping tag, shown only while the Projects area is on (MUT-16) */}
            {projectsEnabled && (
              <div className="form-group">
                <label className="form-label">
                  {t('drawer.transaction.project')}
                </label>
                <Controller
                  name="projectId"
                  control={form.control}
                  render={({ field }) => (
                    <ProjectTypeahead
                      profileId={watchedProfileId}
                      clientId={selectedClientId || undefined}
                      value={field.value || ''}
                      onChange={field.onChange}
                      disabled={businessStillAsked}
                    />
                  )}
                />
              </div>
            )}

            <div className="form-group">
              <label className="form-label" htmlFor="income-notes">
                {t('drawer.transaction.notes')}
              </label>
              <textarea
                id="income-notes"
                className="textarea"
                placeholder={t('drawer.transaction.notesPlaceholder')}
                {...form.register('notes')}
              />
            </div>

            {!profileInFastPath && profileField}
          </div>
        )}
      </form>
    </Drawer>
  );
}
