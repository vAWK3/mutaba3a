import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { useFormState, useWatch } from 'react-hook-form';
import { Button } from '../../../components/ui/Button';
import { BrandLoader } from '../../../components/brand/BrandLoader';
import { useLanguage } from '../../../lib/i18n/core';
import { useSavedFlashStore } from '../../../lib/savedFlashStore';
import { trackPortal } from '../../analytics/portalAnalytics';
import { ApiError, apiErrorReason, type ExpenseReceipt, type HostedProfile } from '../../api/client';
import { ReadOnlyFields } from '../../components/Drawer';
import { Empty } from '../../components/QueryView';
import { ReceiptPreview } from '../../components/ReceiptPreview';
import { useToast } from '../../components/Toast';
import { AlertIcon, LockIcon } from '../../components/Icons';
import { applyExpenseApiError } from '../../components/expenseApiErrors';
import { HostedExpenseFields, type HostedExpenseHintField } from '../../components/expenseForm/HostedExpenseFields';
import { createExpenseBody, useHostedExpenseForm, type HostedExpenseForm, type HostedExpenseFormValues } from '../../components/expenseForm/useHostedExpenseForm';
import { useAttemptKey } from '../../data/attemptKey';
import { useExpense } from '../../data/expenseQueries';
import { canAddClient } from '../../data/incomeAffordances';
import { cachedListItem, invalidateReceipts, nextReceiptId, useApproveReceipt, useReceipt, useReceipts, useReceiptsAvailability } from '../../data/receiptQueries';
import { DecimalAmount } from '../../format/DecimalAmount';
import { HOSTED_CURRENCIES } from '../../format/currencies';
import { formatDay } from '../../format/dates';
import { LOW_CONFIDENCE, suggestionToFormValues, type SuggestedField, type SuggestionPrefill } from '../../lib/receiptSuggestion';
import { useMe, useProfile, useWriteGate } from '../../session/me';
import { MoveReceiptDrawerHost } from '../../components/MoveReceiptDrawer';
import { hasOtherProfiles, useMovedToast } from '../../components/useMovedToast';
import type { ReceiptReviewSearch } from '../../data/filters';
import { ReceiptsUnavailable } from './ReceiptsGallery';
import { PageHeader } from './shared';

/**
 * One receipt's review page (MUT-260 D1, layout B): the original large on one side, the expense form on the other
 * (the drawer's own fields, D6), prefilled from the receipt's suggestion with each filled field marked (D7). Approve
 * records the expense and files the receipt in one call (D8), then moves to the next receipt To review. A filed
 * receipt opens read-only with its expense (D10, A3). Arabic mirrors it (logical CSS), and under 760 px the
 * preview stacks above the form (D12).
 */
export interface ReceiptReviewPageProps {
  receiptId: string;
  search?: ReceiptReviewSearch;
  setSearch?: (next: ReceiptReviewSearch) => void;
}

const FORM_ID = 'hosted-receipt-form';

export function ReceiptReviewPage({ receiptId, search = {}, setSearch = () => {} }: ReceiptReviewPageProps) {
  const profile = useProfile();
  const { t } = useLanguage();
  const { availability } = useReceiptsAvailability(profile.id);
  const galleryPath = `/p/${profile.id}/expenses/receipts`;

  const back = (
    <Link to={galleryPath} className="hp-link hp-receipt-back">
      <span aria-hidden="true" className="hp-receipt-back-arrow">
        ←
      </span>{' '}
      {t('hosted.receipts.review.back')}
    </Link>
  );

  if (availability === 'off') {
    return (
      <>
        <PageHeader title={t('hosted.receipts.review.title')} />
        <ReceiptsUnavailable />
      </>
    );
  }
  return <ReceiptReviewBody receiptId={receiptId} profile={profile} back={back} search={search} setSearch={setSearch} />;
}

function ReceiptReviewBody({ receiptId, profile, back, search, setSearch }: { receiptId: string; profile: HostedProfile; back: ReactNode; search: ReceiptReviewSearch; setSearch: (next: ReceiptReviewSearch) => void }) {
  const { t } = useLanguage();
  const receipt = useReceipt(profile.id, receiptId);
  const me = useMe();
  const navigate = useNavigate();
  const { writable } = useWriteGate();
  const queue = useReceipts(profile.id, 'to_review');
  const movedToast = useMovedToast();
  // MUT-503 (DR2): Move only where there is somewhere to move to and this profile may be written.
  const canMove = writable && hasOtherProfiles(me, profile.id);
  /** DR4: on to the next receipt to review, as Approve does, with the toast naming where this one went. */
  const onMoved = (target: HostedProfile) => {
    const next = nextReceiptId(queue.data, receiptId);
    movedToast(target, receiptId);
    void navigate({ to: next ? `/p/${profile.id}/expenses/receipts/${next}` : `/p/${profile.id}/expenses/receipts` });
  };

  if (receipt.isError) {
    const gone = receipt.error instanceof ApiError && receipt.error.status === 404;
    return (
      <>
        {back}
        <PageHeader title={t('hosted.receipts.review.title')} />
        {gone ? (
          <Empty title={t('hosted.receipts.review.notFound.title')} body={t('hosted.receipts.review.notFound.body')} />
        ) : (
          <Empty title={t('hosted.states.unreachable.title')} body={t('hosted.states.unreachable.body')} action={<Button variant="secondary" size="sm" onClick={() => void receipt.refetch()}>{t('hosted.states.unreachable.retry')}</Button>} />
        )}
      </>
    );
  }
  if (!receipt.data) {
    return (
      <>
        {back}
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </>
    );
  }

  const filed = receipt.data.filingStatus === 'FILED';
  return (
    <>
      {back}
      <PageHeader title={t(filed ? 'hosted.receipts.review.filedTitle' : 'hosted.receipts.review.title')}>
        {/* DR1: beside the title, away from Approve: where the receipt belongs is decided before its fields. */}
        {!filed && canMove && (
          <Button variant="secondary" size="sm" onClick={() => setSearch({ ...search, move: true })}>
            {t('hosted.receipts.move.action')}
          </Button>
        )}
      </PageHeader>
      {search.move && canMove && <MoveReceiptDrawerHost profile={profile} receiptId={receiptId} onClose={() => setSearch({ ...search, move: undefined })} onMoved={onMoved} />}
      <div className="hp-receipt-review" data-filing-status={receipt.data.filingStatus}>
        <section className="hp-receipt-review-preview">
          <ReceiptPreview profileId={profile.id} receipt={receipt.data} />
        </section>
        <section className="hp-receipt-review-form">
          {filed ? (
            <FiledSummary profile={profile} receipt={receipt.data} />
          ) : (
            <>
              {/* MUT-441: the server is reading it; the form below works meanwhile and fills in when it's done. */}
              {receipt.readingShown && (
                <p className="hp-receipt-reading" role="status">
                  {t('hosted.receipts.review.reading')}
                </p>
              )}
              <ReviewForm key={receipt.data.id} profile={profile} receipt={receipt.data} />
            </>
          )}
        </section>
      </div>
    </>
  );
}

function ReviewForm({ profile, receipt }: { profile: HostedProfile; receipt: ExpenseReceipt }) {
  const { t } = useLanguage();
  const showToast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { writable } = useWriteGate();
  const queue = useReceipts(profile.id, 'to_review');
  const approve = useApproveReceipt(profile.id);
  // A2: one attempt per mounted receipt (the form is keyed on its id).
  const attempt = useAttemptKey();
  const [banner, setBanner] = useState<string | null>(null);

  // The suggestion at mount fills the form's defaults; one that lands later (MUT-441) is `late`, below.
  // MUT-302 (OV1): VAT is read into the form on a firm profile only, the one whose form shows it.
  const [prefill] = useState(() => suggestionToFormValues(receipt.suggested, { currencies: HOSTED_CURRENCIES, firm: profile.firm }));
  const expenseForm = useHostedExpenseForm({ profileId: profile.id, timezone: profile.timezone, initialValues: prefill.values });
  const { form, categoriesLoading, errorLabels, picks } = expenseForm;
  const late = useLateSuggestion(form, receipt.suggested, profile.firm);
  const current = useWatch({ control: form.control, name: SUGGESTED_FORM_FIELDS });

  const hints = useMemo(() => {
    const out: Partial<Record<HostedExpenseHintField, string>> = {};
    const fromReceipt = (confidence: number) => t(confidence < LOW_CONFIDENCE ? 'hosted.receipts.review.fromReceiptUnsure' : 'hosted.receipts.review.fromReceipt');
    const receiptSays = (unsupported: NonNullable<SuggestionPrefill['unsupported']>) =>
      unsupported.amount
        ? t('hosted.receipts.review.receiptSays', { currency: unsupported.currency, amount: unsupported.amount })
        : t('hosted.receipts.review.receiptSaysCurrency', { currency: unsupported.currency });
    for (const [field, confidence] of Object.entries(prefill.prefilled) as [HostedExpenseHintField, number][]) out[field] = fromReceipt(confidence);
    // A14: what the receipt said, beside the amount the form leaves empty.
    if (prefill.unsupported) out.amount = receiptSays(prefill.unsupported);
    // MUT-302 (D6): a VAT amount with no usable rate is only said, beside the empty rate.
    if (prefill.vatRead) out.vat = t('hosted.receipts.review.vatRead', { amount: prefill.vatRead });
    if (late) {
      // R10 #9: a hint only where the late suggestion's value is what the field holds (it filled it).
      const now = Object.fromEntries(SUGGESTED_FORM_FIELDS.map((name, i) => [name, current[i]]));
      for (const [field, confidence] of Object.entries(late.prefilled) as [SuggestedField, number][]) {
        const name = FORM_FIELD_OF[field];
        if (late.values[name] !== undefined && now[name] === late.values[name]) out[field] = fromReceipt(confidence);
      }
      if (late.unsupported && !out.amount && now.amount === '') out.amount = receiptSays(late.unsupported);
      if (late.vatRead && !out.vat && now.vatTreatment === '') out.vat = t('hosted.receipts.review.vatRead', { amount: late.vatRead });
    }
    return out;
  }, [prefill, late, current, t]);

  const reviewPath = (id: string) => `/p/${profile.id}/expenses/receipts/${id}`;

  const goNext = (next: string | null) => void navigate({ to: next ? reviewPath(next) : `/p/${profile.id}/expenses/receipts` });

  const onSubmit = async (values: HostedExpenseFormValues) => {
    setBanner(null);
    // A1: no `suggested` (approve would replace the stored one, and the portal reads nothing); A13: no captureSource.
    const body = createExpenseBody(values, { firm: profile.firm });
    // A13: the next receipt from the list as it stands, before approving invalidates it.
    const next = nextReceiptId(queue.data, receipt.id);
    try {
      const result = await approve.mutateAsync({ receiptId: receipt.id, body, idempotencyKey: attempt.keyFor({ receiptId: receipt.id, body }) });
      attempt.succeeded();
      // A14: the same opt-in count as the drawer's new expense, its currency and nothing else.
      void trackPortal('expense_recorded', { currency: values.currency });
      useSavedFlashStore.getState().markSaved({ kind: 'expense', ids: [result.expense.id], profileId: profile.id });
      showToast(t('hosted.receipts.review.filed'), { tone: 'info' });
      goNext(next);
    } catch (error) {
      // A2: the server keeps a 4xx answer as final under its key, so the next try needs a new one; a network error or a
      // 5xx keeps the key, so a retry that already landed replays instead of filing twice.
      if (error instanceof ApiError && error.status >= 400 && error.status < 500) attempt.succeeded();
      // A10: before the expense mapper, which would show a 409 as a stale version.
      if (error instanceof ApiError && error.code === 'CONFLICT' && apiErrorReason(error) === 'RECEIPT_ALREADY_FILED') {
        const expenseId = (error.details as { expenseId?: unknown } | null)?.expenseId;
        showToast(
          t('hosted.receipts.review.alreadyFiled'),
          typeof expenseId === 'string'
            ? { action: { label: t('hosted.receipts.review.openExpense'), onAction: () => void navigate({ to: `/p/${profile.id}/expenses`, search: { expense: expenseId } }) } }
            : undefined,
        );
        // The receipt refetches into its Filed view.
        invalidateReceipts(queryClient, profile.id);
        return;
      }
      if (error instanceof ApiError && error.code === 'VALIDATION_FAILED' && apiErrorReason(error) === 'ATTACHMENT_NOT_READY') {
        setBanner(t('hosted.receipts.errors.notReady'));
        return;
      }
      applyExpenseApiError(error, form.setError, errorLabels, showToast);
    }
  };

  if (categoriesLoading) {
    return (
      <div className="loading loading--section">
        <BrandLoader size={40} />
      </div>
    );
  }

  const next = nextReceiptId(queue.data, receipt.id);
  return (
    <>
      {banner && (
        <div className="hp-banner hp-banner-error" role="alert">
          <AlertIcon />
          <span>{banner}</span>
        </div>
      )}
      {!writable && (
        <p className="hp-readonly" role="note">
          <LockIcon />
          <span>{t('hosted.billing.gate.drawerNote')}</span>
        </p>
      )}
      {/* noValidate, as the drawer: the schema and the server say what is wrong at the field. */}
      <form id={FORM_ID} onSubmit={picks.guard(form.handleSubmit(onSubmit))} noValidate>
        <ReadOnlyFields readOnly={!writable}>
          <HostedExpenseFields
            expenseForm={expenseForm}
            profileId={profile.id}
            timezone={profile.timezone}
            canAddClient={canAddClient(profile)}
            readOnly={!writable}
            idPrefix="hosted-receipt"
            hints={hints}
            firm={profile.firm}
          />
        </ReadOnlyFields>
      </form>
      <div className="hp-receipt-actions">
        {writable && (
          <Button type="submit" form={FORM_ID} disabled={approve.isPending || picks.pending}>
            {t(approve.isPending ? 'hosted.receipts.review.approving' : 'hosted.receipts.review.approve')}
          </Button>
        )}
        {next && (
          <Link to={reviewPath(next)} className="hp-link hp-receipt-next">
            {t('hosted.receipts.review.next')} <span aria-hidden="true" className="hp-receipt-next-arrow">→</span>
          </Link>
        )}
      </div>
    </>
  );
}

/** The suggestion's fields as the form names them. */
const FORM_FIELD_OF = { date: 'occurredAt', amount: 'amount', currency: 'currency', vendor: 'vendor', vat: 'vatTreatment' } as const satisfies Record<SuggestedField, keyof HostedExpenseFormValues>;
const SUGGESTED_FORM_FIELDS = ['occurredAt', 'amount', 'currency', 'vendor', 'vatTreatment'] as const;
type SuggestedFormField = (typeof SUGGESTED_FORM_FIELDS)[number];
/** Fields that start empty: filled only while still empty. The date and currency always hold a value: filled while it is still the default. */
const STARTS_EMPTY: readonly SuggestedFormField[] = ['amount', 'vendor'];

/**
 * MUT-441 §4, R10 #9: a suggestion that lands after the page opened (the server finished reading). It fills a field
 * only when the person hasn't changed it (typed, picked, or typed then cleared: any change event counts, and so does
 * touched or dirty) and it is still empty (amount, vendor) or still its default (date, currency); the amount only in
 * the currency it was read in. Nothing is filled while Approve is in flight; an Approve that fails then fills what is
 * still untouched (the effect re-runs when submitting ends). MUT-302: a read rate fills the VAT row only while the
 * person hasn't touched it and it still records none. Returns the late suggestion, for hints.
 */
function useLateSuggestion(form: HostedExpenseForm['form'], suggested: ExpenseReceipt['suggested'], firm: boolean): SuggestionPrefill | null {
  const changed = useRef(new Set<string>());
  useEffect(() => {
    const subscription = form.watch((_values, { name, type }) => {
      if (type === 'change' && name) changed.current.add(name);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  // React's "adjust state when a prop changes", not an effect (react-hooks v7 set-state-in-effect).
  const [seen, setSeen] = useState(suggested);
  const [late, setLate] = useState<SuggestionPrefill | null>(null);
  if (suggested !== seen) {
    setSeen(suggested);
    setLate(suggested ? suggestionToFormValues(suggested, { currencies: HOSTED_CURRENCIES, firm }) : null);
  }

  // Subscribed, so the fill below runs again when an Approve that held it back ends (MUT-441 review).
  const { isSubmitting } = useFormState({ control: form.control });
  useEffect(() => {
    if (!late || isSubmitting) return;
    const untouched = (name: SuggestedFormField) => {
      const state = form.getFieldState(name);
      return !changed.current.has(name) && !state.isDirty && !state.isTouched;
    };
    const fillable = (name: SuggestedFormField) => untouched(name) && (!STARTS_EMPTY.includes(name) || !form.getValues(name));
    for (const name of ['occurredAt', 'currency', 'vendor'] as const) {
      const value = late.values[name];
      if (value !== undefined && fillable(name)) form.setValue(name, value);
    }
    // An amount read in another currency than the one the form now holds would be the wrong number.
    if (late.values.amount !== undefined && fillable('amount') && form.getValues('currency') === late.values.currency) form.setValue('amount', late.values.amount);
    if (late.values.vatTreatment && late.values.vatRate !== undefined && untouched('vatTreatment') && !changed.current.has('vatRate') && form.getValues('vatTreatment') === '') {
      form.setValue('vatTreatment', late.values.vatTreatment);
      form.setValue('vatRate', late.values.vatRate);
    }
  }, [form, late, isSubmitting]);

  return late;
}

/** D10, A3: the expense a filed receipt sits on, from the gallery's list item when cached, else the expense itself. */
function FiledSummary({ profile, receipt }: { profile: HostedProfile; receipt: ExpenseReceipt }) {
  const { t, language } = useLanguage();
  const queryClient = useQueryClient();
  const listed = cachedListItem(queryClient, profile.id, receipt.id)?.expense ?? null;
  const fetched = useExpense(profile.id, listed ? '' : (receipt.expenseId ?? ''));
  const shown = listed ?? fetched.data ?? null;
  const expenseId = receipt.expenseId;

  return (
    <div className="hp-receipt-filed">
      <h2 className="hp-receipt-filed-title">{t('hosted.receipts.review.onExpense')}</h2>
      {shown ? (
        <dl className="hp-receipt-filed-facts">
          {(shown.vendor || shown.title) && (
            <div>
              <dt>{t(shown.vendor ? 'hosted.expenses.drawer.vendor' : 'hosted.expenses.drawer.title')}</dt>
              <dd>
                <bdi>{shown.vendor ?? shown.title}</bdi>
              </dd>
            </div>
          )}
          <div>
            <dt>{t('hosted.expenses.drawer.amount')}</dt>
            <dd>
              <DecimalAmount value={shown.amount} currency={shown.currency} />
            </dd>
          </div>
          <div>
            <dt>{t('hosted.expenses.drawer.date')}</dt>
            <dd>{formatDay(shown.occurredOn, language)}</dd>
          </div>
        </dl>
      ) : (
        fetched.isLoading && (
          <div className="loading loading--section">
            <BrandLoader size={24} />
          </div>
        )
      )}
      {expenseId && (
        <Link to={`/p/${profile.id}/expenses`} search={{ expense: expenseId }} className="hp-link" data-testid="receipt-open-expense">
          {t('hosted.receipts.review.openExpense')}
        </Link>
      )}
    </div>
  );
}
