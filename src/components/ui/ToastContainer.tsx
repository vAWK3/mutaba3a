import { useEffect, useRef } from 'react';
import { useToastStore } from '../../lib/toastStore';
import './Toast.css';

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    // Set up timers for new toasts
    toasts.forEach((toast) => {
      if (!timersRef.current.has(toast.id) && toast.duration > 0) {
        const timer = setTimeout(() => {
          removeToast(toast.id);
          timersRef.current.delete(toast.id);
        }, toast.duration);
        timersRef.current.set(toast.id, timer);
      }
    });

    // Clean up timers for removed toasts
    timersRef.current.forEach((timer, id) => {
      if (!toasts.find((t) => t.id === id)) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    });
  }, [toasts, removeToast]);

  // Clean up all timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast${toast.type === 'error' ? ' toast-error' : ''}`} role="status" aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
          {toast.type === 'error' && (
            <svg className="toast-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5"/>
              <line x1="8" y1="4.5" x2="8" y2="8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <circle cx="8" cy="11" r="0.75" fill="currentColor"/>
            </svg>
          )}
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                toast.action?.onClick();
                removeToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
