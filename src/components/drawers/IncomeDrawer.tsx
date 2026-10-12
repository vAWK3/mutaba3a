import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useForm, Controller, type FieldErrors } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Drawer } from './Drawer';
import { useDrawerStore, type IncomeStatus } from '../../lib/stores';
import {
  useTransaction,
  useCreateTransaction,
  useUpdateTransaction,
  useDeleteTransaction,
  useProjects,
  useBusinessProfiles,
  useDocument,
  usePaymentRecords,
  useSettings,
  useClients,
} from '../../hooks/useQueries';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { useNavigate } from '@tanstack/react-router';
import { useFeatureEnabled } from '../../lib/features/useFeatures';
import { useActiveProfile } from '../../hooks/useActiveProfile';
import {
  amountInputCurrency,
  cn,
  formatAmount,
  formatDate,
  getLocaleFromLanguage,
  nowISO,
  parseAmountInput,
  todayISO,
} from '../../lib/utils';
import {
  buildIncomeCreate,
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
import { useClientProjectCascade } from '../../hooks/useClientProjectCascade';
import type { TxStatus } from '../../types';

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
 */

const INCOME_STATUSES = ['earned', 'invoiced', 'received'] as const satisfies readonly IncomeStatus[];
const CURRENCIES = ['USD', 'ILS', 'EUR'] as const;

const schema = z.object({
  incomeStatus: z.enum(INCOME_STATUSES),
  profileId: z.string().min(1, 'validation.profileRequired'),
  amount: z
    .string()
    .trim()
    .min(1, 'validation.amountRequired')
    .refine((value) => !value || parseAmountInput(value) !== null, 'validation.amountInvalid')
    .refine((value) => (parseAmountInput(value) ?? 1) > 0, 'validation.amountPositive'),
  currency: z.enum(CURRENCIES),
  occurredAt: z.string().min(1, 'validation.dateRequired'),
  clientId: z.string().optional(),
  /** Text left in the client box without picking a client (MUT-5) */
  clientDraft: z
    .string()
    .optional()
    .refine((value) => !value, 'validation.clientNotPicked'),
  projectId: z.string().optional(),
  dueDate: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

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

// Bidi isolates: keep an amount whole inside a sentence of either direction
const FIRST_STRONG_ISOLATE = '\u2068';
const POP_ISOLATE = '\u2069';

// Map stored status to the drawer's three-step status: paid → received,
// unpaid → invoiced (the storage does not keep earned vs invoiced apart).
function getIncomeStatusFromTx(status: TxStatus): IncomeStatus {
  return status === 'paid' ? 'received' : 'invoiced';
}

export function IncomeDrawer() {
  const { incomeDrawer, closeIncomeDrawer } = useDrawerStore();
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
  const updateMutation = useUpdateTransaction();
  const deleteMutation = useDeleteTransaction();
  const markSaved = useSavedFlashStore((s) => s.markSaved);

  // Document lock (MUT-13): an entry exported on a document is immutable in
  // the repository regardless of the Invoices switch; the drawer says so up
  // front instead of letting the save fail.
  const isLocked = mode === 'edit' && !!existingTx?.lockedAt;
  const invoicesEnabled = useFeatureEnabled('invoices');
  const projectsEnabled = useFeatureEnabled('projects');
  const navigate = useNavigate();
  const { data: lockingDocument } = useDocument(existingTx?.lockedByDocumentId || '');
  const openLockingDocument = () => {
    const documentId = existingTx?.lockedByDocumentId;
    if (!documentId) return;
    closeIncomeDrawer();
    navigate({ to: '/documents/$documentId', params: { documentId } });
  };

  // Payment records own this entry's payment state (ADR-030, ADR-039). Until
  // they have loaded the drawer can't know, so status, currency and Save wait.
  const recordsPending = mode === 'edit' && !!transactionId && !paymentRecordsQuery.isSuccess;
  const recordsFailed = recordsPending && paymentRecordsQuery.isError;
  const hasRecords = mode === 'edit' && paymentRecords.length > 0;
  const paymentStateLocked = hasRecords || recordsPending;
  const recordedMinor = recordedTotalMinor(paymentRecords);

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
      currency: resolveDefaultCurrency(undefined, settings),
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

  // A new entry starts in its profile's currency, and follows a profile change
  // until the user picks a currency themselves.
  const selectedProfile = businessProfiles.find((p) => p.id === watchedProfileId);
  const profileCurrency = resolveDefaultCurrency(selectedProfile, settings);
  useEffect(() => {
    if (mode !== 'create' || duplicateFromId || currencyChosen) return;
    setValue('currency', profileCurrency);
  }, [mode, duplicateFromId, currencyChosen, profileCurrency, setValue]);

  // Reset form when existing transaction loads
  useEffect(() => {
    if (existingTx) {
      reset({
        incomeStatus: getIncomeStatusFromTx(existingTx.status),
        profileId: existingTx.profileId || initialProfileId,
        amount: (existingTx.amountMinor / 100).toString(),
        currency: existingTx.currency,
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
        amount: (sourceTx.amountMinor / 100).toString(),
        currency: sourceTx.currency,
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
  useClientProjectCascade({ form, projectsData });

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
    if (isLocked || recordsPending) return; // the notice explains / the records are still loading
    const amountMinor = parseAmountInput(data.amount);
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
        const newTx = await createMutation.mutateAsync(buildIncomeCreate(values, nowISO()));
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
          : name === 'TransactionLockedError'
            ? t('drawer.income.locked.titleNoNumber')
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
      return t(error.message, { amount: `${FIRST_STRONG_ISOLATE}${amount}${POP_ISOLATE}` });
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
        <div className="loading">
          <div className="spinner" />
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
          <select
            id="income-profile"
            className={cn('select', form.formState.errors.profileId && 'input-error')}
            style={{ width: '100%' }}
            {...field}
          >
            <option value="">{t('drawer.transaction.profilePlaceholder')}</option>
            {businessProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
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
                disabled={deleteMutation.isPending || isLocked}
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
              disabled={isSubmitting || isLocked || recordsPending}
            >
              {isSubmitting ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </>
      }
    >
      <form id="income-form" onSubmit={handleFormSubmit} noValidate>
        {isLocked && (
          <div className="drawer-notice drawer-notice-locked" role="status" data-testid="income-locked-notice">
            <div className="drawer-notice-title">
              {lockingDocument?.number
                ? t('drawer.income.locked.title', { number: lockingDocument.number })
                : t('drawer.income.locked.titleNoNumber')}
            </div>
            <div className="drawer-notice-body">{t('drawer.income.locked.body')}</div>
            {invoicesEnabled ? (
              <button type="button" className="btn btn-sm btn-secondary" onClick={openLockingDocument}>
                {t('drawer.income.locked.viewDocument')}
              </button>
            ) : (
              <div className="drawer-notice-body text-muted">{t('drawer.income.locked.turnOnInvoices')}</div>
            )}
          </div>
        )}

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
                    <select
                      id="income-currency"
                      className="select"
                      style={{ width: '100%' }}
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
                    </select>
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
