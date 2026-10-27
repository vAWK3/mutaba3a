import { useEffect, useRef, useState, type RefObject } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge } from '../../../components/ui/Badge';
import { Button } from '../../../components/ui/Button';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { useTp } from '../../../lib/i18n/plural';
import { api, ApiError, apiErrorReason, type SignupReview, type SignupReviewDecision } from '../../api/client';
import { CopyField } from '../../components/CopyField';
import { AlertIcon, InfoIcon } from '../../components/Icons';
import { Empty, QueryView, Skeleton } from '../../components/QueryView';
import { useToast } from '../../components/Toast';
import { dropSignup, useOperatorSignups } from '../../data/operatorQueries';
import { mailRetryable, mailWentOut, reviewChips, waitingOf, type ReviewChip } from '../../data/signupReviews';
import { ME_KEY } from '../../session/me';
import { OperatorConfirm, StepUpFailureBanner, useOperatorRun } from '../../operator/OperatorStepUp';
import { agoText } from '../../operator/time';

/**
 * MUT-460 (design 7A, 8A, 9A, 11A, 13A, 18A): the signups waiting for review, oldest first. Each row says who, how long
 * they have waited and what the signup screen noticed; Approve and Decline confirm in the row and say what will be
 * mailed. A decided row leaves the list with a toast, and focus moves to the next row (or the heading). A decision whose
 * mail didn't go stays as a warning with the address to copy (and, for an approval, Send again); one someone else
 * decided first says so. Every write goes through the operator step-up (OperatorStepUp.tsx).
 */
type Decision = 'approve' | 'decline';
type Settled = { review: SignupReview; state: 'approvedMailFailed' | 'declinedMailFailed' | 'alreadyDecided'; mail?: SignupReviewDecision['mail'] };

const SKELETON_ROWS = 3;

export function OperatorSignupsPage({ headingRef }: { headingRef: RefObject<HTMLHeadingElement | null> }) {
  const t = useT();
  const showToast = useToast();
  const queryClient = useQueryClient();
  const query = useOperatorSignups();
  const [settled, setSettled] = useState<Settled[]>([]);
  const listRef = useRef<HTMLUListElement>(null);
  const waiting = (query.data?.data ?? []).filter((review) => !settled.some((s) => s.review.id === review.id));

  /** 8A: to the row that took the decided one's place, or the heading when none are left. */
  function focusRowAt(index: number) {
    requestAnimationFrame(() => {
      const rows = listRef.current?.querySelectorAll<HTMLElement>('[data-signup-row]') ?? [];
      (rows[Math.min(index, rows.length - 1)] ?? headingRef.current)?.focus();
    });
  }

  function settle(review: SignupReview, state: Settled['state'], mail?: SignupReviewDecision['mail']) {
    setSettled((rows) => [...rows.filter((s) => s.review.id !== review.id), { review, state, ...(mail ? { mail } : {}) }]);
    dropSignup(queryClient, review.userId ?? '');
  }

  function onDecided(review: SignupReview, index: number, decision: Decision, mail: SignupReviewDecision['mail']) {
    if (!mailWentOut(mail)) return settle(review, decision === 'approve' ? 'approvedMailFailed' : 'declinedMailFailed', mail);
    dropSignup(queryClient, review.userId ?? '');
    showToast(t(decision === 'approve' ? 'hosted.operator.signups.approved' : 'hosted.operator.signups.declined', { email: review.email ?? '' }), { tone: 'info' });
    focusRowAt(index);
  }

  function dismiss(review: SignupReview) {
    setSettled((rows) => rows.filter((s) => s.review.id !== review.id));
    focusRowAt(0);
  }

  return (
    <>
      {settled.length > 0 && (
        <ul className="hp-passkey-list hp-operator-list">
          {settled.map((s) => (
            <SettledRow key={s.review.id} settled={s} stepUpUntil={query.data?.stepUpUntil ?? null} onDone={() => dismiss(s.review)} />
          ))}
        </ul>
      )}
      <QueryView
        queries={[query]}
        data={query.data}
        isEmpty={() => waiting.length === 0}
        loading={<Skeleton rows={SKELETON_ROWS} />}
        empty={<Empty title={t('hosted.operator.signups.emptyTitle')} body={t('hosted.operator.signups.emptyBody')} />}
      >
        {(list) => (
          <ul ref={listRef} className="hp-passkey-list hp-operator-list" aria-label={t('hosted.operator.signups.listLabel')}>
            {waiting.map((review, index) => (
              <SignupRow
                key={review.id}
                review={review}
                stepUpUntil={list.stepUpUntil}
                onDecided={(decision, mail) => onDecided(review, index, decision, mail)}
                onAlreadyDecided={() => settle(review, 'alreadyDecided')}
                onGone={() => void queryClient.invalidateQueries({ queryKey: ME_KEY })}
              />
            ))}
          </ul>
        )}
      </QueryView>
    </>
  );
}

function SignupRow({
  review,
  stepUpUntil,
  onDecided,
  onAlreadyDecided,
  onGone,
}: {
  review: SignupReview;
  stepUpUntil: string | null;
  onDecided: (decision: Decision, mail: SignupReviewDecision['mail']) => void;
  onAlreadyDecided: () => void;
  /** A 404: the review is gone, or the operator gate refused (operator revoked). /v1/me decides which: a revoked operator leaves the page. */
  onGone: () => void;
}) {
  const t = useT();
  const run = useOperatorRun(stepUpUntil);
  const [mode, setMode] = useState<'view' | Decision>('view');
  const [notEmpty, setNotEmpty] = useState(false);
  const openers = useRef<Record<Decision, HTMLButtonElement | null>>({ approve: null, decline: null });
  const email = review.email ?? '';
  const userId = review.userId;

  function cancel() {
    const opener = mode;
    setMode('view');
    setNotEmpty(false);
    run.clear();
    // 11A: focus returns to the button that opened the confirm (drawn again with the row, so read after it is).
    requestAnimationFrame(() => (opener === 'view' ? null : openers.current[opener])?.focus());
  }

  async function decide(decision: Decision) {
    if (!userId) return;
    setNotEmpty(false);
    try {
      const result = await run.run(() => api.decideSignupReview(userId, decision));
      if (result) onDecided(decision, result.mail);
    } catch (error) {
      const reason = error instanceof ApiError ? apiErrorReason(error) : undefined;
      if (error instanceof ApiError && error.status === 404) {
        onGone();
        onAlreadyDecided();
      } else if (reason === 'ALREADY_DECIDED') onAlreadyDecided();
      else if (reason === 'NOT_EMPTY') setNotEmpty(true);
      else run.setFailure('failed');
    }
  }

  if (mode !== 'view') {
    const approve = mode === 'approve';
    return (
      <li className="hp-passkey-row" data-signup-row tabIndex={-1} aria-label={email}>
        <OperatorConfirm
          text={t(approve ? 'hosted.operator.signups.confirmApprove' : 'hosted.operator.signups.confirmDecline', { email })}
          labels={{
            plain: t(approve ? 'hosted.operator.signups.approve' : 'hosted.operator.signups.decline'),
            passkey: t(approve ? 'hosted.operator.signups.approveWithPasskey' : 'hosted.operator.signups.declineWithPasskey'),
          }}
          variant={approve ? 'primary' : 'danger'}
          run={run}
          error={
            notEmpty && (
              <div className="hp-banner hp-banner-error" role="alert">
                <AlertIcon />
                <span>{t('hosted.operator.signups.notEmpty')}</span>
              </div>
            )
          }
          onConfirm={() => void decide(mode)}
          onCancel={cancel}
        />
      </li>
    );
  }

  return (
    <li className="hp-passkey-row" data-signup-row tabIndex={-1} aria-label={email}>
      <SignupSummary review={review} />
      {userId && (
        <span className="hp-passkey-actions">
          <button ref={(el) => void (openers.current.approve = el)} type="button" className="hp-link-button press" onClick={() => setMode('approve')}>
            {t('hosted.operator.signups.approve')}
          </button>
          <button ref={(el) => void (openers.current.decline = el)} type="button" className="hp-link-button hp-danger press" onClick={() => setMode('decline')}>
            {t('hosted.operator.signups.decline')}
          </button>
        </span>
      )}
    </li>
  );
}

/** Who, how long they have waited, the domain, and what the signup screen noticed (13A, 18A). */
function SignupSummary({ review }: { review: SignupReview }) {
  const t = useT();
  const { language } = useLanguage();
  const now = new Date();
  const waited = waitingOf(review.createdAt, now);
  const time = agoText(review.createdAt, now, language);
  return (
    <span className="hp-passkey-text">
      <span className="hp-passkey-name hp-operator-email" dir="ltr">
        {review.email}
      </span>
      <span className="hp-option-sub">
        {t('hosted.operator.signups.signedUp', { time })} · <bdi dir="ltr">{review.domain}</bdi>
      </span>
      <span className="hp-operator-chips">
        {reviewChips(review).map((chip, i) => (
          <ChipBadge key={i} chip={chip} />
        ))}
        {waited.overADay && (
          <Badge variant="warning" size="sm">
            {t('hosted.operator.signups.longWait')}
          </Badge>
        )}
      </span>
    </span>
  );
}

function ChipBadge({ chip }: { chip: ReviewChip }) {
  const t = useT();
  const tp = useTp();
  if (chip.kind === 'raw') {
    return (
      <Badge variant="neutral" size="sm" dir="ltr">
        {chip.code}
      </Badge>
    );
  }
  return (
    <Badge variant={chip.tone} size="sm">
      {chip.kind === 'age' ? (chip.days === 0 ? t('hosted.operator.chips.domainToday') : tp('hosted.operator.chips.youngDomain', chip.days)) : t(`hosted.operator.chips.${chip.key}`)}
    </Badge>
  );
}

/** 9A and the 409: a decided row that stays, with what to do about it, until Done. */
function SettledRow({ settled, stepUpUntil, onDone }: { settled: Settled; stepUpUntil: string | null; onDone: () => void }) {
  const t = useT();
  const showToast = useToast();
  const run = useOperatorRun(stepUpUntil);
  const { review, state } = settled;
  // 9A: Send again only where another try can go out (a failed or capped send); otherwise the address is the way.
  const [retryable, setRetryable] = useState(mailRetryable(settled.mail));
  const email = review.email ?? '';
  const rowRef = useRef<HTMLLIElement>(null);
  // It takes the decided row's place, so it takes its focus too.
  useEffect(() => rowRef.current?.focus(), []);

  async function sendAgain() {
    if (!review.userId) return;
    try {
      const result = await run.run(() => api.decideSignupReview(review.userId!, 'resend'));
      if (!result) return;
      if (!mailWentOut(result.mail)) {
        if (mailRetryable(result.mail)) run.setFailure('failed');
        else setRetryable(false);
        return;
      }
      showToast(t('hosted.operator.signups.resent', { email }), { tone: 'info' });
      onDone();
    } catch {
      run.setFailure('failed');
    }
  }

  const sendLabel = run.label === 'confirm' ? t('hosted.operator.stepUp.confirmWithPasskey') : run.label === 'passkey' ? t('hosted.operator.signups.sendAgainWithPasskey') : t('hosted.operator.signups.sendAgain');
  return (
    <li className="hp-passkey-row hp-operator-settled" ref={rowRef} tabIndex={-1} aria-label={email}>
      <span className="hp-passkey-text">
        <span className="hp-passkey-name hp-operator-email" dir="ltr">
          {email}
        </span>
      </span>
      {state === 'alreadyDecided' ? (
        <div className="hp-banner hp-banner-info" role="status">
          <InfoIcon />
          <span>{t('hosted.operator.signups.alreadyDecided')}</span>
        </div>
      ) : (
        <>
          <div className="hp-banner hp-banner-warning" role="alert">
            <AlertIcon />
            <span>{t(state === 'approvedMailFailed' ? 'hosted.operator.signups.mailFailedApproved' : 'hosted.operator.signups.mailFailedDeclined')}</span>
          </div>
          {!retryable && <p className="hp-muted">{t('hosted.operator.signups.writeYourself')}</p>}
          <CopyField label={t('hosted.operator.signups.emailLabel')} value={email} />
        </>
      )}
      {run.failure && <StepUpFailureBanner failure={run.failure} />}
      <span className="hp-passkey-actions">
        <Button type="button" variant="secondary" size="sm" onClick={onDone}>
          {t('hosted.operator.signups.done')}
        </Button>
        {state === 'approvedMailFailed' && retryable && (
          <Button type="button" size="sm" isLoading={run.busy} keepLabelWhileLoading onClick={() => void sendAgain()}>
            {sendLabel}
          </Button>
        )}
      </span>
    </li>
  );
}
