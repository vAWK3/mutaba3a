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
export interface ToastOptions {
  tone?: ToastTone;
}
export type ShowToast = (message: string, options?: ToastOptions) => void;

const ToastContext = createContext<ShowToast>(() => {});

interface ToastState {
  message: string;
  tone: ToastTone;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = useCallback<ShowToast>((message, options) => {
    clearTimeout(timer.current);
    setToast({ message, tone: options?.tone ?? 'error' });
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  const info = toast?.tone === 'info' ? toast.message : null;

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast?.tone === 'error' && (
        <div className="hp-toast" role="alert">
          <AlertIcon />
          <span>{toast.message}</span>
        </div>
      )}
      <div className={info ? 'hp-toast hp-toast-info' : 'sr-only'} aria-live="polite" aria-atomic="true" data-testid="toast-live">
        {info && (
          <>
            <InfoIcon />
            <span>{info}</span>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  return useContext(ToastContext);
}
