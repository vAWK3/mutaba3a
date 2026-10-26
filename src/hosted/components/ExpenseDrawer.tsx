import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { expenseKey, useCreateExpense, useDeleteExpense, useExpense, useUpdateExpense } from '../data/expenseQueries';
import { useToast } from './Toast';
import { useSavedFlashStore } from '../../lib/savedFlashStore';
import { ReceiptUploader } from './ReceiptUploader';
import { Drawer, ReadOnlyFields } from './Drawer';
import { applyExpenseApiError } from './expenseApiErrors';
import { useAttemptKey } from '../data/attemptKey';
import { ApiError, type CreateExpenseRequest, type Expense, type UpdateExpenseRequest } from '../api/client';
import { BrandLoader } from '../../components/brand/BrandLoader';
import { trackPortal } from '../analytics/portalAnalytics';
import { InGroupsLine } from './groups/InGroupsLine';
import { createExpenseBody, useHostedExpenseForm, type HostedExpenseFormValues } from './expenseForm/useHostedExpenseForm';
import { HostedExpenseFields } from './expenseForm/HostedExpenseFields';

export type { HostedExpenseFormValues } from './expenseForm/useHostedExpenseForm';

/**
 * The hosted portal's expense capture (MUT-44). Builds on
 * `components/expenses/ExpenseFormFields` — amount/currency/date/title/
 * category/notes — with its own vendor field (free text with the profile's
 * vendors as suggestions, MUT-254), client and project pickers, and its own CreateExpense/
 * UpdateExpense/DeleteExpense wiring. See mut-44-expense-capture.md §3/§6a.
 * MUT-260 (D6): the form's state and fields live in `expenseForm/`, shared with the receipt review page.
 */

export interface ExpenseDrawerProps {
  profileId: string;
  mode: 'create' | 'edit';
  expenseId?: string;
  onClose: () => void;
  /** The profile's IANA zone, for the default date (MUT-133 D5); the browser calendar when absent. */
  timezone?: string;
  /** Called instead of `onClose` after a delete, so the list can drop an anchor on the deleted record (MUT-91). */
  onDeleted?: (expenseId: string) => void;
  /** The client field offers "Add client: «name»" (`canAddClient(profile)`, MUT-286). */
  canAddClient?: boolean;
  /** MUT-361: the profile is read-only (lapse gate): the expense opens to be read, with nothing to save or delete. */
  readOnly?: boolean;
}

export function ExpenseDrawer({ profileId, mode, expenseId, onClose, timezone, onDeleted, canAddClient = false, readOnly = false }: ExpenseDrawerProps) {
  // After-save feedback (R1 via HP1, MUT-91): always from the drawer, the one
  // place that knows a save happened (ADR-057 §4). Delete marks nothing.
  const markSaved = (id: string) => useSavedFlashStore.getState().markSaved({ kind: 'expense', ids: [id], profileId });
  const { t } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();

  const { data: existingExpense, isLoading: expenseLoading } = useExpense(profileId, expenseId ?? '');

  const createMutation = useCreateExpense(profileId);
  const attempt = useAttemptKey();
  const updateMutation = useUpdateExpense(profileId);
  const deleteMutation = useDeleteExpense(profileId);

  const expenseForm = useHostedExpenseForm({ profileId, timezone });
  const { form, categoriesLoading, errorLabels, picks } = expenseForm;
  const { handleSubmit, reset, setError } = form;

  // (Re)fill the form when a genuinely new version arrives: the first load, or
  // the refetch after a 409 (MUT-221, as ConversionDrawer's D6). Keyed on id and
  // version, not the object, so a background refetch never wipes typing.
  const latest = useRef(existingExpense);
  useEffect(() => {
    latest.current = existingExpense;
  });
  const existingId = existingExpense?.id;
  const existingVersion = existingExpense?.version;
  useEffect(() => {
    if (mode === 'edit' && latest.current) reset(valuesOf(latest.current));
  }, [mode, existingId, existingVersion, reset]);

  const onSubmit = async (values: HostedExpenseFormValues) => {
    try {
      if (mode === 'edit' && existingExpense) {
        // This drawer sends no `currency` on edit (the API takes one only together
        // with `amount`, ADR-096; a portal currency control is MUT-277), and
        // UpdateExpenseRequest's optional fields are `string | null`,
        // where `null` clears the field and omission leaves it unchanged. Both
        // differ from CreateExpenseRequest, so this body is built separately
        // rather than sharing one object coerced across the two shapes.
        const body: UpdateExpenseRequest = {
          occurredOn: values.occurredAt,
          amount: values.amount,
          title: values.title || null,
          vendor: values.vendor || null,
          categoryId: values.categoryId || null,
          customerId: values.clientId || null,
          projectId: values.projectId || null,
          notes: values.notes || null,
        };
        await updateMutation.mutateAsync({ expenseId: existingExpense.id, body, version: String(existingExpense.version) });
        markSaved(existingExpense.id);
      } else {
        const body: CreateExpenseRequest = createExpenseBody(values);
        const created = await createMutation.mutateAsync({ body, idempotencyKey: attempt.keyFor(body) });
        attempt.succeeded();
        // Opt-in usage counts (MUT-155): a new expense only, its currency and nothing else
        void trackPortal('expense_recorded', { currency: values.currency });
        markSaved(created.id);
      }
      onClose();
    } catch (error) {
      // A stale version: refetch, so the form refills at the new version and the next Save carries it.
      if (existingExpense && error instanceof ApiError && error.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: expenseKey(profileId, existingExpense.id) });
      }
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const handleDelete = async () => {
    if (!existingExpense) return;
    if (!confirm(t('common.delete'))) return;
    try {
      await deleteMutation.mutateAsync(existingExpense.id);
      if (onDeleted) onDeleted(existingExpense.id);
      else onClose();
    } catch (error) {
      applyExpenseApiError(error, setError, errorLabels, showToast);
    }
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending;
  const isLoading = categoriesLoading || (mode === 'edit' && expenseLoading);

  if (isLoading) {
    return (
      <Drawer title={t('common.loading')} onClose={onClose} closeLabel={t('common.close')}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }

  return (
    <Drawer
      title={mode === 'edit' ? t('hosted.expenses.drawer.editTitle') : t('hosted.expenses.drawer.newTitle')}
      onClose={onClose}
      closeLabel={t('common.close')}
      readOnly={readOnly}
      footer={
        <>
          <div className="drawer-footer-left">
            {mode === 'edit' && (
              <Button type="button" variant="danger" onClick={handleDelete} disabled={deleteMutation.isPending}>
                {t('common.delete')}
              </Button>
            )}
          </div>
          <div className="drawer-footer-right">
            <Button type="button" variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" form="hosted-expense-form" disabled={isSubmitting || picks.pending}>
              {isSubmitting ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </>
      }
    >
      {/* noValidate: the zod schema and the server's refusals say what is wrong at the field; the browser's own check on the
          date's ten-year max (MUT-392) would otherwise block Save with no message the drawer can show. */}
      {mode === 'edit' && existingExpense?.captureSource === 'mcp' && <AddedByClaude label={t('hosted.expenses.drawer.addedByClaude')} />}
      <form id="hosted-expense-form" onSubmit={picks.guard(handleSubmit(onSubmit))} noValidate>
        <ReadOnlyFields readOnly={readOnly}>
          <HostedExpenseFields expenseForm={expenseForm} profileId={profileId} timezone={timezone} canAddClient={canAddClient} readOnly={readOnly} currencyDisabled={mode === 'edit'} />
        </ReadOnlyFields>
      </form>
      {mode === 'edit' && existingExpense && (
        <ReceiptUploader profileId={profileId} expenseId={existingExpense.id} receipts={existingExpense.receipts} readOnly={readOnly} />
      )}
      {/* MUT-268 (11A): the groups this expense is in, and Add to group… */}
      {mode === 'edit' && existingExpense && <InGroupsLine profileId={profileId} expense={existingExpense} readOnly={readOnly} />}
    </Drawer>
  );
}

function valuesOf(expense: Expense): HostedExpenseFormValues {
  return {
    amount: expense.amount,
    currency: expense.currency,
    occurredAt: expense.occurredOn,
    title: expense.title ?? '',
    vendor: expense.vendor ?? '',
    clientId: expense.customerId ?? '',
    projectId: expense.projectId ?? '',
    categoryId: expense.categoryId ?? '',
    notes: expense.notes ?? '',
  };
}

/**
 * MUT-436 (AC5): an expense the person's own Claude added (captureSource 'mcp', ADR-201). "Claude" is a name: it stays
 * Latin and left-to-right inside an Arabic sentence (<bdi>, ADR-101).
 */
function AddedByClaude({ label }: { label: string }) {
  const [before, after = ''] = label.split('{claude}');
  return (
    <p className="expense-drawer-source">
      <Badge variant="info" size="sm">
        {before}
        <bdi>Claude</bdi>
        {after}
      </Badge>
    </p>
  );
}

