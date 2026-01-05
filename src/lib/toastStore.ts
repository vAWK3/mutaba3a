import { create } from 'zustand';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  message: string;
  action?: ToastAction;
  duration: number;
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
      toasts: [...state.toasts, { ...toast, id }],
    }));
    return id;
  },

  removeToast: (id) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },
}));

// Convenience hook for adding toasts
export function useToast() {
  const { addToast, removeToast } = useToastStore();

  const showToast = (
    message: string,
    options?: { action?: ToastAction; duration?: number }
  ) => {
    const duration = options?.duration ?? (options?.action ? 5000 : 3000);
    return addToast({ message, action: options?.action, duration });
  };

  return { showToast, removeToast };
}
