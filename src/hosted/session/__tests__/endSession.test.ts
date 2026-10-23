import { describe, it, expect, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { AnyRouter } from '@tanstack/react-router';
import { endSession } from '../endSession';
import { useSavedFlashStore } from '../../../lib/savedFlashStore';
import { useMalafatPortalMoments } from '../malafatMoments';
import { useLostAccess } from '../lostAccess';

const { endPortalUsage } = vi.hoisted(() => ({ endPortalUsage: vi.fn() }));
vi.mock('../../analytics/portalAnalytics', () => ({ endPortalUsage }));
const { setReporterUser } = vi.hoisted(() => ({ setReporterUser: vi.fn() }));
vi.mock('../../observability/errorReporting', () => ({ setReporterUser }));

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

  it('MUT-191: the next person in this tab starts with no Malafat moment pending', () => {
    useMalafatPortalMoments.getState().markBusinessCreated('p-1');
    useMalafatPortalMoments.getState().markClientsRetired();
    endSession(new QueryClient(), { navigate: vi.fn() } as unknown as AnyRouter, { reason: 'expired' });
    expect(useMalafatPortalMoments.getState()).toMatchObject({ businessCreatedId: null, clientsRetiredThisVisit: false });
  });

  it('MUT-373: the next person in this tab sees no banner naming a profile someone else lost', () => {
    useLostAccess.getState().remember('p-1', 'Sader & Haddad');
    useLostAccess.getState().lose('Sader & Haddad');
    endSession(new QueryClient(), { navigate: vi.fn() } as unknown as AnyRouter, { reason: 'signed_out' });
    expect(useLostAccess.getState()).toMatchObject({ open: null, lost: null });
  });

  it('MUT-155: sign-out forgets the usage choice and its ID; an expired session keeps them (same person)', () => {
    endPortalUsage.mockClear();
    endSession(new QueryClient(), { navigate: vi.fn() } as unknown as AnyRouter, { reason: 'expired' });
    expect(endPortalUsage).not.toHaveBeenCalled();
    endSession(new QueryClient(), { navigate: vi.fn() } as unknown as AnyRouter, { reason: 'signed_out' });
    expect(endPortalUsage).toHaveBeenCalledOnce();
  });

  it.each(['expired', 'signed_out'] as const)('MUT-149: crash reports stop naming the person once the session ends (%s)', (reason) => {
    setReporterUser.mockClear();
    endSession(new QueryClient(), { navigate: vi.fn() } as unknown as AnyRouter, { reason });
    expect(setReporterUser).toHaveBeenCalledWith(null);
  });
});
