import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { HeroSection } from '../components/HeroSection';
import { WEB_APP_URL } from '../../../content/download-config';

const release = vi.hoisted(() => ({
  current: {
    release: {
      version: '0.0.66',
      releaseNotesUrl: 'https://example.test/notes',
      hasMacBuild: true,
      hasWindowsBuild: true,
    } as ReleaseInfo | null,
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
  mac: {
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
    platform: 'MacIntel',
    maxTouchPoints: 0,
  },
  windows: {
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
    platform: 'Win32',
    maxTouchPoints: 0,
  },
  iphone: {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    maxTouchPoints: 5,
  },
  android: {
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120.0 Mobile Safari/537.36',
    platform: 'Linux armv81',
    maxTouchPoints: 5,
  },
  unknown: { userAgent: '', platform: '', maxTouchPoints: 0 },
};

const originals = {
  userAgent: Object.getOwnPropertyDescriptor(window.navigator, 'userAgent'),
  platform: Object.getOwnPropertyDescriptor(window.navigator, 'platform'),
  maxTouchPoints: Object.getOwnPropertyDescriptor(window.navigator, 'maxTouchPoints'),
};

function asDevice(device: keyof typeof AGENTS) {
  const signals = AGENTS[device];
  for (const [key, value] of Object.entries(signals)) {
    Object.defineProperty(window.navigator, key, { value, configurable: true });
  }
}

function renderHero() {
  localStorage.setItem('mutaba3a-language', 'en');
  render(
    <LanguageProvider>
      <HeroSection />
    </LanguageProvider>
  );
  return document.querySelector<HTMLElement>('[data-part="hero"]')!;
}

function primaryCtas(hero: HTMLElement) {
  return Array.from(hero.querySelectorAll<HTMLAnchorElement>('.hero-cta-primary'));
}

beforeEach(() => {
  localStorage.clear();
  release.current = {
    release: {
      version: '0.0.66',
      releaseNotesUrl: 'https://example.test/notes',
      hasMacBuild: true,
      hasWindowsBuild: true,
    },
    isLoading: false,
    error: null,
  };
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(originals)) {
    if (descriptor) Object.defineProperty(window.navigator, key, descriptor);
    else delete (window.navigator as unknown as Record<string, unknown>)[key];
  }
});

describe('HeroSection call to action', () => {
  it('offers a Mac the Mac download, labelled Apple Silicon, and the browser as the alternative', () => {
    asDevice('mac');
    const hero = renderHero();
    const [cta, ...rest] = primaryCtas(hero);
    expect(rest).toHaveLength(0);
    expect(cta).toHaveAttribute('href', '/download/mac');
    expect(cta).toHaveTextContent('Download for Mac');
    expect(cta).toHaveTextContent('Apple Silicon');
    expect(within(hero).getByRole('link', { name: /browser/i })).toHaveAttribute('href', WEB_APP_URL);
  });

  it('offers Windows the Windows download', () => {
    asDevice('windows');
    const [cta, ...rest] = primaryCtas(renderHero());
    expect(rest).toHaveLength(0);
    expect(cta).toHaveAttribute('href', '/download/windows');
  });

  it('offers Windows the web app when the release has no Windows installer', () => {
    asDevice('windows');
    release.current = {
      ...release.current,
      release: { ...release.current.release!, hasWindowsBuild: false },
    };
    const [cta] = primaryCtas(renderHero());
    expect(cta).toHaveAttribute('href', WEB_APP_URL);
  });

  it.each(['iphone', 'android', 'unknown'] as const)(
    'offers %s the web app, with the desktop apps as the alternative',
    (device) => {
      asDevice(device);
      const hero = renderHero();
      const [cta, ...rest] = primaryCtas(hero);
      expect(rest).toHaveLength(0);
      expect(cta).toHaveAttribute('href', WEB_APP_URL);
      expect(within(hero).getByRole('link', { name: /desktop apps/i })).toHaveAttribute(
        'href',
        '#get-it'
      );
    }
  );
});

describe('HeroSection visual', () => {
  it('is markup, not a picture of the app', () => {
    asDevice('mac');
    const hero = renderHero();
    expect(hero.querySelector('img')).toBeNull();
    const visual = hero.querySelector<HTMLElement>('.hero-visual')!;
    expect(visual).toHaveTextContent('Owed Now');
    expect(visual).toHaveTextContent('Furniture Co.');
  });

  it('gives screen readers the final totals, never the animating digits', () => {
    asDevice('mac');
    const hero = renderHero();
    const live = hero.querySelectorAll('.landing-count-live');
    expect(live.length).toBeGreaterThan(0);
    live.forEach((el) => expect(el).toHaveAttribute('aria-hidden', 'true'));
    expect(hero.querySelectorAll('.landing-count .sr-only').length).toBe(live.length);
  });
});

describe('HeroSection headline', () => {
  it('still leads with the two-beat line', () => {
    asDevice('mac');
    renderHero();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Know who owes you.');
  });
});
