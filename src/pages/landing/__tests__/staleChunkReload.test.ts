import { describe, expect, it, vi } from 'vitest';
import { STALE_CHUNK_KEY, reloadOnceForStaleChunk } from '../staleChunkReload';

/** MUTABA3A-LANDING-3: a file that fails to load reloads the website once, never in a loop. */

function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() { return items.size; },
    clear: () => items.clear(),
    getItem: (k) => items.get(k) ?? null,
    key: (i) => [...items.keys()][i] ?? null,
    removeItem: (k) => void items.delete(k),
    setItem: (k, v) => void items.set(k, v),
  };
}

const preloadError = () => new Event('vite:preloadError', { cancelable: true });

describe('reloadOnceForStaleChunk', () => {
  it('reloads the first time and cancels the error', () => {
    const storage = memoryStorage();
    const reload = vi.fn();
    const event = preloadError();
    expect(reloadOnceForStaleChunk(event, { storage: () => storage, reload, now: () => 1_000_000 })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(storage.getItem(STALE_CHUNK_KEY)).toBe('1000000');
  });

  it('leaves a second failure within a minute to the error boundary', () => {
    const storage = memoryStorage();
    storage.setItem(STALE_CHUNK_KEY, '1000000');
    const reload = vi.fn();
    const event = preloadError();
    expect(reloadOnceForStaleChunk(event, { storage: () => storage, reload, now: () => 1_030_000 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('reloads again after a minute (a later deploy)', () => {
    const storage = memoryStorage();
    storage.setItem(STALE_CHUNK_KEY, '1000000');
    const reload = vi.fn();
    expect(reloadOnceForStaleChunk(preloadError(), { storage: () => storage, reload, now: () => 1_061_000 })).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('never reloads without session storage, so it can never loop', () => {
    const reload = vi.fn();
    const event = preloadError();
    expect(reloadOnceForStaleChunk(event, { storage: () => { throw new Error('blocked'); }, reload, now: () => 1 })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });
});
