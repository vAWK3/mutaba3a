import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { BrandLoader } from '../../components/brand/BrandLoader';
import { useLanguage } from '../../lib/i18n/core';
import { isolate, isolateAmount } from '../../lib/utils';
import { ApiError, type HostedProfile, type Payment, type Receivable } from '../api/client';
import { canRedateOwed, canRedatePayment, owedMayMoveAhead } from '../data/incomeAffordances';
import { usePayment, usePaymentsForEntry, useReceivable, useRedateOwed, useRedatePayment } from '../data/incomeQueries';
import { useCustomerDirectory, useProjectDirectory } from '../data/queries';
import { formatDecimal } from '../format/DecimalAmount';
import { formatDay, moneyDateCeiling, moneyDateFloor, owedDefaultDueDate, todayInZone } from '../format/dates';
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
 *
 * A record the server would refuse (undone, someone else's, Malafat's) shows "no longer available" instead of a form,
 * whether a stale link opened it or it changed while open: GET still answers 200 there, only the PATCH says 404.
 */

export type RedateKind = 'owed' | 'payment';

export interface RedateDrawerProps {
  kind: RedateKind;
  profile: HostedProfile;
  id: string;
  /** The signed-in user: only their own captures can be re-dated (the server's isOwnCapture). */
  userId: string;
  onClose: () => void;
  /** A settled entry's payment line opens that payment's drawer (eng review R4). */
  onOpenPayment: (paymentId: string) => void;
  /** When the client's payments didn't fit one page, the drawer links to them instead (R4). */
  onSeePayments: (customerId: string) => void;
}

const FORM_ID = 'hosted-redate-form';
/** Statuses with money applied: only then does the drawer look up the entry's payment lines (R4). */
const PAID_STATUSES: ReadonlySet<string> = new Set(['PAID', 'PARTIALLY_PAID']);

export function RedateDrawer({ kind, profile, id, userId, onClose, onOpenPayment, onSeePayments }: RedateDrawerProps) {
  const { t } = useLanguage();
  // Both are called every render (rules of hooks); `enabled` runs only the one this kind needs.
  const owed = useReceivable(profile.id, id, kind === 'owed');
  const paid = usePayment(profile.id, id, kind === 'payment');
  const loaded = kind === 'owed' ? owed : paid;
  const title = t(kind === 'owed' ? 'hosted.redate.owedTitle' : 'hosted.redate.paymentTitle');

  const goneDrawer = (
    <Drawer title={title} onClose={onClose} closeLabel={t('common.close')}>
      <Empty title={t('hosted.redate.gone')} />
    </Drawer>
  );
  if (loaded.isError) {
    // Not QueryView, which reads any 404 as a lost profile (TD-123): a deleted or undone row says so calmly.
    const gone = loaded.error instanceof ApiError && (loaded.error.status === 404 || loaded.error.code === 'NOT_FOUND');
    if (gone) return goneDrawer;
    return (
      <Drawer title={title} onClose={onClose} closeLabel={t('common.close')}>
        <Unreachable onRetry={() => void loaded.refetch()} />
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
  const editable = kind === 'owed' ? canRedateOwed(profile, loaded.data as Receivable, userId) : canRedatePayment(profile, loaded.data as Payment, userId);
  if (!editable) return goneDrawer;
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

interface RedateFormProps extends Omit<RedateDrawerProps, 'id' | 'userId'> {
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
  const floor = moneyDateFloor(today);
  // MUT-392: an Owed may move ahead, up to the ten-year ceiling; a payment's money has moved, so it stops at today,
  // and so does an Owed with money applied to it (the review: the server answers 409 MONEY_APPLIED).
  const pinned = kind === 'owed' && !owedMayMoveAhead(record as Receivable);
  const max = kind === 'owed' && !pinned ? moneyDateCeiling(today) : today;
  const loadedDate = dateOf(kind, record);

  const [date, setDate] = useState(loadedDate);
  const [seen, setSeen] = useState({ version: record.version, date: loadedDate });
  const [refillOnReread, setRefillOnReread] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  // A new version refills the date after a 409's re-read, or when nothing was typed; a background refetch never
  // replaces what the person typed (it then saves at the new version). Adjusted during render, not in an effect.
  if (record.version !== seen.version) {
    const untouched = date === seen.date;
    setSeen({ version: record.version, date: loadedDate });
    if (refillOnReread || untouched) {
      setDate(loadedDate);
      setDateError(null);
      setRefillOnReread(false);
    }
  }
  // A save that answers after the drawer closed must not close (or toast over) whatever is open by then.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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
    if (date > max) return setDateError(t(pinned ? 'hosted.redate.moneyApplied' : kind === 'owed' ? 'hosted.income.errors.dateTooFar' : 'hosted.income.errors.dateFuture'));
    // An entry already older than the floor may be opened and closed again; only a new date must clear it.
    if (date === loadedDate) return onClose();
    if (date < floor) return setDateError(t('hosted.income.errors.dateTooOld'));
    setDateError(null);
    try {
      if (kind === 'owed') await redateOwed.mutateAsync({ receivableId: record.id, occurredOn: date, version: record.version });
      else await redatePayment.mutateAsync({ paymentId: record.id, receivedOn: date, version: record.version });
      if (mounted.current) onClose();
    } catch (error) {
      if (!mounted.current) return;
      const mapped = mapRedateError(error, kind);
      if (mapped.fields[0]) setDateError(t(mapped.fields[0].key));
      if (mapped.toast) showToast(t(mapped.toast));
      if (mapped.reread) setRefillOnReread(true);
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
            min={floor}
            max={max}
            value={date}
            aria-invalid={Boolean(dateError)}
            onChange={(event) => {
              setDate(event.target.value);
              setDateError(null);
            }}
          />
          {dateError && <p className="form-error">{dateError}</p>}
        </div>
        {receivable && <DueNote dueDate={receivable.dueDate} date={date} />}
        {receivable && PAID_STATUSES.has(receivable.status) && (
          <EntryPayments profile={profile} receivable={receivable} onOpenPayment={onOpenPayment} onSeePayments={onSeePayments} />
        )}
      </form>
    </Drawer>
  );
}

/**
 * The due date after this re-date, as the server will store it: kept, unless the new date passes it (MUT-392 D3),
 * then the 15th of the month after the new date.
 */
function DueNote({ dueDate, date }: { dueDate: string; date: string }) {
  const { t, language } = useLanguage();
  // ISO calendar dates order lexically; an empty or partly typed date keeps the stored one.
  const moves = /^\d{4}-\d{2}-\d{2}$/.test(date) && date > dueDate;
  const shown = moves ? owedDefaultDueDate(date) : dueDate;
  return <p className="hp-settle-note">{t(moves ? 'hosted.redate.dueMoves' : 'hosted.redate.dueStays', { date: formatDay(shown, language) })}</p>;
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
