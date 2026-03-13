import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Store original window
const originalWindow = global.window;

// Mock Tauri plugins
const mockCheck = vi.fn();
const mockRelaunch = vi.fn();

vi.mock('@tauri-apps/plugin-updater', () => ({
  check: () => mockCheck(),
}));

vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => mockRelaunch(),
}));

describe('useTauriUpdater', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    mockCheck.mockResolvedValue(null);
    mockRelaunch.mockResolvedValue(undefined);

    // Mock window with Tauri internals
    Object.defineProperty(global, 'window', {
      value: {
        ...originalWindow,
        __TAURI_INTERNALS__: {},
        localStorage: {
          getItem: vi.fn().mockReturnValue(null),
          setItem: vi.fn(),
          removeItem: vi.fn(),
          clear: vi.fn(),
          length: 0,
          key: vi.fn(),
        },
      },
      writable: true,
    });
  });

  afterEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    Object.defineProperty(global, 'window', {
      value: originalWindow,
      writable: true,
    });
  });

  it('should export correct initial state shape', async () => {
    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    // Should have all expected properties
    expect(result.current).toHaveProperty('status');
    expect(result.current).toHaveProperty('currentVersion');
    expect(result.current).toHaveProperty('availableVersion');
    expect(result.current).toHaveProperty('downloadProgress');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('checkNow');
    expect(result.current).toHaveProperty('downloadAndInstall');
    expect(result.current).toHaveProperty('applyUpdate');
  });

  it('should have checkNow, downloadAndInstall, and applyUpdate as functions', async () => {
    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    expect(typeof result.current.checkNow).toBe('function');
    expect(typeof result.current.downloadAndInstall).toBe('function');
    expect(typeof result.current.applyUpdate).toBe('function');
  });

  it('should call relaunch when applyUpdate is called', async () => {
    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    await act(async () => {
      await result.current.applyUpdate();
    });

    expect(mockRelaunch).toHaveBeenCalled();
  });

  it('should set error status when downloadAndInstall is called without pending update', async () => {
    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    // Wait for initial check to complete
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    await act(async () => {
      await result.current.downloadAndInstall();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('No update available to download');
  });

  it('should detect update when check returns one', async () => {
    const mockUpdate = {
      version: '1.0.0',
      currentVersion: '0.9.0',
      downloadAndInstall: vi.fn().mockResolvedValue(undefined),
    };
    mockCheck.mockResolvedValue(mockUpdate);

    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    await act(async () => {
      await result.current.checkNow();
    });

    expect(result.current.availableVersion).toBe('1.0.0');
    expect(result.current.currentVersion).toBe('0.9.0');
  });

  it('should set up-to-date status when no update is available', async () => {
    mockCheck.mockResolvedValue(null);

    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    await act(async () => {
      await result.current.checkNow();
    });

    expect(result.current.status).toBe('up-to-date');
    expect(result.current.availableVersion).toBeNull();
  });

  it('should set error status when check fails', async () => {
    mockCheck.mockRejectedValue(new Error('Network error'));

    const { useTauriUpdater } = await import('../useTauriUpdater');
    const { result } = renderHook(() => useTauriUpdater());

    await act(async () => {
      await result.current.checkNow();
    });

    expect(result.current.status).toBe('error');
    expect(result.current.error).toBe('Network error');
  });
});

describe('useTauriUpdater helper functions', () => {
  it('should export isTauri function', async () => {
    const { isTauri } = await import('../useTauriUpdater');
    expect(typeof isTauri).toBe('function');
  });
});
