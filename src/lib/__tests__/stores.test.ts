import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useDrawerStore, useFilterStore } from '../stores';

describe('useDrawerStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    act(() => {
      useDrawerStore.setState({
        incomeDrawer: { isOpen: false, mode: 'create' },
        transactionDrawer: { isOpen: false, mode: 'create' },
        clientDrawer: { isOpen: false, mode: 'create' },
        projectDrawer: { isOpen: false, mode: 'create' },
        documentDrawer: { isOpen: false, mode: 'create' },
        businessProfileDrawer: { isOpen: false, mode: 'create' },
        expenseDrawer: { isOpen: false, mode: 'create' },
        retainerDrawer: { isOpen: false, mode: 'create' },
        retainerMatchingDrawer: { isOpen: false, step: 'select-transaction' },
        dayDetailDrawer: { isOpen: false },
        partialPaymentDrawer: { isOpen: false },
        selectedRetainerId: undefined,
      });
    });
  });

  describe('incomeDrawer', () => {
    it('should open income drawer with default options', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer();
      });

      const state = useDrawerStore.getState();
      expect(state.incomeDrawer.isOpen).toBe(true);
      expect(state.incomeDrawer.mode).toBe('create');
    });

    it('should open income drawer in edit mode', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer({ mode: 'edit', transactionId: 'tx-1' });
      });

      const state = useDrawerStore.getState();
      expect(state.incomeDrawer.isOpen).toBe(true);
      expect(state.incomeDrawer.mode).toBe('edit');
      expect(state.incomeDrawer.transactionId).toBe('tx-1');
    });

    it('should open income drawer with default status', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer({ defaultStatus: 'invoiced' });
      });

      const state = useDrawerStore.getState();
      expect(state.incomeDrawer.defaultStatus).toBe('invoiced');
    });

    it('should open income drawer with prefilled client and project', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer({
          defaultClientId: 'client-1',
          defaultProjectId: 'project-1',
          defaultProfileId: 'profile-1',
        });
      });

      const state = useDrawerStore.getState();
      expect(state.incomeDrawer.defaultClientId).toBe('client-1');
      expect(state.incomeDrawer.defaultProjectId).toBe('project-1');
      expect(state.incomeDrawer.defaultProfileId).toBe('profile-1');
    });

    it('should open income drawer for duplication', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer({ duplicateFromId: 'tx-orig' });
      });

      expect(useDrawerStore.getState().incomeDrawer.duplicateFromId).toBe('tx-orig');
    });

    it('should close income drawer', () => {
      act(() => {
        useDrawerStore.getState().openIncomeDrawer();
      });
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(true);

      act(() => {
        useDrawerStore.getState().closeIncomeDrawer();
      });
      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
      expect(useDrawerStore.getState().incomeDrawer.mode).toBe('create');
    });
  });

  describe('transactionDrawer (legacy alias)', () => {
    it('should open transaction drawer and map to income drawer', () => {
      act(() => {
        useDrawerStore.getState().openTransactionDrawer({ mode: 'edit', transactionId: 'tx-1' });
      });

      // Should update incomeDrawer state
      const state = useDrawerStore.getState();
      expect(state.incomeDrawer.isOpen).toBe(true);
      expect(state.incomeDrawer.transactionId).toBe('tx-1');
    });

    it('should map defaultKind income to earned status', () => {
      act(() => {
        useDrawerStore.getState().openTransactionDrawer({ defaultKind: 'income' });
      });

      expect(useDrawerStore.getState().incomeDrawer.defaultStatus).toBe('earned');
    });

    it('should prefer defaultStatus over defaultKind', () => {
      act(() => {
        useDrawerStore.getState().openTransactionDrawer({
          defaultKind: 'income',
          defaultStatus: 'received',
        });
      });

      expect(useDrawerStore.getState().incomeDrawer.defaultStatus).toBe('received');
    });

    it('should close transaction drawer', () => {
      act(() => {
        useDrawerStore.getState().openTransactionDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeTransactionDrawer();
      });

      expect(useDrawerStore.getState().incomeDrawer.isOpen).toBe(false);
    });
  });

  describe('clientDrawer', () => {
    it('should open client drawer with default options', () => {
      act(() => {
        useDrawerStore.getState().openClientDrawer();
      });

      const state = useDrawerStore.getState();
      expect(state.clientDrawer.isOpen).toBe(true);
      expect(state.clientDrawer.mode).toBe('create');
    });

    it('should open client drawer in edit mode', () => {
      act(() => {
        useDrawerStore.getState().openClientDrawer({ mode: 'edit', clientId: 'client-1' });
      });

      const state = useDrawerStore.getState();
      expect(state.clientDrawer.mode).toBe('edit');
      expect(state.clientDrawer.clientId).toBe('client-1');
    });

    it('should open client drawer with default profile', () => {
      act(() => {
        useDrawerStore.getState().openClientDrawer({ defaultProfileId: 'profile-1' });
      });

      expect(useDrawerStore.getState().clientDrawer.defaultProfileId).toBe('profile-1');
    });

    it('should close client drawer', () => {
      act(() => {
        useDrawerStore.getState().openClientDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeClientDrawer();
      });

      expect(useDrawerStore.getState().clientDrawer.isOpen).toBe(false);
    });
  });

  describe('projectDrawer', () => {
    it('should open project drawer', () => {
      act(() => {
        useDrawerStore.getState().openProjectDrawer();
      });

      expect(useDrawerStore.getState().projectDrawer.isOpen).toBe(true);
    });

    it('should open project drawer with all options', () => {
      act(() => {
        useDrawerStore.getState().openProjectDrawer({
          mode: 'edit',
          projectId: 'proj-1',
          defaultClientId: 'client-1',
          defaultProfileId: 'profile-1',
        });
      });

      const state = useDrawerStore.getState().projectDrawer;
      expect(state.mode).toBe('edit');
      expect(state.projectId).toBe('proj-1');
      expect(state.defaultClientId).toBe('client-1');
      expect(state.defaultProfileId).toBe('profile-1');
    });

    it('should close project drawer', () => {
      act(() => {
        useDrawerStore.getState().openProjectDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeProjectDrawer();
      });

      expect(useDrawerStore.getState().projectDrawer.isOpen).toBe(false);
    });
  });

  describe('documentDrawer', () => {
    it('should open document drawer', () => {
      act(() => {
        useDrawerStore.getState().openDocumentDrawer();
      });

      expect(useDrawerStore.getState().documentDrawer.isOpen).toBe(true);
    });

    it('should open document drawer with all options', () => {
      act(() => {
        useDrawerStore.getState().openDocumentDrawer({
          mode: 'edit',
          documentId: 'doc-1',
          defaultType: 'invoice',
          defaultClientId: 'client-1',
          defaultBusinessProfileId: 'profile-1',
          refDocumentId: 'ref-doc-1',
        });
      });

      const state = useDrawerStore.getState().documentDrawer;
      expect(state.mode).toBe('edit');
      expect(state.documentId).toBe('doc-1');
      expect(state.defaultType).toBe('invoice');
      expect(state.defaultClientId).toBe('client-1');
      expect(state.defaultBusinessProfileId).toBe('profile-1');
      expect(state.refDocumentId).toBe('ref-doc-1');
    });

    it('should close document drawer', () => {
      act(() => {
        useDrawerStore.getState().openDocumentDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeDocumentDrawer();
      });

      expect(useDrawerStore.getState().documentDrawer.isOpen).toBe(false);
    });
  });

  describe('businessProfileDrawer', () => {
    it('should open business profile drawer', () => {
      act(() => {
        useDrawerStore.getState().openBusinessProfileDrawer();
      });

      expect(useDrawerStore.getState().businessProfileDrawer.isOpen).toBe(true);
    });

    it('should open business profile drawer in edit mode', () => {
      act(() => {
        useDrawerStore.getState().openBusinessProfileDrawer({
          mode: 'edit',
          profileId: 'profile-1',
        });
      });

      const state = useDrawerStore.getState().businessProfileDrawer;
      expect(state.mode).toBe('edit');
      expect(state.profileId).toBe('profile-1');
    });

    it('should close business profile drawer', () => {
      act(() => {
        useDrawerStore.getState().openBusinessProfileDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeBusinessProfileDrawer();
      });

      expect(useDrawerStore.getState().businessProfileDrawer.isOpen).toBe(false);
    });
  });

  describe('expenseDrawer', () => {
    it('should open expense drawer', () => {
      act(() => {
        useDrawerStore.getState().openExpenseDrawer();
      });

      expect(useDrawerStore.getState().expenseDrawer.isOpen).toBe(true);
    });

    it('should open expense drawer with all options', () => {
      act(() => {
        useDrawerStore.getState().openExpenseDrawer({
          mode: 'edit',
          expenseId: 'exp-1',
          recurringRuleId: 'rule-1',
          defaultProfileId: 'profile-1',
          isRecurring: true,
          prefillData: { vendor: 'Test Vendor', amountMinor: 5000 },
          linkReceiptId: 'receipt-1',
        });
      });

      const state = useDrawerStore.getState().expenseDrawer;
      expect(state.mode).toBe('edit');
      expect(state.expenseId).toBe('exp-1');
      expect(state.recurringRuleId).toBe('rule-1');
      expect(state.defaultProfileId).toBe('profile-1');
      expect(state.isRecurring).toBe(true);
      expect(state.prefillData?.vendor).toBe('Test Vendor');
      expect(state.prefillData?.amountMinor).toBe(5000);
      expect(state.linkReceiptId).toBe('receipt-1');
    });

    it('should close expense drawer', () => {
      act(() => {
        useDrawerStore.getState().openExpenseDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeExpenseDrawer();
      });

      expect(useDrawerStore.getState().expenseDrawer.isOpen).toBe(false);
    });
  });

  describe('retainerDrawer', () => {
    it('should open retainer drawer', () => {
      act(() => {
        useDrawerStore.getState().openRetainerDrawer();
      });

      expect(useDrawerStore.getState().retainerDrawer.isOpen).toBe(true);
    });

    it('should open retainer drawer with all options', () => {
      act(() => {
        useDrawerStore.getState().openRetainerDrawer({
          mode: 'edit',
          retainerId: 'ret-1',
          defaultProfileId: 'profile-1',
          defaultClientId: 'client-1',
          defaultProjectId: 'project-1',
        });
      });

      const state = useDrawerStore.getState().retainerDrawer;
      expect(state.mode).toBe('edit');
      expect(state.retainerId).toBe('ret-1');
      expect(state.defaultProfileId).toBe('profile-1');
      expect(state.defaultClientId).toBe('client-1');
      expect(state.defaultProjectId).toBe('project-1');
    });

    it('should close retainer drawer', () => {
      act(() => {
        useDrawerStore.getState().openRetainerDrawer();
      });

      act(() => {
        useDrawerStore.getState().closeRetainerDrawer();
      });

      expect(useDrawerStore.getState().retainerDrawer.isOpen).toBe(false);
    });
  });

  describe('retainerMatchingDrawer', () => {
    it('should open retainer matching drawer', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      const state = useDrawerStore.getState().retainerMatchingDrawer;
      expect(state.isOpen).toBe(true);
      expect(state.step).toBe('select-transaction');
    });

    it('should open retainer matching drawer with options', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer({
          step: 'select-projected',
          transactionId: 'tx-1',
          projectedIncomeId: 'pi-1',
        });
      });

      const state = useDrawerStore.getState().retainerMatchingDrawer;
      expect(state.step).toBe('select-projected');
      expect(state.transactionId).toBe('tx-1');
      expect(state.projectedIncomeId).toBe('pi-1');
    });

    it('should close retainer matching drawer and reset state', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer({
          transactionId: 'tx-1',
          projectedIncomeId: 'pi-1',
        });
      });

      act(() => {
        useDrawerStore.getState().closeRetainerMatchingDrawer();
      });

      const state = useDrawerStore.getState().retainerMatchingDrawer;
      expect(state.isOpen).toBe(false);
      expect(state.transactionId).toBeUndefined();
      expect(state.projectedIncomeId).toBeUndefined();
      expect(state.pendingProjectedId).toBeUndefined();
      expect(state.matchSuccess).toBe(false);
    });

    it('should set retainer matching step', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingStep('select-projected');
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.step).toBe('select-projected');
    });

    it('should clear pending projected when changing step', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
        useDrawerStore.getState().setRetainerMatchingPendingProjected('pi-pending');
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.pendingProjectedId).toBe('pi-pending');

      act(() => {
        useDrawerStore.getState().setRetainerMatchingStep('select-transaction');
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.pendingProjectedId).toBeUndefined();
    });

    it('should set retainer matching transaction', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingTransaction('tx-1');
      });

      const state = useDrawerStore.getState().retainerMatchingDrawer;
      expect(state.transactionId).toBe('tx-1');
      expect(state.step).toBe('select-projected'); // Should auto-advance
    });

    it('should set retainer matching projected income', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingProjectedIncome('pi-1');
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.projectedIncomeId).toBe('pi-1');
    });

    it('should set pending projected ID', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingPendingProjected('pi-pending');
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.pendingProjectedId).toBe('pi-pending');
    });

    it('should clear pending projected ID', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
        useDrawerStore.getState().setRetainerMatchingPendingProjected('pi-pending');
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingPendingProjected(undefined);
      });

      expect(useDrawerStore.getState().retainerMatchingDrawer.pendingProjectedId).toBeUndefined();
    });

    it('should set match success state', () => {
      act(() => {
        useDrawerStore.getState().openRetainerMatchingDrawer();
      });

      act(() => {
        useDrawerStore.getState().setRetainerMatchingSuccess(true, {
          transactionId: 'tx-1',
          projectedId: 'pi-1',
        });
      });

      const state = useDrawerStore.getState().retainerMatchingDrawer;
      expect(state.matchSuccess).toBe(true);
      expect(state.lastMatchedIds).toEqual({ transactionId: 'tx-1', projectedId: 'pi-1' });
      expect(state.pendingProjectedId).toBeUndefined(); // Should be cleared
    });
  });

  describe('selectedRetainerId', () => {
    it('should select a retainer', () => {
      act(() => {
        useDrawerStore.getState().selectRetainer('ret-1');
      });

      expect(useDrawerStore.getState().selectedRetainerId).toBe('ret-1');
    });

    it('should deselect a retainer', () => {
      act(() => {
        useDrawerStore.getState().selectRetainer('ret-1');
      });

      act(() => {
        useDrawerStore.getState().selectRetainer(undefined);
      });

      expect(useDrawerStore.getState().selectedRetainerId).toBeUndefined();
    });
  });

  describe('dayDetailDrawer', () => {
    it('should open day detail drawer', () => {
      act(() => {
        useDrawerStore.getState().openDayDetailDrawer({ date: '2026-03-15' });
      });

      const state = useDrawerStore.getState().dayDetailDrawer;
      expect(state.isOpen).toBe(true);
      expect(state.date).toBe('2026-03-15');
    });

    it('should close day detail drawer', () => {
      act(() => {
        useDrawerStore.getState().openDayDetailDrawer({ date: '2026-03-15' });
      });

      act(() => {
        useDrawerStore.getState().closeDayDetailDrawer();
      });

      const state = useDrawerStore.getState().dayDetailDrawer;
      expect(state.isOpen).toBe(false);
      expect(state.date).toBeUndefined();
    });
  });

  describe('partialPaymentDrawer', () => {
    it('should open partial payment drawer', () => {
      act(() => {
        useDrawerStore.getState().openPartialPaymentDrawer({ transactionId: 'tx-1' });
      });

      const state = useDrawerStore.getState().partialPaymentDrawer;
      expect(state.isOpen).toBe(true);
      expect(state.transactionId).toBe('tx-1');
    });

    it('should close partial payment drawer', () => {
      act(() => {
        useDrawerStore.getState().openPartialPaymentDrawer({ transactionId: 'tx-1' });
      });

      act(() => {
        useDrawerStore.getState().closePartialPaymentDrawer();
      });

      const state = useDrawerStore.getState().partialPaymentDrawer;
      expect(state.isOpen).toBe(false);
      expect(state.transactionId).toBeUndefined();
    });
  });
});

describe('useFilterStore', () => {
  beforeEach(() => {
    act(() => {
      useFilterStore.setState({ currency: undefined });
    });
  });

  it('should set currency filter', () => {
    act(() => {
      useFilterStore.getState().setCurrency('USD');
    });

    expect(useFilterStore.getState().currency).toBe('USD');
  });

  it('should clear currency filter', () => {
    act(() => {
      useFilterStore.getState().setCurrency('USD');
    });

    act(() => {
      useFilterStore.getState().setCurrency(undefined);
    });

    expect(useFilterStore.getState().currency).toBeUndefined();
  });

  it('should change currency filter', () => {
    act(() => {
      useFilterStore.getState().setCurrency('USD');
    });

    act(() => {
      useFilterStore.getState().setCurrency('ILS');
    });

    expect(useFilterStore.getState().currency).toBe('ILS');
  });
});
