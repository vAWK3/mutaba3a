import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import type { ReleaseInfo } from '../../../hooks/useLatestRelease';
import { LandingPage } from '../LandingPage';

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
    <LanguageProvider>
      <LandingPage />
    </LanguageProvider>
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
    expect(h1).toHaveTextContent('Know who owes you.');
    expect(h1).toHaveTextContent('Keep it to yourself.');
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
    expect(h1).toHaveTextContent('اعرف من يدين لك.');
    expect(h1).toHaveTextContent('وأبقِ ذلك لك وحدك.');
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
