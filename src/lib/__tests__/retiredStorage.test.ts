/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { removeRetiredStorageKeys } from '../retiredStorage';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('removeRetiredStorageKeys (MUT-79)', () => {
  it('removes the floating FX banner state and leaves other keys alone', () => {
    localStorage.setItem('mutaba3a_fx_banner_state', '{"isMinimized":true}');
    localStorage.setItem('mutaba3a-theme', 'dark');

    removeRetiredStorageKeys();

    expect(localStorage.getItem('mutaba3a_fx_banner_state')).toBeNull();
    expect(localStorage.getItem('mutaba3a-theme')).toBe('dark');
  });

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => removeRetiredStorageKeys()).not.toThrow();
  });
});
