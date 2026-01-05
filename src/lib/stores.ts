import { create } from 'zustand';
import type { Currency, TxKind } from '../types';

// Drawer state
interface DrawerState {
  // Transaction drawer
  transactionDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    transactionId?: string;
    defaultKind?: TxKind;
    defaultClientId?: string;
    defaultProjectId?: string;
  };
  openTransactionDrawer: (options?: {
    mode?: 'create' | 'edit';
    transactionId?: string;
    defaultKind?: TxKind;
    defaultClientId?: string;
    defaultProjectId?: string;
  }) => void;
  closeTransactionDrawer: () => void;

  // Client drawer
  clientDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    clientId?: string;
  };
  openClientDrawer: (options?: { mode?: 'create' | 'edit'; clientId?: string }) => void;
  closeClientDrawer: () => void;

  // Project drawer
  projectDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    projectId?: string;
    defaultClientId?: string;
  };
  openProjectDrawer: (options?: { mode?: 'create' | 'edit'; projectId?: string; defaultClientId?: string }) => void;
  closeProjectDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  transactionDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openTransactionDrawer: (options) =>
    set({
      transactionDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        transactionId: options?.transactionId,
        defaultKind: options?.defaultKind,
        defaultClientId: options?.defaultClientId,
        defaultProjectId: options?.defaultProjectId,
      },
    }),
  closeTransactionDrawer: () =>
    set({
      transactionDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  clientDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openClientDrawer: (options) =>
    set({
      clientDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        clientId: options?.clientId,
      },
    }),
  closeClientDrawer: () =>
    set({
      clientDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  projectDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openProjectDrawer: (options) =>
    set({
      projectDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        projectId: options?.projectId,
        defaultClientId: options?.defaultClientId,
      },
    }),
  closeProjectDrawer: () =>
    set({
      projectDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),
}));

// Global filters state (for pages that share filter state)
interface FilterState {
  currency?: Currency;
  setCurrency: (currency?: Currency) => void;
}

export const useFilterStore = create<FilterState>((set) => ({
  currency: undefined,
  setCurrency: (currency) => set({ currency }),
}));
