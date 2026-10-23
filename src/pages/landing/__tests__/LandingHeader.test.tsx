import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { LandingHeader } from '../components/LandingHeader';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';
import en from '../../../lib/i18n/translations/en';

/**
 * The frosted bar (MUT-77, brief L9): wordmark, language switch, and a
 * "Request an account" button that only shows once the hero's has scrolled
 * away. Visibility itself is CSS (proved in qa/specs/web/landing.spec.ts);
 * these prove the contract the CSS keys off.
 */

function renderHeader({ language = 'en', showCta = true }: { language?: 'en' | 'ar'; showCta?: boolean } = {}) {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LandingHeader showCta={showCta} />
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
});

describe('LandingHeader', () => {
  it('names the product with the mark + MTB3A + متابعة lockup, linking back to the top', () => {
    renderHeader();
    const banner = screen.getByRole('banner');
    const home = banner.querySelector<HTMLAnchorElement>('.landing-header-brand')!;
    expect(home).toHaveAttribute('href', '#top');
    expect(home.querySelector('img')).toHaveAttribute('alt', '');
    expect(home.querySelector('img')).toHaveAttribute('width', '32');
    expect(home).toHaveAccessibleName('MTB3A متابعة');
  });

  it.each([
    ['en', 'MTB3A متابعة'],
    ['ar', 'متابعة MTB3A'],
  ] as const)('puts the %s name first, so dir orders the lockup in the reading direction (MUT-402 D1)', (language, name) => {
    renderHeader({ language });
    expect(document.querySelector('.landing-header-brand')).toHaveAccessibleName(name);
  });

  it('marks the other language’s name and the dot for the phone rule, and hides the dot from screen readers (D12, OV-4)', () => {
    renderHeader({ language: 'ar' });
    const lockup = document.querySelector('.landing-wordmark')!;
    const other = [...lockup.querySelectorAll('.wordmark-other')];
    expect(other).toHaveLength(2);
    expect(other[0]).toHaveClass('wordmark-separator');
    expect(other[0]).toHaveAttribute('aria-hidden', 'true');
    expect(other[1]).toHaveAttribute('role', 'img');
    expect(other[1]).toHaveAccessibleName('MTB3A');
    expect(lockup.querySelector('.brand-name-ar:not(.wordmark-other)')).toHaveTextContent('متابعة');
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

  it('always offers "Request an account" — there is no self-serve signup, so this is the one way in', () => {
    renderHeader();
    expect(headerCta()).toHaveAttribute('href', '#get-it');
    expect(headerCta()).toHaveTextContent(en.landing.hero.ctaRequest);
  });

  it('labels its button in Arabic too', () => {
    renderHeader({ language: 'ar' });
    expect(headerCta()).toHaveTextContent('اطلب حسابًا');
  });

  it('on a page with no hero: no button, and the wordmark goes home', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    render(
      <ThemeProvider>
        <LanguageProvider>
          <LandingHeader homeHref="/" />
        </LanguageProvider>
      </ThemeProvider>,
    );
    expect(document.querySelector('[data-part="header-cta"]')).toBeNull();
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
    expect(screen.queryByRole('link', { name: /Sign in/ })).not.toBeInTheDocument();
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
});
