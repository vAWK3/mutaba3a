/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { useT } from '../../lib/i18n/core';
import { Button } from '../../components/ui/Button';
import { AlertIcon } from '../components/Icons';
import { isStepUpFresh, runOperatorAction, type OperatorActionOutcome, type StepUpFailure } from './stepUp';

/**
 * MUT-460 (ADR-213, design 1A, 10A, 11A): the operator console's step-up, as the pages use it.
 *
 * - `OperatorStepUpProvider` (the operator layout) remembers a step-up made on this page, so a second action within
 *   the window acts directly even before the list is read again.
 * - `useOperatorRun` runs one action: straight away while fresh, after the passkey sheet when stale, and offers
 *   "Confirm with passkey" after a 403. It keeps the busy flag and the failure to show.
 * - `OperatorConfirm` is the in-row confirm (the passkey row's recipe): Cancel focused, Escape cancels, failures in
 *   the row.
 */
const StepUpContext = createContext<{ until: string | null; note: (until: string) => void }>({ until: null, note: () => {} });

export function OperatorStepUpProvider({ children }: { children: ReactNode }) {
  const [until, setUntil] = useState<string | null>(null);
  return <StepUpContext.Provider value={{ until, note: setUntil }}>{children}</StepUpContext.Provider>;
}

/** The window as the server last answered on this page: lapsed after a 403. */
const LAPSED = new Date(0).toISOString();

export type RunFailure = Exclude<StepUpFailure, 'cancelled'>;

export function useOperatorRun(serverUntil: string | null) {
  const stepUp = useContext(StepUpContext);
  const [forcePasskey, setForcePasskey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<RunFailure | null>(null);
  // Read at render, as the billing row reads today: a window that lapses while the confirm is open meets the 403 path.
  // What this page learned since the list was read (its own step-up, or a 403) is newer than the list's `stepUpUntil`.
  const fresh = isStepUpFresh(stepUp.until ?? serverUntil, new Date());

  /** Runs `action`; resolves with its value, or null when it didn't run (the row already shows why). Other refusals throw. */
  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true);
      setFailure(null);
      let outcome: OperatorActionOutcome<T>;
      try {
        outcome = await runOperatorAction(action, { withPasskey: forcePasskey || !fresh, onSteppedUp: stepUp.note });
      } finally {
        setBusy(false);
      }
      switch (outcome.kind) {
        case 'done':
          setForcePasskey(false);
          return outcome.value;
        case 'needsPasskey':
          // The server closed the window: every row now reads "with passkey", not just this one.
          stepUp.note(LAPSED);
          setForcePasskey(true);
          return null;
        case 'stepUpFailed':
          if (outcome.reason !== 'cancelled') setFailure(outcome.reason);
          return null;
        case 'error':
          throw outcome.error;
      }
    },
    [forcePasskey, fresh, stepUp],
  );

  /** Cancel: no failure, and no "Confirm with passkey" left over from a 403 (the label follows freshness again). */
  const clear = useCallback(() => {
    setFailure(null);
    setForcePasskey(false);
  }, []);
  /** What the action button says: as is, "… with passkey" when stale, "Confirm with passkey" after a 403. */
  const label = forcePasskey ? 'confirm' : fresh ? 'plain' : 'passkey';
  return { run, busy, failure, setFailure, clear, label } as const;
}

/** 10A: a failed step-up, in the row. A passkey on another device works through the browser's QR option. */
export function StepUpFailureBanner({ failure }: { failure: RunFailure }) {
  const t = useT();
  return (
    <div className="hp-banner hp-banner-error" role="alert">
      <AlertIcon />
      <span>
        {failure === 'refused' && (
          <>
            {t('hosted.operator.stepUp.refused')} {t('hosted.operator.stepUp.otherDevice')}
          </>
        )}
        {failure === 'noPasskey' && (
          <>
            {t('hosted.operator.stepUp.noPasskey')}{' '}
            <Link to="/you/account" search={{ passkeys: true }}>
              {t('hosted.operator.stepUp.addPasskey')}
            </Link>
          </>
        )}
        {failure === 'failed' && t('hosted.operator.failed')}
      </span>
    </div>
  );
}

interface OperatorConfirmProps {
  text: ReactNode;
  /** The action's three labels: as is, with passkey (stale), and the 403 fallback is the shared "Confirm with passkey". */
  labels: { plain: string; passkey: string };
  variant: 'primary' | 'danger';
  run: ReturnType<typeof useOperatorRun>;
  /** Extra message from the caller's own error mapping (a 409 it understood). */
  error?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function OperatorConfirm({ text, labels, variant, run, error, onConfirm, onCancel }: OperatorConfirmProps) {
  const t = useT();
  const id = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    // A decision in flight finishes first: its answer belongs to this confirm.
    if (!run.busy) onCancel();
  }

  const label = run.label === 'confirm' ? t('hosted.operator.stepUp.confirmWithPasskey') : run.label === 'passkey' ? labels.passkey : labels.plain;
  return (
    <div className="hp-passkey-confirm" role="group" aria-labelledby={`${id}-text`} onKeyDown={onKeyDown}>
      <p id={`${id}-text`}>{text}</p>
      {run.failure && <StepUpFailureBanner failure={run.failure} />}
      {error}
      <div className="hp-passkey-actions">
        <Button ref={cancelRef} type="button" variant="secondary" size="sm" disabled={run.busy} onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button type="button" variant={variant} size="sm" isLoading={run.busy} keepLabelWhileLoading onClick={onConfirm}>
          {label}
        </Button>
      </div>
    </div>
  );
}
