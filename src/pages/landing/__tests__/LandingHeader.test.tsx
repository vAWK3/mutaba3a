import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { LandingHeader } from '../components/LandingHeader';
import { HeroSection } from '../components/HeroSection';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';

/**
 * The frosted bar (MUT-77, brief L9): wordmark, language switch, and a
 * device-matched button that only shows once the hero's has scrolled away.
 * Visibility itself is CSS (proved in qa/specs/web/landing.spec.ts); these
 * prove the contract the CSS keys off and that both buttons always agree.
 */

const release = vi.hoisted(() => ({
  current: {
    release: { version: '0.1.4', releaseNotesUrl: 'https://example.test/notes', hasMacBuild: true, hasWindowsBuild: true } as ReleaseInfo | null,
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock('../../../hooks/useLatestRelease', () => ({
  useLatestRelease: () => release.current,
}));

vi.mock('../../../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

const AGENTS = {
  mac: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 0 },
  windows: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36', platform: 'Win32', maxTouchPoints: 0 },
  iphone: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1', platform: 'iPhone', maxTouchPoints: 5 },
};

const originals = {
  userAgent: Object.getOwnPropertyDescriptor(window.navigator, 'userAgent'),
  platform: Object.getOwnPropertyDescriptor(window.navigator, 'platform'),
  maxTouchPoints: Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints'),
};

function asDevice(device: keyof typeof AGENTS) {
  for (const [key, value] of Object.entries(AGENTS[device])) {
    Object.defineProperty(window.navigator, key, { value, configurable: true });
  }
}

function renderHeader({ language = 'en', showCta = true, withHero = false }: { language?: 'en' | 'ar'; showCta?: boolean; withHero?: boolean } = {}) {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LandingHeader showCta={showCta} />
        {withHero && <HeroSection />}
      </LanguageProvider>
    </ThemeProvider>,
  );
}

function headerCta(): HTMLAnchorElement {
  return document.querySelector<HTMLAnchorElement>('[data-part="header-cta"]')!;
}

beforeEach(() => {
  localStorage.clear();
  installFakeIntersectionObserver();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(window.navigator, key, descriptor);
    else delete (window.navigator as unknown as Record<string, unknown>)[key];
  }
});

describe('LandingHeader', () => {
  it('names the product with the mark + name lockup, linking back to the top', () => {
    renderHeader();
    const banner = screen.getByRole('banner');
    const home = screen.getByRole('link', { name: 'Mutaba3a · متابعة' });
    expect(banner).toContainElement(home);
    expect(home).toHaveAttribute('href', '#top');
    expect(home.querySelector('img')).toHaveAttribute('alt', '');
  });

  it.each([
    ['en', 'Switch language'],
    ['ar', 'تغيير اللغة'],
  ] as const)('names the language switch in %s, keeping its visible letters in the name', (language, label) => {
    renderHeader({ language });
    const toggle = screen.getByRole('button', { name: new RegExp(label) });
    expect(toggle).toHaveAccessibleName(expect.stringMatching(/EN/));
  });

  it('switches the page language', () => {
    renderHeader();
    fireEvent.click(screen.getByRole('button', { name: /Switch language/ }));
    expect(document.documentElement.lang).toBe('ar');
  });

  it('marks its button hidden while the hero button is on screen, and shown once it is not', () => {
    const { unmount } = renderHeader({ showCta: false });
    expect(headerCta()).toHaveAttribute('data-visible', 'false');
    unmount();
    renderHeader({ showCta: true });
    expect(headerCta()).toHaveAttribute('data-visible', 'true');
  });

  it.each([
    ['mac', 'Download', 'Download for Mac'],
    ['windows', 'Download', 'Download for Windows'],
    ['iphone', 'Open the app', 'Open the web app'],
  ] as const)('on %s it goes where the hero button goes, with a short label and the full name', (device, short, full) => {
    asDevice(device);
    renderHeader({ withHero: true });
    const hero = document.querySelector<HTMLAnchorElement>('.hero-cta-primary')!;
    expect(headerCta()).toHaveAttribute('href', hero.getAttribute('href'));
    expect(headerCta()).toHaveTextContent(short);
    expect(headerCta()).toHaveAccessibleName(full);
  });

  it('shows its button by default, for pages with no hero', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    render(
      <ThemeProvider>
        <LanguageProvider>
          <LandingHeader />
        </LanguageProvider>
      </ThemeProvider>,
    );
    expect(headerCta()).toHaveAttribute('data-visible', 'true');
  });

  it('shows the scroll-edge fade only once the top of the page has scrolled away', () => {
    renderHeader();
    const banner = screen.getByRole('banner');
    const top = document.getElementById('top')!;
    expect(banner).toHaveAttribute('data-scrolled', 'false');
    FakeIntersectionObserver.reportFor(top, false);
    expect(banner).toHaveAttribute('data-scrolled', 'true');
    FakeIntersectionObserver.reportFor(top, true);
    expect(banner).toHaveAttribute('data-scrolled', 'false');
  });

  it('labels its button in Arabic too', () => {
    asDevice('mac');
    renderHeader({ language: 'ar' });
    expect(headerCta()).toHaveTextContent('تحميل');
    expect(headerCta()).toHaveAccessibleName('تحميل لـ Mac');
  });
});
