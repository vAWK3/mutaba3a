/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertIcon, InfoIcon } from './Icons';

/**
 * One transient message at a time. Failures the person should act on are
 * announced with `role="alert"`, as before. MUT-133 adds a quiet `info` tone for
 * "Saved · …" after an income write, so a save whose row lands off screen is
 * never silent (design review 3A). Its live region is rendered empty from the
 * start and only filled: a live region inserted on demand is often not
 * announced (eng re-review A2). It carries `aria-live="polite"` rather than
 * `role="status"`, so an empty region is not a status landmark (the MUT-43
 * auth-state tests assert none is present while a session is checked). The second argument is an options object,
 * the shape MUT-91 builds on (it adds an action), so callers that pass only a
 * message keep the error tone.
 */

const TOAST_MS = 6000;

export type ToastTone = 'error' | 'info';
export interface ToastAction {
  label: string;
  onAction: () => void;
}
export interface ToastOptions {
  tone?: ToastTone;
  /** MUT-268: one button (Undo, Retry). Using it closes the toast; hovering or focusing the toast holds it open. */
  action?: ToastAction;
  /** MUT-338: overrides the tone's default icon (e.g. SaveFeedbackIcon instead of InfoIcon). None by default. */
  icon?: ReactNode;
}
export type ShowToast = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

interface ToastState {
  message: string;
  tone: ToastTone;
  action?: ToastAction;
  icon?: ReactNode;
  /** Bumped on every show, so an identical second message re-renders and is announced again. */
  id: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const startTimer = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  const show = useCallback<ShowToast>(
    (message, options) => {
      setToast((current) => ({
        message,
        tone: options?.tone ?? 'error',
        action: options?.action,
        icon: options?.icon,
        id: (current?.id ?? 0) + 1,
      }));
      startTimer();
    },
    [startTimer],
  );

  useEffect(() => () => clearTimeout(timer.current), []);

  const info = toast?.tone === 'info' ? toast : null;
  // While the pointer or focus is on a toast with an action, it stays (craft spec 2: until the next action).
  const hold = { onPointerEnter: () => clearTimeout(timer.current), onPointerLeave: startTimer, onFocus: () => clearTimeout(timer.current), onBlur: startTimer };
  const actionButton = (current: ToastState) =>
    current.action && (
      <button
        type="button"
        className="hp-link-button press hp-toast-action"
        onClick={() => {
          setToast(null);
          current.action?.onAction();
        }}
      >
        {current.action.label}
      </button>
    );

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast?.tone === 'error' && (
        <div className="hp-toast" role="alert" {...hold}>
          <AlertIcon />
          <span>{toast.message}</span>
          {actionButton(toast)}
        </div>
      )}
      <div className={info ? 'hp-toast hp-toast-info' : 'sr-only'} aria-live="polite" aria-atomic="true" data-testid="toast-live" {...hold}>
        {info && (
          <>
            {info.icon ?? <InfoIcon />}
            <span key={info.id}>{info.message}</span>
            {actionButton(info)}
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
