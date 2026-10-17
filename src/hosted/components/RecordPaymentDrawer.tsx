import { useState, type FormEvent } from 'react';
import { useIsMutating } from '@tanstack/react-query';
import { Button } from '../../components/ui/Button';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useLanguage } from '../../lib/i18n/core';
import { isolate, isolateAmount } from '../../lib/utils';
import type { HostedProfile, PaymentMethod, Receivable, SettleReceivableResponse } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { isSettleable } from '../data/incomeAffordances';
import { settleMutationKey, useReceivable, useSettleReceivable } from '../data/incomeQueries';
import { useCustomerDirectory, useProjectDirectory } from '../data/queries';
import { formatDecimal } from '../format/DecimalAmount';
import { formatDay, todayInZone } from '../format/dates';
import { Drawer } from './Drawer';
import { Empty, QueryView, Skeleton } from './QueryView';
import { useToast } from './Toast';
import { mapSettleError } from './incomeApiErrors';
import { trackPortal } from '../analytics/portalAnalytics';
import { PAYMENT_METHODS, amountError, parseIncomeAmount, settleLine } from './incomeForm';

/**
 * Record payment against an open Owed entry (MUT-133; POST
 * /v1/receivables/{id}/settle). Mirrors the local PartialPaymentDrawer: the
 * title carries what's left, a live line says what the typed amount leaves
 * (design 2A, 4A). The receivable is read fresh on open, behind a skeleton,
 * so no figure jumps (5A).
 *
 * The typed amount is always sent (eng review R2): leaving it out would let the
 * server settle whatever is outstanding at write time, so a phone partial
 * landing meanwhile would silently record less than was received. A race
 * comes back as 422 ALLOCATION_EXCEEDS_OUTSTANDING with the new figure.
 */

export interface RecordPaymentDrawerProps {
  profile: HostedProfile;
  receivableId: string;
  onClose: () => void;
  /** Called after a successful settle, before the drawer closes; the page decides where focus goes (re-review A1). */
  onSettled: (result: SettleReceivableResponse) => void;
}

const FORM_ID = 'hosted-settle-form';

export function RecordPaymentDrawer({ profile, receivableId, onClose, onSettled }: RecordPaymentDrawerProps) {
  const { t, language } = useLanguage();
  const query = useReceivable(profile.id, receivableId);
  const receivable = query.data;
  const saving = useIsMutating({ mutationKey: settleMutationKey(profile.id) }) > 0;
  // The amount lives here, not in the form, so a re-read (a new version after a race or a focus
  // refetch) keeps what was typed and re-judges it against the fresh outstanding (review #1, R2).
  // null = untouched: the field shows the outstanding read on open.
  const [typedAmount, setTypedAmount] = useState<string | null>(null);
  const amount = typedAmount ?? receivable?.outstanding ?? '';
  const blocked = receivable ? settleLine(parseIncomeAmount(amount, receivable.currency), receivable.outstanding, receivable.currency)?.tone === 'over' : false;
  const title =
    receivable && isSettleable(receivable)
      ? t('hosted.settle.titleLeft', { amount: isolateAmount(formatDecimal(receivable.outstanding, receivable.currency, language)) })
      : t('hosted.settle.record');

  const nothingLeft = <Empty title={t('hosted.settle.nothingLeft')} body={t('hosted.settle.nothingLeftBody')} />;

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
          <Button type="submit" form={FORM_ID} disabled={!receivable || !isSettleable(receivable) || blocked} aria-disabled={saving || undefined}>
            {saving ? t('common.saving') : t('hosted.settle.record')}
          </Button>
        </div>
      }
    >
      <QueryView
        queries={[query]}
        data={receivable}
        isEmpty={(r) => !isSettleable(r)}
        loading={<Skeleton />}
        empty={nothingLeft}
        notFound={nothingLeft}
      >
        {(r) => (
          <SettleForm
            key={r.id}
            profile={profile}
            receivable={r}
            amount={amount}
            onAmountChange={setTypedAmount}
            onSettled={onSettled}
            reread={() => void query.refetch()}
          />
        )}
      </QueryView>
    </Drawer>
  );
}

interface SettleFormProps {
  profile: HostedProfile;
  receivable: Receivable;
  /** Owned by the drawer so a re-read never resets it. */
  amount: string;
  onAmountChange: (amount: string) => void;
  onSettled: (result: SettleReceivableResponse) => void;
  reread: () => void;
}

/** One mount per receivable; a re-read updates its outstanding in place and keeps the typed amount and errors. */
function SettleForm({ profile, receivable, amount, onAmountChange, onSettled, reread }: SettleFormProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const attempt = useAttemptKey();
  const settle = useSettleReceivable(profile.id);
  const customers = useCustomerDirectory(profile.id);
  const projects = useProjectDirectory(profile.id);
  const today = todayInZone(profile.timezone);
  const currency = receivable.currency;

  const [paidAt, setPaidAt] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [submitted, setSubmitted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({});

  const parsed = parseIncomeAmount(amount, currency);
  const line = settleLine(parsed, receivable.outstanding, currency);
  const invalid = amountError(parsed, currency);
  const client = customers.data?.get(receivable.customerId)?.name;
  const matter = receivable.projectId ? projects.data?.get(receivable.projectId)?.name : undefined;
  const money = (value: string) => isolateAmount(formatDecimal(value, currency, language));

  const amountMessage = serverErrors.amount ?? (submitted && invalid ? t(invalid.key, invalid.params) : null);
  const dateMessage =
    serverErrors.paidAt ?? (submitted && !paidAt ? t('hosted.income.errors.dateRequired') : submitted && paidAt > today ? t('hosted.income.errors.dateFuture') : null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (settle.isPending) return;
    setSubmitted(true);
    setServerErrors({});
    // Pin what is being sent: if a race re-reads a smaller outstanding, the field keeps this
    // figure (now flagged as over) instead of silently showing the new outstanding.
    onAmountChange(amount);
    if (parsed.kind !== 'ok' || line?.tone === 'over' || !paidAt || paidAt > today) return;
    const body = { amount: parsed.canonical, paidAt, method };
    try {
      const result = await settle.mutateAsync({ receivableId: receivable.id, body, idempotencyKey: attempt.keyFor(body) });
      attempt.succeeded();
      // Opt-in usage counts (MUT-155): the currency only, never the amount or client
      void trackPortal('payment_recorded', { currency });
      const shown = money(parsed.canonical);
      showToast(client ? t('hosted.settle.saved', { amount: shown, client: isolate(client) }) : t('hosted.settle.savedNoClient', { amount: shown }), { tone: 'info' });
      onSettled(result);
    } catch (error) {
      const mapped = mapSettleError(error);
      setServerErrors(
        Object.fromEntries(mapped.fields.map(({ field, key, params }) => [field, t(key, params?.outstanding ? { amount: money(params.outstanding) } : params)])),
      );
      if (mapped.toast) showToast(t(mapped.toast));
      if (mapped.reread) reread();
    }
  };

  return (
    <form id={FORM_ID} onSubmit={onSubmit} noValidate>
      <p className="hp-settle-context">
        {[client ?? '—', matter ?? '—', t('hosted.settle.due', { date: formatDay(receivable.dueDate, language) })].join(' · ')}
      </p>
        <div className="form-group">
          <label className="form-label" htmlFor="hosted-settle-amount">
            {t('hosted.settle.amount', { currency })}
          </label>
          <input
            id="hosted-settle-amount"
            type="text"
            inputMode="decimal"
            dir="ltr"
            className="input"
            autoComplete="off"
            value={amount}
            aria-invalid={Boolean(amountMessage)}
            onChange={(event) => {
              onAmountChange(event.target.value);
              setServerErrors((current) => Object.fromEntries(Object.entries(current).filter(([field]) => field !== 'amount')));
            }}
          />
          <p className={`hp-settle-line hp-settle-line-${line?.tone ?? 'none'}`} role="status">
            {line?.tone === 'done' && t(line.key)}
            {line?.tone === 'owed' && t(line.key, { amount: money(line.left) })}
            {line?.tone === 'over' && t(line.key, { amount: money(line.outstanding) })}
          </p>
          {amountMessage && <p className="form-error">{amountMessage}</p>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="hosted-settle-date">
            {t('hosted.settle.paidOn')}
          </label>
          <input id="hosted-settle-date" type="date" className="input" max={today} value={paidAt} onChange={(event) => setPaidAt(event.target.value)} />
          {dateMessage && <p className="form-error">{dateMessage}</p>}
        </div>

        <div className="form-group">
          <span className="form-label" id="hosted-settle-method-label">
            {t('hosted.settle.method')}
          </span>
          <SegmentedControl
            labelledBy="hosted-settle-method-label"
            value={method}
            onChange={setMethod}
            options={PAYMENT_METHODS.map((value) => ({ value, label: t(`hosted.payments.method.${value}`) }))}
          />
        </div>
      <p className="hp-settle-note">{t('hosted.settle.honest')}</p>
    </form>
  );
}
