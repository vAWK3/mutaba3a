import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { createPortalQueryClient, isClosingRefusal, isLapseRefusal } from '../queryClient';
import { ME_KEY } from '../session/me';

/** MUT-361: a lapse-gate refusal anywhere makes the portal read /v1/me again, so the gate's UI takes over. */
describe('the portal query client and the lapse gate', () => {
  const lapsed = new ApiError(402, 'SUBSCRIPTION_LAPSED', 'read-only', { profileId: 'p', state: 'READ_ONLY', source: 'TRIAL', until: null });

  it('recognises only SUBSCRIPTION_LAPSED', () => {
    expect(isLapseRefusal(lapsed)).toBe(true);
    expect(isLapseRefusal(new ApiError(403, 'READ_ONLY_PROFILE', 'nope'))).toBe(false);
    expect(isLapseRefusal(new Error('x'))).toBe(false);
  });

  it('invalidates /v1/me after a refused write, and not after any other failure', async () => {
    const client = createPortalQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(lapsed) }).execute(undefined).catch(() => undefined);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_KEY }, { cancelRefetch: false });
    invalidate.mockClear();
    await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(new ApiError(422, 'VALIDATION_FAILED', 'bad')) }).execute(undefined).catch(() => undefined);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('invalidates /v1/me after a refused read (a profile that just locked)', async () => {
    const client = createPortalQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await client.fetchQuery({ queryKey: ['p', 'x', 'expenses'], queryFn: () => Promise.reject(lapsed) }).catch(() => undefined);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_KEY }, { cancelRefetch: false });
  });
});

/** MUT-333: the account closed elsewhere (another tab, the phone): /v1/me is read again, so the closing page takes over. */
describe('the portal query client and a closing account', () => {
  it('invalidates /v1/me after a 403 ACCOUNT_CLOSING', async () => {
    const client = createPortalQueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const closing = new ApiError(403, 'ACCOUNT_CLOSING', 'closing', { deleteAfter: '2026-12-01T09:00:00.000Z' });
    expect(isClosingRefusal(closing)).toBe(true);
    expect(isClosingRefusal(new ApiError(403, 'CURRENT_PASSWORD_WRONG', 'nope'))).toBe(false);
    await client.fetchQuery({ queryKey: ['p', 'x', 'expenses'], queryFn: () => Promise.reject(closing) }).catch(() => undefined);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ME_KEY }, { cancelRefetch: false });
  });
});
