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
        <div key={toast.id} className="toast" role="status" aria-live="polite">
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
