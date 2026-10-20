import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { useToastStore, type Toast } from '../../lib/toastStore';
import './Toast.css';

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={removeToast} />
      ))}
    </div>
  );
}

/**
 * Counts down a toast's duration, but not while `paused`; a pause keeps the
 * time that was left (MUT-82). Each run of the effect is one stretch of
 * counting, and its cleanup takes the elapsed time off what remains.
 */
function useDismissTimer(duration: number, paused: boolean, onDismiss: () => void) {
  const remaining = useRef(duration);
  const dismiss = useRef(onDismiss);
  useEffect(() => {
    dismiss.current = onDismiss;
  });

  useEffect(() => {
    if (paused || duration <= 0) return;
    const startedAt = Date.now();
    const timer = setTimeout(() => dismiss.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - startedAt;
    };
  }, [paused, duration]);
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  // A toast waits while the pointer is over it or focus is inside it, so an
  // action such as Undo can't vanish under the person reaching for it
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  useDismissTimer(toast.duration, hovered || focused, () => onDismiss(toast.id));

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
  };

  return (
    <div
      className={`toast${toast.type === 'error' ? ' toast-error' : ''}`}
      role="status"
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={onBlur}
    >
      {toast.type === 'error' && (
        <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
          <line x1="8" y1="4.5" x2="8" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <circle cx="8" cy="11" r="0.75" fill="currentColor"/>
        </svg>
      )}
      {toast.icon && <span className="toast-icon">{toast.icon}</span>}
      <span className="toast-message">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
