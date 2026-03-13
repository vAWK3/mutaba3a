import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isTauri, isWeb, isMacOS, isWindows, isLinux, handleVersionChange } from '../platform';

describe('platform detection', () => {
  // Store original window state for potential future use
  void { ...window };

  describe('isTauri', () => {
    it('should return true when __TAURI_INTERNALS__ exists', () => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      expect(isTauri()).toBe(true);
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });

    it('should return false when __TAURI_INTERNALS__ does not exist', () => {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      expect(isTauri()).toBe(false);
    });
  });

  describe('isWeb', () => {
    it('should return true when not in Tauri', () => {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
      expect(isWeb()).toBe(true);
    });

    it('should return false when in Tauri', () => {
      (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
      expect(isWeb()).toBe(false);
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    });
  });

  describe('isMacOS', () => {
    const originalNavigator = window.navigator;

    afterEach(() => {
      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        writable: true,
      });
    });

    it('should return true for Mac platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'MacIntel', userAgent: '' },
        writable: true,
      });
      expect(isMacOS()).toBe(true);
    });

    it('should return true for Macintosh userAgent', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        writable: true,
      });
      expect(isMacOS()).toBe(true);
    });

    it('should return false for Windows platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'Win32', userAgent: 'Windows NT 10.0' },
        writable: true,
      });
      expect(isMacOS()).toBe(false);
    });
  });

  describe('isWindows', () => {
    const originalNavigator = window.navigator;

    afterEach(() => {
      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        writable: true,
      });
    });

    it('should return true for Win32 platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'Win32', userAgent: '' },
        writable: true,
      });
      expect(isWindows()).toBe(true);
    });

    it('should return true for Windows userAgent', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: '', userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
        writable: true,
      });
      expect(isWindows()).toBe(true);
    });

    it('should return false for Mac platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'MacIntel', userAgent: 'Macintosh' },
        writable: true,
      });
      expect(isWindows()).toBe(false);
    });
  });

  describe('isLinux', () => {
    const originalNavigator = window.navigator;

    afterEach(() => {
      Object.defineProperty(window, 'navigator', {
        value: originalNavigator,
        writable: true,
      });
    });

    it('should return true for Linux platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'Linux x86_64', userAgent: '' },
        writable: true,
      });
      expect(isLinux()).toBe(true);
    });

    it('should return true for Linux userAgent', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: '', userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' },
        writable: true,
      });
      expect(isLinux()).toBe(true);
    });

    it('should return false for Mac platform', () => {
      Object.defineProperty(window, 'navigator', {
        value: { platform: 'MacIntel', userAgent: 'Macintosh' },
        writable: true,
      });
      expect(isLinux()).toBe(false);
    });
  });
});

describe('handleVersionChange', () => {
  const LAST_KNOWN_VERSION_KEY = 'app-last-known-version';
  const UPDATE_CACHE_KEYS = [
    'update-banner-dismissed-version',
    'tauri-updater-last-check',
    'update-check-result',
    'latest-release-info',
  ];

  beforeEach(() => {
    // Clear storage before each test
    localStorage.clear();
    sessionStorage.clear();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should store current version on first run', () => {
    handleVersionChange('1.0.0');
    expect(localStorage.getItem(LAST_KNOWN_VERSION_KEY)).toBe('1.0.0');
  });

  it('should not clear caches on same version', () => {
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '1.0.0');
    localStorage.setItem('update-banner-dismissed-version', '0.9.0');

    handleVersionChange('1.0.0');

    expect(localStorage.getItem('update-banner-dismissed-version')).toBe('0.9.0');
  });

  it('should clear update caches on version change', () => {
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '1.0.0');

    // Set up some cache values
    for (const key of UPDATE_CACHE_KEYS) {
      localStorage.setItem(key, 'cached-value');
      sessionStorage.setItem(key, 'cached-value');
    }

    handleVersionChange('1.1.0');

    // All update cache keys should be cleared
    for (const key of UPDATE_CACHE_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
      expect(sessionStorage.getItem(key)).toBeNull();
    }
  });

  it('should log version change', () => {
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '1.0.0');

    handleVersionChange('1.1.0');

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('App version changed from 1.0.0 to 1.1.0')
    );
  });

  it('should update stored version after change', () => {
    localStorage.setItem(LAST_KNOWN_VERSION_KEY, '1.0.0');

    handleVersionChange('1.1.0');

    expect(localStorage.getItem(LAST_KNOWN_VERSION_KEY)).toBe('1.1.0');
  });

  it('should handle storage errors gracefully', () => {
    // Mock localStorage to throw
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn().mockImplementation(() => {
      throw new Error('Storage error');
    });

    // Should not throw
    expect(() => handleVersionChange('1.0.0')).not.toThrow();

    localStorage.setItem = originalSetItem;
  });
});
