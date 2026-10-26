/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Button } from '../../components/ui/Button';

/**
 * DESIGN.md › Destructive confirm (MUT-115 DR7, MUT-417): the control that deletes turns its place into this, never a
 * `window.confirm`. One sentence names the thing and what happens; Cancel takes focus; Escape cancels before it can
 * reach the drawer's document listener. The caller swaps it in for the trigger, and `useConfirmStep` returns focus there.
 */
export interface InPlaceConfirmProps {
  message: string;
  cancelLabel: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function InPlaceConfirm({ message, cancelLabel, confirmLabel, busy = false, onCancel, onConfirm }: InPlaceConfirmProps) {
  const messageId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => cancelRef.current?.focus(), []);

  function onKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onCancel();
  }

  return (
    <div className="hp-confirm hp-confirm-inline" role="group" aria-labelledby={messageId} onKeyDown={onKeyDown}>
      <p id={messageId}>{message}</p>
      <div className="hp-confirm-actions">
        <Button ref={cancelRef} type="button" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button type="button" variant="danger" isLoading={busy} onClick={onConfirm}>
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
