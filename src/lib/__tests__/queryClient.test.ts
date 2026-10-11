import { describe, it, expect, afterEach } from 'vitest';
import { MutationObserver, onlineManager } from '@tanstack/react-query';
import { createAppQueryClient } from '../queryClient';

const SETTLE_MS = 500;

/** Rejects if the promise has not settled in time: a paused query or mutation never does. */
function settlesSoon<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('still paused')), SETTLE_MS)),
  ]);
}

describe('createAppQueryClient', () => {
  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it('reads local data while the device is offline', async () => {
    onlineManager.setOnline(false);
    const client = createAppQueryClient();

    await expect(settlesSoon(client.fetchQuery({ queryKey: ['local'], queryFn: async () => 42 }))).resolves.toBe(42);
  });

  it('saves local data while the device is offline', async () => {
    onlineManager.setOnline(false);
    const client = createAppQueryClient();
    const observer = new MutationObserver(client, { mutationFn: async () => 'saved' });

    await expect(settlesSoon(observer.mutate())).resolves.toBe('saved');
  });
});
