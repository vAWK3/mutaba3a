import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { LATEST_TERMS_VERSION } from '../../../content/legal/terms';
import en from '../../../content/legal/terms/2026-10-19.en.json';
import ar from '../../../content/legal/terms/2026-10-19.ar.json';
import { TermsPage } from '../TermsPage';

/** MUT-324: /terms shows the latest frozen text, /terms/<version> that version's, in the page language. */
/** The loading state already shows the title, so a loaded page is one whose first section is there. */
const loaded = (text: typeof en) => screen.findByRole('heading', { level: 2, name: text.sections[0]!.title });

/** The element that carries the text's own language and direction. */
const textOf = (text: typeof en) => screen.getByRole('heading', { level: 1, name: text.title }).parentElement;

function renderPage(language: 'en' | 'ar', path = '/terms', search = '') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <TermsPage path={path} search={search} />
      </LanguageProvider>
    </ThemeProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('TermsPage (MUT-324)', () => {
  it('/terms shows the latest version, every section, in English', async () => {
    renderPage('en');
    await loaded(en);
    expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeInTheDocument();
    expect(LATEST_TERMS_VERSION).toBe('2026-10-19');
    for (const section of en.sections) expect(screen.getByRole('heading', { level: 2, name: section.title })).toBeInTheDocument();
    expect(screen.getByText(en.updated)).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('shows the Arabic text when the page is in Arabic', async () => {
    renderPage('ar');
    await loaded(ar);
    expect(screen.getByRole('heading', { level: 1, name: ar.title })).toBeInTheDocument();
    for (const section of ar.sections) expect(screen.getByRole('heading', { level: 2, name: section.title })).toBeInTheDocument();
  });

  it('/terms/<version> shows that frozen version', async () => {
    renderPage('en', '/terms/2026-10-19');
    await loaded(en);
    expect(screen.getByText(en.updated)).toBeInTheDocument();
  });

  it('an unknown version says so and links to the current terms', async () => {
    renderPage('en', '/terms/2001-01-01');
    expect(await screen.findByRole('heading', { level: 1, name: /doesn.t exist/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /current terms/i })).toHaveAttribute('href', '/terms');
  });

  it('says the English text prevails and names the governing law, in both languages', async () => {
    renderPage('en');
    await loaded(en);
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).toContain('English text prevails');
    expect(text).toContain('England and Wales');
  });

  describe('?lang, the language the portal records (review fix 1)', () => {
    it('shows that language over the page language, marked for direction, without storing it', async () => {
      renderPage('ar', '/terms/2026-10-19', '?lang=en');
      await loaded(en);
      expect(screen.getByRole('heading', { level: 1, name: en.title })).toBeInTheDocument();
      const text = textOf(en);
      expect(text).toHaveAttribute('lang', 'en');
      expect(text).toHaveAttribute('dir', 'ltr');
      expect(localStorage.getItem('mutaba3a-language')).toBe('ar');
    });

    it('shows Arabic, right to left, on an English page', async () => {
      renderPage('en', '/terms', '?lang=ar');
      await loaded(ar);
      expect(textOf(ar)).toHaveAttribute('dir', 'rtl');
    });

    it('ignores a language the terms are not written in', async () => {
      renderPage('en', '/terms', '?lang=fr');
      await loaded(en);
      expect(textOf(en)).not.toHaveAttribute('lang');
    });

    it('keeps the language on the link to the current terms', async () => {
      renderPage('en', '/terms/2001-01-01', '?lang=ar');
      expect(await screen.findByRole('link', { name: /current terms/i })).toHaveAttribute('href', '/terms?lang=ar');
    });
  });
});
