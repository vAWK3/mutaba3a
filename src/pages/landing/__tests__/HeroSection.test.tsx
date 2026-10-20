import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { HeroSection } from '../components/HeroSection';
import en from '../../../lib/i18n/translations/en';

vi.mock('../../../hooks/usePrefersReducedMotion', () => ({
  usePrefersReducedMotion: () => true,
}));

function renderHero() {
  localStorage.setItem('mutaba3a-language', 'en');
  render(
    <LanguageProvider>
      <HeroSection />
    </LanguageProvider>,
  );
  return document.querySelector<HTMLElement>('[data-part="hero"]')!;
}

beforeEach(() => {
  localStorage.clear();
});

describe('HeroSection call to action', () => {
  it('leads with "Request an account" — there is no self-serve signup', () => {
    const hero = renderHero();
    const primary = hero.querySelector<HTMLAnchorElement>('.hero-cta-primary')!;
    expect(primary).toHaveAttribute('href', '#get-it');
    expect(primary).toHaveTextContent(en.landing.hero.ctaRequest);
  });

  it('offers sign-in only when the build set a portal URL', () => {
    vi.stubGlobal('__PORTAL_URL__', 'https://portal.test');
    const hero = renderHero();
    const signIn = within(hero).getByRole('link', { name: en.landing.hero.ctaSignIn });
    expect(signIn).toHaveAttribute('href', 'https://portal.test');
    vi.unstubAllGlobals();
  });

  it('offers both phone apps with their real store links', () => {
    const hero = renderHero();
    expect(within(hero).getByRole('link', { name: en.landing.hero.ctaIos })).toHaveAttribute(
      'href',
      expect.stringContaining('apps.apple.com'),
    );
    expect(within(hero).getByRole('link', { name: en.landing.hero.ctaAndroid })).toHaveAttribute(
      'href',
      expect.stringContaining('play.google.com'),
    );
  });
});

describe('HeroSection visual', () => {
  it('is markup, not a picture of the app', () => {
    const hero = renderHero();
    expect(hero.querySelector('img')).toBeNull();
    const visual = hero.querySelector<HTMLElement>('.hero-visual')!;
    expect(visual).toHaveTextContent('Owed Now');
    expect(visual).toHaveTextContent('Furniture Co.');
  });

  it('gives screen readers the final totals, never the animating digits', () => {
    const hero = renderHero();
    const live = hero.querySelectorAll('.landing-count-live');
    expect(live.length).toBeGreaterThan(0);
    live.forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
    expect(hero.querySelectorAll('.landing-count .sr-only').length).toBe(live.length);
  });
});

describe('HeroSection headline', () => {
  it('leads with the two-beat line', () => {
    renderHero();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Log it before you forget it.');
  });
});
