import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { LandingPage } from '../LandingPage';
import { FakeIntersectionObserver, installFakeIntersectionObserver } from '../../../test/intersectionObserver';

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

function renderLanding(language: 'en' | 'ar') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <LandingPage />
      </LanguageProvider>
    </ThemeProvider>
  );
}

function part(name: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`main [data-part="${name}"]`);
  if (!el) throw new Error(`missing part ${name}`);
  return el;
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

describe('LandingPage structure', () => {
  it('renders the seven parts in order, then the footer', () => {
    renderLanding('en');
    const parts = Array.from(document.querySelectorAll('main > [data-part]')).map(
      (el) => el.getAttribute('data-part')
    );
    expect(parts).toEqual([
      'hero',
      'chapter-clients',
      'chapter-payment',
      'chapter-businesses',
      'privacy',
      'get-it',
      'faq',
    ]);
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('leads with the two-beat headline', () => {
    renderLanding('en');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('Track your finances, securely.');
  });

  it('gives each chapter its own heading', () => {
    renderLanding('en');
    expect(within(part('chapter-clients')).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Every client on one page.'
    );
    expect(within(part('chapter-payment')).getByRole('heading', { level: 2 })).toHaveTextContent(
      'Paid? Two taps.'
    );
    expect(
      within(part('chapter-businesses')).getByRole('heading', { level: 2 })
    ).toHaveTextContent('Every business you run.');
  });
});

describe('LandingPage honesty', () => {
  // Scoped to <main>: the footer's "Buy Me a Coffee" is a donation brand, not a price.
  it('makes no price or platform claim the product cannot keep (EN)', () => {
    renderLanding('en');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/\bBuy\b/);
    expect(text).not.toContain('$49');
    expect(text).not.toMatch(/Universal/i);
    expect(text).not.toMatch(/Intel/i);
  });

  it('makes no price claim in Arabic either', () => {
    renderLanding('ar');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/شراء|اشترِ|اشتر /);
    expect(text).not.toContain('49');
  });

  it('says the app is free during early access', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Free during early access');
  });

  it('says so when the latest release has no Windows installer, instead of linking to it', () => {
    release.current = {
      ...release.current,
      release: { ...release.current.release!, hasWindowsBuild: false },
    };
    renderLanding('en');
    const getIt = part('get-it');
    expect(within(getIt).queryByRole('link', { name: /windows/i })).toBeNull();
    expect(getIt).toHaveTextContent(/Windows installer isn't in this release/i);
  });

  it('links to the Windows installer when the release has one', () => {
    renderLanding('en');
    const link = within(part('get-it')).getByRole('link', { name: /Download for Windows/i });
    expect(link).toHaveAttribute('href', '/download/windows');
  });

  it('labels the Mac download for Apple Silicon', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Apple Silicon');
  });

  it('still offers downloads while the release is unknown', () => {
    release.current = { release: null, isLoading: false, error: 'offline' };
    renderLanding('en');
    expect(within(part('get-it')).getByRole('link', { name: /Download for Mac/i })).toHaveAttribute(
      'href',
      '/download/mac'
    );
  });
});

describe('LandingPage Get it, free vs paid (MUT-172)', () => {
  // No price, no checkout, no signup, no platform the phone app can't yet be installed on
  const BANNED_EN = /\bprice\b|\/month|checkout|sign ?up|\$\d|android|\bios\b/i;
  const BANNED_AR = /سعر|اشترك|إنشاء حساب/;

  it('says the hosted account and phone app come with a paid plan, with one link to /hosted', () => {
    renderLanding('en');
    const paid = part('get-it-paid');
    expect(paid).toHaveTextContent('Unlike the apps above');
    expect(paid).toHaveTextContent('paid plan');
    const links = within(paid).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAccessibleName('See hosted accounts');
    expect(links[0]).toHaveAttribute('href', '/hosted');
    expect(links[0]).not.toHaveAttribute('target');
    expect(paid.textContent).not.toMatch(BANNED_EN);
  });

  it('leaves the free line in place above it (A1)', () => {
    renderLanding('en');
    expect(part('get-it')).toHaveTextContent('Free during early access');
    expect(part('get-it').textContent).not.toMatch(/stay free/i);
  });

  it('reads the same in Arabic', () => {
    renderLanding('ar');
    const paid = part('get-it-paid');
    expect(paid).toHaveTextContent('خطة مدفوعة');
    expect(within(paid).getByRole('link', { name: 'اطّلع على الحسابات المستضافة' })).toHaveAttribute('href', '/hosted');
    expect(paid.textContent).not.toMatch(BANNED_AR);
  });
});

describe('LandingPage FAQ', () => {
  it('asks exactly six questions, each one opening its answer', () => {
    renderLanding('en');
    const questions = within(part('faq')).getAllByRole('button');
    expect(questions).toHaveLength(6);

    const first = questions[0];
    expect(first).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-expanded', 'true');
    const answer = document.getElementById(first.getAttribute('aria-controls')!);
    expect(answer).not.toHaveAttribute('hidden');
  });

  it('warns about data loss exactly once, inside the backup answer', () => {
    renderLanding('en');
    const warning = /export a backup first/gi;
    expect((document.body.textContent ?? '').match(warning)).toHaveLength(1);
    expect(part('faq').textContent).toMatch(warning);
  });

  it('names every supported currency in the currency answer', () => {
    renderLanding('en');
    const faq = part('faq').textContent ?? '';
    expect(faq).toContain('US dollars');
    expect(faq).toContain('shekels');
    expect(faq).toContain('euros');
  });
});

describe('LandingPage language', () => {
  it('renders right to left in Arabic', () => {
    renderLanding('ar');
    expect(document.documentElement.dir).toBe('rtl');
    const h1 = screen.getByRole('heading', { level: 1 });
    expect(h1).toHaveTextContent('تابع مالك، بأمان.');
  });

  it.each(['en', 'ar'] as const)('shows no raw translation keys (%s)', (language) => {
    renderLanding(language);
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });

  it("uses the app's own Record payment label in the payment chapter", () => {
    renderLanding('en');
    expect(part('chapter-payment')).toHaveTextContent('Record Payment');
  });
});

describe('LandingPage header button (MUT-77)', () => {
  beforeEach(() => installFakeIntersectionObserver());
  afterEach(() => vi.unstubAllGlobals());

  const heroCta = () => document.querySelector<HTMLAnchorElement>('.hero-cta-primary')!;
  const headerCta = () => document.querySelector<HTMLAnchorElement>('[data-part="header-cta"]')!;

  it('keeps it hidden until it is known that the hero button has scrolled away', () => {
    renderLanding('en');
    expect(headerCta()).toHaveAttribute('data-visible', 'false');

    FakeIntersectionObserver.reportFor(heroCta(), true);
    expect(headerCta()).toHaveAttribute('data-visible', 'false');

    FakeIntersectionObserver.reportFor(heroCta(), false);
    expect(headerCta()).toHaveAttribute('data-visible', 'true');

    FakeIntersectionObserver.reportFor(heroCta(), true);
    expect(headerCta()).toHaveAttribute('data-visible', 'false');
  });

  it('watches the hero button below the sticky bar, so it counts as gone once it slides under the bar', () => {
    renderLanding('en');
    const observer = FakeIntersectionObserver.instances.find((o) => o.observed.includes(heroCta()))!;
    expect(observer.options?.rootMargin).toMatch(/^-\d+px 0px 0px 0px$/);
  });

  it('stays hidden in a browser with no IntersectionObserver, where the hero button is the way in', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderLanding('en');
    expect(headerCta()).toHaveAttribute('data-visible', 'false');
  });
});

describe('LandingPage title (MUT-77)', () => {
  it('follows the active language', () => {
    renderLanding('en');
    expect(document.title).toBe('Mutaba3a — Track your finances, securely');

    fireEvent.click(screen.getByRole('button', { name: /Switch language/ }));
    expect(document.title).toBe('متابعة — تابع مالك، بأمان');
  });
});
