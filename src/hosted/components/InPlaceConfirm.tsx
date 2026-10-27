/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';

/**
 * DESIGN.md › Destructive confirm (MUT-115 DR7, MUT-417): the control that deletes turns its place into this, never a
 * `window.confirm`. One sentence names the thing and what happens; Cancel takes focus; Escape cancels before it can
 * reach the drawer's document listener. The caller swaps it in for the trigger, and `useConfirmStep` returns focus there.
 *
 * MUT-461 (TD-267): the operator console's in-row confirms build on this one — a message with markup, a slot under it
 * for what went wrong, the primary style for a non-destructive action, the passkey row's look, and a confirm in flight
 * that can't be cancelled.
 */
export interface InPlaceConfirmProps {
  message: ReactNode;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  /** `danger` (the default) deletes or ends something; `primary` confirms an action that doesn't. */
  variant?: 'danger' | 'primary';
  /** `box`: the drawers' tinted confirm. `row`: in a list row, as the passkey rows confirm (smaller buttons). */
  appearance?: 'box' | 'row';
  /** The action keeps its label while busy (the operator's "… with passkey" stays readable). */
  keepLabelWhileLoading?: boolean;
  /** Off: while busy, Cancel is disabled and Escape does nothing, so the answer belongs to this confirm. */
  cancelWhileBusy?: boolean;
  /** Under the message: a refusal or a note in the row. */
  children?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

const APPEARANCE = {
  box: { group: 'hp-confirm hp-confirm-inline', actions: 'hp-confirm-actions', size: 'md' },
  row: { group: 'hp-passkey-confirm', actions: 'hp-passkey-actions', size: 'sm' },
} as const;

export function InPlaceConfirm({
  message,
  cancelLabel,
  confirmLabel,
  busy = false,
  variant = 'danger',
  appearance = 'box',
  keepLabelWhileLoading = false,
  cancelWhileBusy = true,
  children,
  onCancel,
  onConfirm,
}: InPlaceConfirmProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);
  const look = APPEARANCE[appearance];
  const held = busy && !cancelWhileBusy;

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    if (!held) onCancel();
  }

  return (
    <div className={look.group} role="group" aria-labelledby={messageId} onKeyDown={onKeyDown}>
      <p id={messageId}>{message}</p>
      {children}
      <div className={look.actions}>
        <Button ref={cancelRef} type="button" variant="secondary" size={look.size} disabled={held} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant={variant} size={look.size} isLoading={busy} keepLabelWhileLoading={keepLabelWhileLoading} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}

/**
 * Open/closed state for one confirm, and focus back on its trigger when it is cancelled (MUT-115 DR11). Destructure the
 * result: reading a field off the object during render trips react-hooks/refs, because the object holds a ref.
 */
export function useConfirmStep() {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ask = useCallback(() => setOpen(true), []);
  const close = useCallback(() => setOpen(false), []);
  const cancel = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);
  return { open, ask, cancel, close, triggerRef };
}
