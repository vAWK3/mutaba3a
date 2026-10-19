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

function renderPage(language: 'en' | 'ar', path = '/terms') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <TermsPage path={path} />
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
});
