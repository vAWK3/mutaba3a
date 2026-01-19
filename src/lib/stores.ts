import { create } from 'zustand';
import type { Currency, TxKind, DocumentType, Currency as CurrencyType } from '../types';

// Expense drawer prefill data type
export interface ExpensePrefillData {
  vendor?: string;
  vendorId?: string;
  amountMinor?: number;
  currency?: CurrencyType;
  occurredAt?: string;
  title?: string;
  categoryId?: string;
}

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
    duplicateFromId?: string;
  };
  openTransactionDrawer: (options?: {
    mode?: 'create' | 'edit';
    transactionId?: string;
    defaultKind?: TxKind;
    defaultClientId?: string;
    defaultProjectId?: string;
    duplicateFromId?: string;
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

  // Document drawer
  documentDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    documentId?: string;
    defaultType?: DocumentType;
    defaultClientId?: string;
    defaultBusinessProfileId?: string;
    refDocumentId?: string; // For credit notes
  };
  openDocumentDrawer: (options?: {
    mode?: 'create' | 'edit';
    documentId?: string;
    defaultType?: DocumentType;
    defaultClientId?: string;
    defaultBusinessProfileId?: string;
    refDocumentId?: string;
  }) => void;
  closeDocumentDrawer: () => void;

  // Business Profile drawer
  businessProfileDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    profileId?: string;
  };
  openBusinessProfileDrawer: (options?: { mode?: 'create' | 'edit'; profileId?: string }) => void;
  closeBusinessProfileDrawer: () => void;

  // Expense drawer
  expenseDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    expenseId?: string;
    recurringRuleId?: string;
    defaultProfileId?: string;
    isRecurring?: boolean;
    prefillData?: ExpensePrefillData;
    linkReceiptId?: string;
  };
  openExpenseDrawer: (options?: {
    mode?: 'create' | 'edit';
    expenseId?: string;
    recurringRuleId?: string;
    defaultProfileId?: string;
    isRecurring?: boolean;
    prefillData?: ExpensePrefillData;
    linkReceiptId?: string;
  }) => void;
  closeExpenseDrawer: () => void;
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
        duplicateFromId: options?.duplicateFromId,
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

  documentDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openDocumentDrawer: (options) =>
    set({
      documentDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        documentId: options?.documentId,
        defaultType: options?.defaultType,
        defaultClientId: options?.defaultClientId,
        defaultBusinessProfileId: options?.defaultBusinessProfileId,
        refDocumentId: options?.refDocumentId,
      },
    }),
  closeDocumentDrawer: () =>
    set({
      documentDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  businessProfileDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openBusinessProfileDrawer: (options) =>
    set({
      businessProfileDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        profileId: options?.profileId,
      },
    }),
  closeBusinessProfileDrawer: () =>
    set({
      businessProfileDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  expenseDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openExpenseDrawer: (options) =>
    set({
      expenseDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        expenseId: options?.expenseId,
        recurringRuleId: options?.recurringRuleId,
        defaultProfileId: options?.defaultProfileId,
        isRecurring: options?.isRecurring,
        prefillData: options?.prefillData,
        linkReceiptId: options?.linkReceiptId,
      },
    }),
  closeExpenseDrawer: () =>
    set({
      expenseDrawer: {
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
