import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { endSession } from '../endSession';
import { useSavedFlashStore } from '../../../lib/savedFlashStore';

/** E1–E3: ending a session drops every cached figure; MUT-91 adds the after-save store to that set. */
describe('endSession', () => {
  it('clears the query cache and any pending after-save, then goes to sign-in', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['p', 'x', 'expenses'], { pages: [] });
    useSavedFlashStore.getState().markSaved({ kind: 'expense', ids: ['e-1'], profileId: 'p-1' });
    const navigate = vi.fn();
    endSession(queryClient, { navigate } as unknown as AnyRouter, { reason: 'expired' });
    expect(queryClient.getQueryCache().getAll()).toEqual([]);
    expect(useSavedFlashStore.getState().pending).toBeNull();
    expect(navigate).toHaveBeenCalledWith({ to: '/sign-in', search: { reason: 'expired' }, replace: true });
  });
});
