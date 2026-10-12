import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: string;
  message: string;
  type?: ToastType;
  action?: ToastAction;
  duration: number;
  /**
   * At most one toast per group shows: a new one replaces the one showing
   * (MUT-82: one Undo at a time). Toasts with no group stack.
   */
  group?: string;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => string;
  removeToast: (id: string) => void;
}

let toastIdCounter = 0;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = `toast-${++toastIdCounter}`;
    set((state) => ({
      toasts: [
        ...state.toasts.filter((shown) => toast.group === undefined || shown.group !== toast.group),
        { ...toast, id },
      ],
    }));
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// Convenience hook for adding toasts. Selects the two actions only, so a
// component that shows toasts doesn't re-render whenever one comes or goes.
export function useToast() {
  const addToast = useToastStore((state) => state.addToast);
  const removeToast = useToastStore((state) => state.removeToast);

  const showToast = (
    message: string,
    options?: { action?: ToastAction; duration?: number; type?: ToastType; group?: string }
  ) => {
    const duration = options?.duration ?? (options?.action ? 5000 : 3000);
    return addToast({ message, type: options?.type, action: options?.action, duration, group: options?.group });
  };

  return { showToast, removeToast };
}
