import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../lib/i18n/core';
import { isolate, isolateAmount, parseAmountInput } from '../../lib/utils';
import { ApiError, type HostedProfile, type Payment, type Receivable } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { useCreditReceivable, useReversePayment } from '../data/incomeQueries';
import { formatDecimal } from '../format/DecimalAmount';
import { minorToDecimal } from '../format/currencies';
import { Drawer } from './Drawer';
import { mapCorrectionError } from './incomeApiErrors';
import { amountError, parseIncomeAmount } from './incomeForm';
import { useToast } from './Toast';

/**
 * MUT-453: Reverse payment, Reduce amount owed and Cancel amount owed, opened from the entry drawer (RedateDrawer).
 * Each asks for a reason, which the history shows. Cancel is a credit of everything left; Reduce a credit of part.
 *
 *   confirm ─▶ POST reverse | credits (the attempt's Idempotency-Key: a retry after a lost answer replays, never doubles)
 *     ├─ 2xx ─▶ every income figure refetches ─▶ toast ─▶ drawer closes
 *     ├─ 422 more than is left ─▶ the new maximum under the amount; the entry re-reads
 *     └─ 409 / 404 ─▶ toast; the entry re-reads, so the drawer shows what it is now
 */

export type CorrectionMode = 'reverse' | 'reduce' | 'cancel';

export interface CorrectionPaneProps {
  mode: CorrectionMode;
  profile: HostedProfile;
  /** The payment for `reverse`, the Owed entry for `reduce` and `cancel`. */
  record: Payment | Receivable;
  onBack: () => void;
  onDone: () => void;
  /** The entry changed on the server: the drawer re-reads it. */
  onReread: () => void;
}

const FORM_ID = 'hosted-correction-form';
/** The server caps a reason at 500 characters (ReversePaymentRequest, CreditRequest). */
const REASON_MAX = 500;

const TITLE_KEYS: Record<CorrectionMode, string> = { reverse: 'hosted.correct.reverseTitle', reduce: 'hosted.correct.reduceTitle', cancel: 'hosted.correct.cancelTitle' };
const CONFIRM_KEYS: Record<CorrectionMode, string> = { reverse: 'hosted.correct.confirmReverse', reduce: 'hosted.correct.confirmReduce', cancel: 'hosted.correct.confirmCancel' };

export function CorrectionPane({ mode, profile, record, onBack, onDone, onReread }: CorrectionPaneProps) {
  const { t, language } = useLanguage();
  const showToast = useToast();
  const attempt = useAttemptKey();
  const reverse = useReversePayment(profile.id);
  const credit = useCreditReceivable(profile.id);
  const currency = record.currency;
  const money = (value: string) => isolateAmount(formatDecimal(value, currency, language));
  const payment = mode === 'reverse' ? (record as Payment) : null;
  const owed = mode === 'reverse' ? null : (record as Receivable);

  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [serverAmountError, setServerAmountError] = useState<string | null>(null);
  const saving = reverse.isPending || credit.isPending;

  // A save that answers after the drawer closed must not toast over whatever is open by then.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const parsed = parseIncomeAmount(amount, currency);
  const outstandingMinor = owed ? parseAmountInput(owed.outstanding, { currency }) : null;
  const over = mode === 'reduce' && parsed.kind === 'ok' && outstandingMinor !== null && parsed.minor > outstandingMinor;
  const left = mode === 'reduce' && parsed.kind === 'ok' && outstandingMinor !== null && !over ? minorToDecimal(outstandingMinor - parsed.minor, currency) : null;
  const invalidAmount = mode === 'reduce' ? amountError(parsed, currency) : null;
  const reasonMissing = reason.trim() === '';

  const amountMessage =
    serverAmountError ?? (submitted && invalidAmount ? t(invalidAmount.key, invalidAmount.params) : over && owed ? t('hosted.settle.exceeds', { amount: money(owed.outstanding) }) : null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSubmitted(true);
    setServerAmountError(null);
    if (reasonMissing || (mode === 'reduce' && (parsed.kind !== 'ok' || over))) return;
    const trimmed = reason.trim();
    try {
      if (payment) {
        const body = { paymentId: payment.id, reason: trimmed };
        await reverse.mutateAsync({ ...body, idempotencyKey: attempt.keyFor(body) });
        attempt.succeeded();
        if (mounted.current) showToast(t('hosted.correct.reversed', { amount: money(payment.amount) }), { tone: 'info' });
      } else if (owed) {
        const credited = mode === 'cancel' ? owed.outstanding : parsed.kind === 'ok' ? parsed.canonical : owed.outstanding;
        const body = { amount: credited, reason: trimmed };
        const result = await credit.mutateAsync({ receivableId: owed.id, body, idempotencyKey: attempt.keyFor({ receivableId: owed.id, ...body }) });
        attempt.succeeded();
        // Cancel credits what was left when the drawer read it; if more became owed meanwhile, say so instead of "cancelled".
        const stillOwed = parseAmountInput(result.receivable.outstanding, { currency }) ?? 0;
        if (mounted.current) {
          if (mode === 'cancel' && stillOwed > 0) showToast(t('hosted.correct.cancelledPart', { amount: money(credited), left: money(result.receivable.outstanding) }));
          else showToast(mode === 'cancel' ? t('hosted.correct.cancelled') : t('hosted.correct.reduced', { amount: money(credited) }), { tone: 'info' });
        }
      }
      if (mounted.current) onDone();
    } catch (error) {
      if (!mounted.current) return;
      // A stored 409 replays for the same key and body: a retry after one starts a new attempt (the routes say so).
      if (error instanceof ApiError && error.code === 'CONFLICT') attempt.succeeded();
      const mapped = mapCorrectionError(error);
      const amountField = mapped.fields.find((f) => f.field === 'amount');
      if (amountField) {
        const message = t(amountField.key, amountField.params?.outstanding ? { outstanding: money(amountField.params.outstanding) } : amountField.params);
        // Reduce shows it under its amount; Cancel and Reverse have no amount field, so it is a toast.
        if (mode === 'reduce') setServerAmountError(message);
        else showToast(message);
      }
      if (mapped.toast) showToast(t(mapped.toast));
      if (mapped.reread) onReread();
    }
  };

  const title = t(TITLE_KEYS[mode], payment ? { number: isolate(payment.number) } : undefined);
  return (
    <Drawer
      title={title}
      onClose={onBack}
      closeLabel={t('hosted.correct.back')}
      footer={
        <div className="drawer-footer-right">
          <Button type="button" variant="secondary" onClick={onBack} disabled={saving}>
            {t('hosted.correct.back')}
          </Button>
          <Button type="submit" form={FORM_ID} variant="danger" disabled={saving}>
            {saving ? t('hosted.correct.working') : t(CONFIRM_KEYS[mode])}
          </Button>
        </div>
      }
    >
      <form id={FORM_ID} onSubmit={onSubmit} noValidate>
        {payment && <p className="hp-settle-note hp-correct-explain">{t('hosted.correct.reverseExplain')}</p>}
        {mode === 'cancel' && owed && <p className="hp-settle-note hp-correct-explain">{t('hosted.correct.cancelExplain', { amount: money(owed.outstanding) })}</p>}
        {mode === 'reduce' && owed && (
          <div className="form-group">
            <label className="form-label" htmlFor="hosted-correction-amount">
              {t('hosted.correct.amount', { currency })}
            </label>
            <input
              id="hosted-correction-amount"
              type="text"
              inputMode="decimal"
              dir="ltr"
              className="input"
              autoComplete="off"
              value={amount}
              aria-invalid={Boolean(amountMessage)}
              onChange={(event) => {
                setAmount(event.target.value);
                setServerAmountError(null);
              }}
            />
            <p className="hp-settle-line hp-settle-line-owed" role="status">
              {left !== null && t('hosted.correct.left', { amount: money(left) })}
            </p>
            {amountMessage && <p className="form-error">{amountMessage}</p>}
          </div>
        )}
        <div className="form-group">
          <label className="form-label" htmlFor="hosted-correction-reason">
            {t('hosted.correct.reason')}
          </label>
          <textarea
            id="hosted-correction-reason"
            className="input"
            rows={3}
            maxLength={REASON_MAX}
            value={reason}
            aria-invalid={submitted && reasonMissing}
            aria-describedby="hosted-correction-reason-hint"
            onChange={(event) => setReason(event.target.value)}
          />
          <p id="hosted-correction-reason-hint" className="form-hint">
            {t('hosted.correct.reasonHint')}
          </p>
          {submitted && reasonMissing && <p className="form-error">{t('hosted.correct.reasonRequired')}</p>}
        </div>
      </form>
    </Drawer>
  );
}

