import { useState } from 'react';
import { useLanguage } from '../../lib/i18n/core';
import { useTp } from '../../lib/i18n/plural';
import type { Expense, ExpenseMoveChange, HostedProfile } from '../api/client';
import { useAttemptKey } from '../data/attemptKey';
import { useExpense } from '../data/expenseQueries';
import { expenseMoveErrorOf, useExpenseMovePreview, useMoveExpense } from '../data/expenseMoveQueries';
import { DecimalAmount } from '../format/DecimalAmount';
import { formatDay } from '../format/dates';
import { InfoIcon } from './Icons';
import { MoveToProfileDrawer } from './MoveToProfileDrawer';

/**
 * MUT-589 (ADR-254): move a saved expense, with its receipts, to another of the person's profiles. The shared move
 * drawer (`MoveToProfileDrawer`) with a changes list: choosing a profile reads `/move-preview`, which lists every
 * field that changes there (D1) or refuses the way the move would, and Move stays held until it has answered.
 * Opened from the URL (`?moveExpense=<id>`), drawer-first: the expense drawer's Move, a filed receipt's ⋯.
 */
export interface MoveExpenseDrawerProps {
  profile: HostedProfile;
  expenseId: string;
  onClose: () => void;
  /** After the move held: the profile it went to. */
  onMoved: (target: HostedProfile) => void;
}

const FORM_ID = 'hosted-move-expense';

export function MoveExpenseDrawer({ profile, expenseId, onClose, onMoved }: MoveExpenseDrawerProps) {
  const expense = useExpense(profile.id, expenseId);
  if (!expense.data) return null;
  return <MoveExpenseDrawerBody profile={profile} expense={expense.data} onClose={onClose} onMoved={onMoved} />;
}

function MoveExpenseDrawerBody({ profile, expense, onClose, onMoved }: { profile: HostedProfile; expense: Expense & { receipts?: unknown[] }; onClose: () => void; onMoved: (target: HostedProfile) => void }) {
  const { t, language } = useLanguage();
  const move = useMoveExpense(profile.id);
  const attempt = useAttemptKey();
  const [chosen, setChosen] = useState<HostedProfile | null>(null);
  const [moveBanner, setMoveBanner] = useState<string | null>(null);
  const preview = useExpenseMovePreview(profile.id, expense.id, chosen?.id ?? null);

  const previewBanner = chosen && preview.isError ? t(`hosted.expenses.move.errors.${expenseMoveErrorOf(preview.error)}`, { name: chosen.name }) : null;

  const submit = async (target: HostedProfile) => {
    if (!preview.data) return;
    setMoveBanner(null);
    const body = { expenseId: expense.id, targetProfileId: target.id, expectedVersion: preview.data.expenseVersion };
    try {
      await move.mutateAsync({ ...body, idempotencyKey: attempt.keyFor(body) });
      attempt.succeeded();
      onMoved(target);
    } catch (error) {
      const key = expenseMoveErrorOf(error);
      setMoveBanner(t(`hosted.expenses.move.errors.${key}`, { name: target.name }));
      // The expense or the target changed: read the changes again, so the next Move confirms what is there now.
      if (key === 'changed') void preview.refetch();
    }
  };

  const what = expense.title ?? expense.vendor ?? '';
  const lead = (
    <>
      <DecimalAmount value={expense.amount} currency={expense.currency} /> · {formatDay(expense.occurredOn, language)}
      {what && (
        <>
          {' · '}
          <bdi dir="auto">{what}</bdi>
        </>
      )}
      {' · '}
      {t('hosted.expenses.move.onProfile', { profile: profile.name })}
    </>
  );

  const details = preview.isPending ? (
    <p className="hp-move-receipt-lead" role="status">
      {t('hosted.expenses.move.checking')}
    </p>
  ) : preview.data ? (
    <ExpenseMoveChanges changes={preview.data.changes} receiptCount={preview.data.receiptCount} currency={expense.currency} target={chosen!} />
  ) : null;

  return (
    <MoveToProfileDrawer
      profile={profile}
      title={t('hosted.expenses.move.title')}
      lead={lead}
      chosen={chosen}
      onChoose={(p) => {
        setChosen(p);
        setMoveBanner(null);
      }}
      details={details}
      banner={moveBanner ?? previewBanner}
      submitBlocked={!preview.data || preview.isFetching}
      pending={move.isPending}
      onSubmit={(target) => void submit(target)}
      onClose={onClose}
      formId={FORM_ID}
    />
  );
}

/** D1: every field that changes on the target, before the person confirms; nothing else does. */
export function ExpenseMoveChanges({ changes, receiptCount, currency, target }: { changes: ExpenseMoveChange[]; receiptCount: number; currency: string; target: HostedProfile }) {
  const { t } = useLanguage();
  const tp = useTp();
  const value = (change: ExpenseMoveChange, v: string | null) =>
    v === null ? null : change.field === 'vat' ? <DecimalAmount value={v} currency={currency as Expense['currency']} /> : <bdi dir="auto">{v}</bdi>;
  return (
    <div className="hp-move-changes">
      <h3 className="hp-move-changes-title">{t('hosted.expenses.move.changesTitle', { name: target.name })}</h3>
      {changes.length === 0 ? (
        <p className="hp-move-changes-none">{t('hosted.expenses.move.noChanges')}</p>
      ) : (
        <ul className="hp-move-changes-list">
          {changes.map((change) => (
            <li key={change.field} className="hp-move-change">
              <span className="hp-move-change-field">{t(`hosted.expenses.move.field.${change.field}`)}</span>
              <span className="hp-move-change-value">
                {change.to === null ? t('hosted.expenses.move.removed') : value(change, change.to)}
                {change.from !== null && (
                  <span className="hp-option-sub">
                    {' '}
                    {t('hosted.expenses.move.was')} {value(change, change.from)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="hp-move-changes-none">
        <InfoIcon /> {receiptCount === 0 ? t('hosted.expenses.move.keeps') : tp('hosted.expenses.move.receipts', receiptCount)}
      </p>
    </div>
  );
}
