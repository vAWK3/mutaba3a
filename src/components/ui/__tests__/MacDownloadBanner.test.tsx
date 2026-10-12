/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MacDownloadBanner } from '../MacDownloadBanner';

vi.mock('../../../lib/i18n', () => ({
  useT: () => (key: string) => key,
}));

const DISMISSED_KEY = 'hideDownloadBanner';
const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const WINDOWS_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function setNavigator(platform: string, userAgent: string, maxTouchPoints = 0) {
  vi.spyOn(navigator, 'platform', 'get').mockReturnValue(platform);
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  // jsdom has no maxTouchPoints, so define it (removed again in afterEach)
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

const bar = () => screen.queryByText('downloadBanner.message');

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).maxTouchPoints;
  localStorage.clear();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('MacDownloadBanner (MUT-79)', () => {
  it('offers the Mac app in a browser on a Mac', () => {
    setNavigator('MacIntel', MAC_UA);
    render(<MacDownloadBanner />);
    expect(bar()).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'downloadBanner.cta' })).toHaveAttribute('href', '/download');
  });

  it('stays hidden on an iPad, which reports MacIntel but has touch', () => {
    setNavigator('MacIntel', MAC_UA, 5);
    render(<MacDownloadBanner />);
    expect(bar()).toBeNull();
  });

  it('stays hidden on Windows', () => {
    setNavigator('Win32', WINDOWS_UA);
    render(<MacDownloadBanner />);
    expect(bar()).toBeNull();
  });

  it('stays hidden in the desktop app', () => {
    setNavigator('MacIntel', MAC_UA);
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    render(<MacDownloadBanner />);
    expect(bar()).toBeNull();
  });

  it('is gone for good once dismissed', () => {
    setNavigator('MacIntel', MAC_UA);
    render(<MacDownloadBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'downloadBanner.dismiss' }));
    expect(bar()).toBeNull();
    expect(localStorage.getItem(DISMISSED_KEY)).toBe('true');

    cleanup();
    render(<MacDownloadBanner />);
    expect(bar()).toBeNull();
  });

  it('survives storage that throws, and still hides when dismissed', () => {
    setNavigator('MacIntel', MAC_UA);
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });

    render(<MacDownloadBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'downloadBanner.dismiss' }));
    expect(bar()).toBeNull();
  });
});
