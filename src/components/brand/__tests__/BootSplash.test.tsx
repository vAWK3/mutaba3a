import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LandingProviders } from '../../../pages/landing/LandingProviders';
import { chooseLanguage } from '../../../test/language';
import { pageStartsNow } from '../../../test/pageStart';
import { BootSplash } from '../BootSplash';
import { __resetLoaderChainForTests, LOADER_DELAY_MS } from '../BrandLoader';
import { bootDelayMs } from '../bootDelay';

/**
 * MUT-207: the landing's Suspense fallback is the boot splash. Its first
 * render is the static HTML splash (brand-head.test.ts compares the markup);
 * the still mark blooms in place once the page has waited LOADER_DELAY_MS
 * from page start (DR9, DR10), with no fade and no slow caption.
 */

beforeEach(() => {
  vi.useFakeTimers();
  __resetLoaderChainForTests();
  chooseLanguage('en');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

function renderSplash() {
  return render(
    <LandingProviders>
      <BootSplash />
    </LandingProviders>,
  );
}

describe('bootDelayMs (DR9)', () => {
  it.each([
    [0, LOADER_DELAY_MS],
    [100, 300],
    [400, 0],
    [2500, 0],
  ])('at %s ms after page start, waits %s ms more', (now, wait) => {
    expect(bootDelayMs(now)).toBe(wait);
  });

  it('reads the page clock by default', () => {
    vi.spyOn(performance, 'now').mockReturnValue(150);
    expect(bootDelayMs()).toBe(250);
  });
});

describe('BootSplash (MUT-207 D3, DR10)', () => {
  it('starts as the hidden still mark, then blooms in place without a fade', () => {
    pageStartsNow(100);
    const { container } = renderSplash();
    const splash = container.querySelector('.boot-splash')!;
    expect(splash).toHaveAttribute('aria-hidden', 'true');
    expect(splash.querySelector('picture > img.boot-splash-mark')).toHaveAttribute('width', '80');
    expect(screen.queryByRole('status')).toBeNull();

    act(() => void vi.advanceTimersByTime(LOADER_DELAY_MS - 100));

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Loading');
    expect(status).not.toHaveClass('brand-loader--enter');
    expect(status.querySelector('svg')).toHaveAttribute('width', '96');
    expect(container.querySelector('picture')).toBeNull();
    expect(container.querySelector('.boot-splash')).not.toHaveAttribute('aria-hidden');
  });

  it('on a slow load blooms on its first render', () => {
    pageStartsNow(2500);
    renderSplash();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('never shows a slow caption', () => {
    pageStartsNow(2500);
    const { container } = renderSplash();
    act(() => void vi.advanceTimersByTime(10_000));
    expect(container.querySelector('.brand-loader__caption')).toBeNull();
  });

  it('speaks the visitor’s language', () => {
    chooseLanguage('ar');
    pageStartsNow(2500);
    renderSplash();
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحميل');
  });
});
