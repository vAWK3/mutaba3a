import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { LandingHeader } from '../components/LandingHeader';
import { HeroSection } from '../components/HeroSection';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';
import en from '../../../lib/i18n/translations/en';

/**
 * The frosted bar (MUT-77, brief L9): wordmark, language switch, and a
 * device-matched button that only shows once the hero's has scrolled away.
 * Visibility itself is CSS (proved in qa/specs/web/landing.spec.ts); these
 * prove the contract the CSS keys off and that both buttons always agree.
 */

const releaseHook = vi.hoisted(() => ({ calls: 0 }));

const release = vi.hoisted(() => ({
  current: {
    release: { version: '0.1.4', releaseNotesUrl: 'https://example.test/notes', hasMacBuild: true, hasWindowsBuild: true } as ReleaseInfo | null,
    isLoading: false,
    error: null as string | null,
  },
}));

vi.mock('../../../hooks/useLatestRelease', () => ({
  useLatestRelease: () => {
    releaseHook.calls += 1;
    return release.current;
  },
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
  releaseHook.calls = 0;
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
    const home = banner.querySelector<HTMLAnchorElement>('.landing-header-brand')!;
    expect(home).toHaveAttribute('href', '#top');
    expect(home.querySelector('img')).toHaveAttribute('alt', '');
    // Both names on wide screens, the active language's alone on a phone; CSS picks one (qa landing.spec @375)
    expect(home.querySelector('.landing-wordmark-full')).toHaveTextContent('Mutaba3a · متابعة');
    expect(home.querySelector('.landing-wordmark-short')).toHaveTextContent('Mutaba3a');
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
    ['iphone', 'Web app', 'Open the web app'],
  ] as const)('on %s it goes where the hero button goes, with a short label and the full name', (device, short, full) => {
    asDevice(device);
    renderHeader({ withHero: true });
    const hero = document.querySelector<HTMLAnchorElement>('.hero-cta-primary')!;
    expect(headerCta()).toHaveAttribute('href', hero.getAttribute('href'));
    expect(headerCta()).toHaveTextContent(short);
    expect(headerCta()).toHaveAccessibleName(full);
  });

  it.each(['mac', 'windows', 'iphone'] as const)(
    'on %s the visible label is part of the accessible name, in both languages (WCAG 2.5.3, voice control)',
    (device) => {
      asDevice(device);
      for (const language of ['en', 'ar'] as const) {
        const { unmount } = renderHeader({ language });
        const name = headerCta().getAttribute('aria-label')!.toLowerCase();
        const visible = headerCta().textContent!.trim().toLowerCase();
        expect(name).toContain(visible);
        unmount();
      }
    },
  );

  it('on a page with no hero: no button, no GitHub lookup, and the wordmark goes home', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    render(
      <ThemeProvider>
        <LanguageProvider>
          <LandingHeader homeHref="/" />
        </LanguageProvider>
      </ThemeProvider>,
    );
    expect(document.querySelector('[data-part="header-cta"]')).toBeNull();
    expect(releaseHook.calls).toBe(0);
    expect(document.querySelector('.landing-header-brand')).toHaveAttribute('href', '/');
  });

  it('keeps the language switch at the end edge: the button comes before it', () => {
    renderHeader();
    const actions = document.querySelector('.landing-header-actions')!;
    expect(actions.lastElementChild).toHaveClass('landing-lang-toggle');
  });

  it('links to the hosted portal when the build set a portal URL, opening in a new tab', () => {
    const PORTAL = 'https://portal.test';
    vi.stubGlobal('__PORTAL_URL__', PORTAL);
    renderHeader();
    const signIn = screen.getByRole('link', { name: `${en.landing.header.signIn} ${en.common.opensInNewTab}` });
    expect(signIn).toHaveAttribute('href', PORTAL);
    expect(signIn).toHaveAttribute('target', '_blank');
    expect(signIn).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('puts the sign-in link and the button in one slot that says whether the button shows, so a phone can show one at a time (MUT-231)', () => {
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    const { rerender } = renderHeader({ showCta: false });
    const slot = document.querySelector('.landing-header-slot')!;
    expect([...slot.children].map((el) => el.className)).toEqual(['landing-header-signin', 'landing-header-cta']);
    expect(slot).toHaveAttribute('data-cta-visible', 'false');
    rerender(
      <ThemeProvider>
        <LanguageProvider>
          <LandingHeader showCta />
        </LanguageProvider>
      </ThemeProvider>,
    );
    expect(document.querySelector('.landing-header-slot')).toHaveAttribute('data-cta-visible', 'true');
  });

  it('leaves out the sign-in link when the build set no portal URL', () => {
    renderHeader();
    expect(screen.queryByRole('link', { name: /Sign in now/ })).not.toBeInTheDocument();
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

  it('labels its button, and names the product for phones, in Arabic too', () => {
    asDevice('mac');
    renderHeader({ language: 'ar' });
    expect(document.querySelector('.landing-wordmark-short')).toHaveTextContent('متابعة');
    expect(headerCta()).toHaveTextContent('تحميل');
    expect(headerCta()).toHaveAccessibleName('تحميل لـ Mac');
  });
});
