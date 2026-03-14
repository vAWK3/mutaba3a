import { create } from 'zustand';
import type { Currency, TxKind, DocumentType, Currency as CurrencyType } from '../types';

// Income status for the income drawer (Earned/Invoiced/Received)
export type IncomeStatus = 'earned' | 'invoiced' | 'received';

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
  // Income drawer (formerly TransactionDrawer)
  incomeDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    transactionId?: string;
    defaultStatus?: IncomeStatus;
    defaultClientId?: string;
    defaultProjectId?: string;
    defaultProfileId?: string;
    duplicateFromId?: string;
  };
  openIncomeDrawer: (options?: {
    mode?: 'create' | 'edit';
    transactionId?: string;
    defaultStatus?: IncomeStatus;
    defaultClientId?: string;
    defaultProjectId?: string;
    defaultProfileId?: string;
    duplicateFromId?: string;
  }) => void;
  closeIncomeDrawer: () => void;

  // Legacy alias for TransactionDrawer (backwards compatibility)
  transactionDrawer: DrawerState['incomeDrawer'];
  openTransactionDrawer: (options?: {
    mode?: 'create' | 'edit';
    transactionId?: string;
    defaultKind?: TxKind;  // Legacy: maps to defaultStatus
    defaultStatus?: IncomeStatus;  // New: directly set status
    defaultClientId?: string;
    defaultProjectId?: string;
    defaultProfileId?: string;
    duplicateFromId?: string;
  }) => void;
  closeTransactionDrawer: DrawerState['closeIncomeDrawer'];

  // Client drawer
  clientDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    clientId?: string;
    defaultProfileId?: string;
  };
  openClientDrawer: (options?: { mode?: 'create' | 'edit'; clientId?: string; defaultProfileId?: string }) => void;
  closeClientDrawer: () => void;

  // Project drawer
  projectDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    projectId?: string;
    defaultClientId?: string;
    defaultProfileId?: string;
  };
  openProjectDrawer: (options?: { mode?: 'create' | 'edit'; projectId?: string; defaultClientId?: string; defaultProfileId?: string }) => void;
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

  // Retainer drawer
  retainerDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    retainerId?: string;
    defaultProfileId?: string;
    defaultClientId?: string;
    defaultProjectId?: string;
  };
  openRetainerDrawer: (options?: {
    mode?: 'create' | 'edit';
    retainerId?: string;
    defaultProfileId?: string;
    defaultClientId?: string;
    defaultProjectId?: string;
  }) => void;
  closeRetainerDrawer: () => void;

  // Retainer matching drawer
  retainerMatchingDrawer: {
    isOpen: boolean;
    step: 'select-transaction' | 'select-projected';
    transactionId?: string;
    projectedIncomeId?: string;
    // Confirmation flow state
    pendingProjectedId?: string; // Selected but not yet confirmed
    matchSuccess?: boolean; // Show success state
    lastMatchedIds?: { transactionId: string; projectedId: string }; // For undo
  };
  openRetainerMatchingDrawer: (options?: {
    step?: 'select-transaction' | 'select-projected';
    transactionId?: string;
    projectedIncomeId?: string;
  }) => void;
  closeRetainerMatchingDrawer: () => void;
  setRetainerMatchingStep: (step: 'select-transaction' | 'select-projected') => void;
  setRetainerMatchingTransaction: (transactionId: string) => void;
  setRetainerMatchingProjectedIncome: (projectedIncomeId: string) => void;
  setRetainerMatchingPendingProjected: (projectedId: string | undefined) => void;
  setRetainerMatchingSuccess: (success: boolean, ids?: { transactionId: string; projectedId: string }) => void;

  // Selected retainer for inspector panel
  selectedRetainerId?: string;
  selectRetainer: (id?: string) => void;

  // Day detail drawer (Money Answers page)
  dayDetailDrawer: {
    isOpen: boolean;
    date?: string;
  };
  openDayDetailDrawer: (options: { date: string }) => void;
  closeDayDetailDrawer: () => void;

  // Partial payment drawer
  partialPaymentDrawer: {
    isOpen: boolean;
    transactionId?: string;
  };
  openPartialPaymentDrawer: (options: { transactionId: string }) => void;
  closePartialPaymentDrawer: () => void;

  // Plan assumption drawer (Financial Planning)
  planAssumptionDrawer: {
    isOpen: boolean;
    mode: 'create' | 'edit';
    planId?: string;
    assumptionId?: string;
    defaultCategory?: 'revenue' | 'expense' | 'funding' | 'hiring' | 'other';
    defaultProfileId?: string;
  };
  openPlanAssumptionDrawer: (options?: {
    mode?: 'create' | 'edit';
    planId?: string;
    assumptionId?: string;
    defaultCategory?: 'revenue' | 'expense' | 'funding' | 'hiring' | 'other';
    defaultProfileId?: string;
  }) => void;
  closePlanAssumptionDrawer: () => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  // Income drawer (formerly TransactionDrawer)
  incomeDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openIncomeDrawer: (options) =>
    set({
      incomeDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        transactionId: options?.transactionId,
        defaultStatus: options?.defaultStatus,
        defaultClientId: options?.defaultClientId,
        defaultProjectId: options?.defaultProjectId,
        defaultProfileId: options?.defaultProfileId,
        duplicateFromId: options?.duplicateFromId,
      },
    }),
  closeIncomeDrawer: () =>
    set({
      incomeDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  // Legacy aliases (backwards compatibility during migration)
  // These forward to income drawer - consumers should migrate to incomeDrawer
  transactionDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openTransactionDrawer: (options) => {
    // Map old defaultKind to new defaultStatus, or use defaultStatus directly if provided
    const defaultStatus = options?.defaultStatus
      ?? (options?.defaultKind === 'income' ? 'earned' : undefined);
    set({
      incomeDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        transactionId: options?.transactionId,
        defaultStatus: defaultStatus as IncomeStatus | undefined,
        defaultClientId: options?.defaultClientId,
        defaultProjectId: options?.defaultProjectId,
        defaultProfileId: options?.defaultProfileId,
        duplicateFromId: options?.duplicateFromId,
      },
    });
  },
  closeTransactionDrawer: () =>
    set({
      incomeDrawer: {
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
        defaultProfileId: options?.defaultProfileId,
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
        defaultProfileId: options?.defaultProfileId,
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

  // Retainer drawer
  retainerDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openRetainerDrawer: (options) =>
    set({
      retainerDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        retainerId: options?.retainerId,
        defaultProfileId: options?.defaultProfileId,
        defaultClientId: options?.defaultClientId,
        defaultProjectId: options?.defaultProjectId,
      },
    }),
  closeRetainerDrawer: () =>
    set({
      retainerDrawer: {
        isOpen: false,
        mode: 'create',
      },
    }),

  // Retainer matching drawer
  retainerMatchingDrawer: {
    isOpen: false,
    step: 'select-transaction',
  },
  openRetainerMatchingDrawer: (options) =>
    set({
      retainerMatchingDrawer: {
        isOpen: true,
        step: options?.step || 'select-transaction',
        transactionId: options?.transactionId,
        projectedIncomeId: options?.projectedIncomeId,
        pendingProjectedId: undefined,
        matchSuccess: false,
        lastMatchedIds: undefined,
      },
    }),
  closeRetainerMatchingDrawer: () =>
    set({
      retainerMatchingDrawer: {
        isOpen: false,
        step: 'select-transaction',
        transactionId: undefined,
        projectedIncomeId: undefined,
        pendingProjectedId: undefined,
        matchSuccess: false,
        lastMatchedIds: undefined,
      },
    }),
  setRetainerMatchingStep: (step) =>
    set((state) => ({
      retainerMatchingDrawer: {
        ...state.retainerMatchingDrawer,
        step,
        pendingProjectedId: undefined, // Clear pending when going back
      },
    })),
  setRetainerMatchingTransaction: (transactionId) =>
    set((state) => ({
      retainerMatchingDrawer: {
        ...state.retainerMatchingDrawer,
        transactionId,
        step: 'select-projected',
        pendingProjectedId: undefined,
      },
    })),
  setRetainerMatchingProjectedIncome: (projectedIncomeId) =>
    set((state) => ({
      retainerMatchingDrawer: {
        ...state.retainerMatchingDrawer,
        projectedIncomeId,
      },
    })),
  setRetainerMatchingPendingProjected: (projectedId) =>
    set((state) => ({
      retainerMatchingDrawer: {
        ...state.retainerMatchingDrawer,
        pendingProjectedId: projectedId,
      },
    })),
  setRetainerMatchingSuccess: (success, ids) =>
    set((state) => ({
      retainerMatchingDrawer: {
        ...state.retainerMatchingDrawer,
        matchSuccess: success,
        lastMatchedIds: ids,
        pendingProjectedId: undefined,
      },
    })),

  // Selected retainer for inspector panel
  selectedRetainerId: undefined,
  selectRetainer: (id) => set({ selectedRetainerId: id }),

  // Day detail drawer (Money Answers page)
  dayDetailDrawer: {
    isOpen: false,
  },
  openDayDetailDrawer: (options) =>
    set({
      dayDetailDrawer: {
        isOpen: true,
        date: options.date,
      },
    }),
  closeDayDetailDrawer: () =>
    set({
      dayDetailDrawer: {
        isOpen: false,
        date: undefined,
      },
    }),

  // Partial payment drawer
  partialPaymentDrawer: {
    isOpen: false,
  },
  openPartialPaymentDrawer: (options) =>
    set({
      partialPaymentDrawer: {
        isOpen: true,
        transactionId: options.transactionId,
      },
    }),
  closePartialPaymentDrawer: () =>
    set({
      partialPaymentDrawer: {
        isOpen: false,
        transactionId: undefined,
      },
    }),

  // Plan assumption drawer (Financial Planning)
  planAssumptionDrawer: {
    isOpen: false,
    mode: 'create',
  },
  openPlanAssumptionDrawer: (options) =>
    set({
      planAssumptionDrawer: {
        isOpen: true,
        mode: options?.mode || 'create',
        planId: options?.planId,
        assumptionId: options?.assumptionId,
        defaultCategory: options?.defaultCategory,
        defaultProfileId: options?.defaultProfileId,
      },
    }),
  closePlanAssumptionDrawer: () =>
    set({
      planAssumptionDrawer: {
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
