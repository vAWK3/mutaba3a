import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { BrandLoader } from '../../components/brand/BrandLoader';
import { useLanguage } from '../../lib/i18n/core';
import { isolate, isolateAmount } from '../../lib/utils';
import { ApiError, type HostedProfile, type Payment, type Receivable } from '../api/client';
import { usePayment, usePaymentsForEntry, useReceivable, useRedateOwed, useRedatePayment } from '../data/incomeQueries';
import { useCustomerDirectory, useProjectDirectory } from '../data/queries';
import { formatDecimal } from '../format/DecimalAmount';
import { formatDay, todayInZone } from '../format/dates';
import { profileKey } from '../session/me';
import { Drawer } from './Drawer';
import { mapRedateError } from './incomeApiErrors';
import { Empty, Unreachable } from './QueryView';
import { useToast } from './Toast';

/**
 * MUT-224: change the date of an Owed entry (`?income=`, PATCH /v1/income/{id}) or of a payment the person recorded
 * (`?payment=`, PATCH /v1/payments/{id}). Date only: everything else is shown, not editable (MUT-223 decisions).
 *
 *   open ─▶ read the record fresh (its version goes in If-Match; never a create response, ADR-083)
 *   save ─▶ PATCH at that version
 *     ├─ 200 ─▶ lists, summaries and the record refetch ─▶ close
 *     ├─ 409 ─▶ re-read ─▶ the form refills on the new version ─▶ "changed elsewhere", stays open (MUT-221's lesson)
 *     ├─ 422 ─▶ inline under the date
 *     └─ 404 ─▶ re-read ─▶ "no longer available"
 */

export type RedateKind = 'owed' | 'payment';

export interface RedateDrawerProps {
  kind: RedateKind;
  profile: HostedProfile;
  id: string;
  onClose: () => void;
  /** A settled entry's payment line opens that payment's drawer (eng review R4). */
  onOpenPayment: (paymentId: string) => void;
  /** When the client's payments didn't fit one page, the drawer links to them instead (R4). */
  onSeePayments: (customerId: string) => void;
}

const FORM_ID = 'hosted-redate-form';
/** Statuses with money applied: only then does the drawer look up the entry's payment lines (R4). */
const PAID_STATUSES: ReadonlySet<string> = new Set(['PAID', 'PARTIALLY_PAID']);

export function RedateDrawer({ kind, profile, id, onClose, onOpenPayment, onSeePayments }: RedateDrawerProps) {
  const { t } = useLanguage();
  // Both are called every render (rules of hooks); `enabled` runs only the one this kind needs.
  const owed = useReceivable(profile.id, id, kind === 'owed');
  const paid = usePayment(profile.id, id, kind === 'payment');
  const loaded = kind === 'owed' ? owed : paid;
  const title = t(kind === 'owed' ? 'hosted.redate.owedTitle' : 'hosted.redate.paymentTitle');

  if (loaded.isError) {
    // Not QueryView, which reads any 404 as a lost profile (TD-123): a deleted or undone row says so calmly.
    const gone = loaded.error instanceof ApiError && (loaded.error.status === 404 || loaded.error.code === 'NOT_FOUND');
    return (
      <Drawer title={title} onClose={onClose} closeLabel={t('common.close')}>
        {gone ? <Empty title={t('hosted.redate.gone')} /> : <Unreachable onRetry={() => void loaded.refetch()} />}
      </Drawer>
    );
  }
  if (!loaded.data) {
    return (
      <Drawer title={title} onClose={onClose} closeLabel={t('common.close')}>
        <div className="loading loading--section">
          <BrandLoader size={40} />
        </div>
      </Drawer>
    );
  }
  return (
    <RedateForm
      kind={kind}
      profile={profile}
      record={loaded.data}
      title={title}
      onClose={onClose}
      onOpenPayment={onOpenPayment}
      onSeePayments={onSeePayments}
    />
  );
}

interface RedateFormProps extends Omit<RedateDrawerProps, 'id'> {
  record: Receivable | Payment;
  title: string;
}

function dateOf(kind: RedateKind, record: Receivable | Payment): string {
  return kind === 'owed' ? (record as Receivable).postingDate : (record as Payment).receivedOn;
}

function RedateForm({ kind, profile, record, title, onClose, onOpenPayment, onSeePayments }: RedateFormProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const redateOwed = useRedateOwed(profile.id);
  const redatePayment = useRedatePayment(profile.id);
  const customers = useCustomerDirectory(profile.id);
  const projects = useProjectDirectory(profile.id);
  const today = todayInZone(profile.timezone);
  const loadedDate = dateOf(kind, record);

  const [date, setDate] = useState(loadedDate);
  const [seenVersion, setSeenVersion] = useState(record.version);
  const [dateError, setDateError] = useState<string | null>(null);
  // A genuinely new version (the re-read after a 409) refills the date. Adjusted during render, not in an effect,
  // so a background refetch of the same version never wipes what was typed.
  if (record.version !== seenVersion) {
    setSeenVersion(record.version);
    setDate(loadedDate);
    setDateError(null);
  }

  const receivable = kind === 'owed' ? (record as Receivable) : null;
  const pay = kind === 'payment' ? (record as Payment) : null;
  const customerId = receivable?.customerId ?? pay?.customerId ?? null;
  const client = customerId ? customers.data?.get(customerId)?.name : undefined;
  const projectId = receivable?.projectId ?? pay?.projectId ?? null;
  const matter = projectId ? projects.data?.get(projectId)?.name : undefined;
  const money = (value: string) => isolateAmount(formatDecimal(value, record.currency, language));
  const amount = receivable ? receivable.gross : pay!.amount;
  const saving = redateOwed.isPending || redatePayment.isPending;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    if (!date) return setDateError(t('hosted.redate.dateRequired'));
    if (date > today) return setDateError(t('hosted.income.errors.dateFuture'));
    if (date === loadedDate) return onClose();
    setDateError(null);
    try {
      if (kind === 'owed') await redateOwed.mutateAsync({ receivableId: record.id, occurredOn: date, version: record.version });
      else await redatePayment.mutateAsync({ paymentId: record.id, receivedOn: date, version: record.version });
      onClose();
    } catch (error) {
      const mapped = mapRedateError(error);
      if (mapped.fields[0]) setDateError(t(mapped.fields[0].key));
      if (mapped.toast) showToast(t(mapped.toast));
      if (mapped.reread) void queryClient.invalidateQueries({ queryKey: profileKey(profile.id, kind === 'owed' ? 'receivable' : 'payment', record.id) });
    }
  };

  const context = receivable
    ? [client ?? '—', matter ?? '—', money(amount)]
    : [t('hosted.redate.number', { number: isolate(pay!.number) }), client ?? '—', money(amount)];

  return (
    <Drawer
      title={title}
      onClose={onClose}
      closeLabel={t('common.close')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={FORM_ID} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        <p className="hp-settle-context">{context.join(' · ')}</p>
        <div className="form-group">
          <label className="form-label" htmlFor="hosted-redate-date">
            {t(kind === 'owed' ? 'hosted.redate.date' : 'hosted.redate.receivedOn')}
          </label>
          <input
            id="hosted-redate-date"
            type="date"
            className="input"
            max={today}
            value={date}
            aria-invalid={Boolean(dateError)}
            onChange={(event) => {
              setDate(event.target.value);
              setDateError(null);
            }}
          />
          {dateError && <p className="form-error">{dateError}</p>}
        </div>
        {receivable && <p className="hp-settle-note">{t('hosted.redate.dueStays', { date: formatDay(receivable.dueDate, language) })}</p>}
        {receivable && PAID_STATUSES.has(receivable.status) && (
          <EntryPayments profile={profile} receivable={receivable} onOpenPayment={onOpenPayment} onSeePayments={onSeePayments} />
        )}
      </form>
    </Drawer>
  );
}

/** Eng review R4: the payments applied to a settled or part-paid entry, each opening its own re-date drawer. */
function EntryPayments({
  profile,
  receivable,
  onOpenPayment,
  onSeePayments,
}: {
  profile: HostedProfile;
  receivable: Receivable;
  onOpenPayment: (paymentId: string) => void;
  onSeePayments: (customerId: string) => void;
}) {
  const { t, language } = useLanguage();
  const entryPayments = usePaymentsForEntry(profile.id, receivable.customerId, receivable.id, true);
  if (!entryPayments.data) return null;
  const { payments, complete } = entryPayments.data;
  return (
    <section className="hp-redate-payments" aria-labelledby="hosted-redate-payments">
      <h3 id="hosted-redate-payments" className="form-label">
        {t('hosted.redate.payments')}
      </h3>
      <ul className="hp-redate-payment-list">
        {payments.map((p) => (
          <li key={p.id}>
            <Button type="button" variant="ghost" size="sm" onClick={() => onOpenPayment(p.id)}>
              {t('hosted.redate.paymentLine', { date: formatDay(p.receivedOn, language), amount: isolateAmount(formatDecimal(p.amount, p.currency, language)) })}
            </Button>
          </li>
        ))}
      </ul>
      {!complete && (
        <Button type="button" variant="ghost" size="sm" onClick={() => onSeePayments(receivable.customerId)}>
          {t('hosted.redate.seePayments')}
        </Button>
      )}
    </section>
  );
}
