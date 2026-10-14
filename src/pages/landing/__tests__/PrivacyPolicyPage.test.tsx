import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { ThemeProvider } from '../../../lib/theme';
import { PrivacyPolicyPage } from '../PrivacyPolicyPage';

function renderPage(language: 'en' | 'ar') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <ThemeProvider>
      <LanguageProvider>
        <PrivacyPolicyPage />
      </LanguageProvider>
    </ThemeProvider>
  );
}

beforeEach(() => {
  localStorage.clear();
});

describe('PrivacyPolicyPage', () => {
  it('renders the title as the page heading, then the footer', () => {
    renderPage('en');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy Policy');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('covers the iPhone and Android apps alongside Mac, Windows, and the browser', () => {
    renderPage('en');
    const intro = document.querySelector('.privacy-policy-intro')?.textContent ?? '';
    for (const platform of ['Mac', 'Windows', 'browser', 'iPhone', 'Android']) {
      expect(intro).toContain(platform);
    }
  });

  it('says the mobile apps use an account and store data on a server, and names the processor', () => {
    renderPage('en');
    expect(screen.getByRole('heading', { level: 2, name: /iPhone and Android/ })).toBeInTheDocument();
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).toMatch(/account/i);
    expect(text).toContain('Google Cloud');
  });

  it('tells mobile users how to have their account and data deleted', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /Deleting your account/ });
    expect(heading.parentElement?.textContent).toContain('info@malafat.app');
  });

  it('says what the hosted-account request form collects, that Netlify receives it, and what it is for (MUT-186)', () => {
    renderPage('en');
    const heading = screen.getByRole('heading', { level: 2, name: /ask for a hosted account/ });
    const section = heading.parentElement?.textContent ?? '';
    expect(section).toContain('Netlify');
    expect(section).toMatch(/only to reply with an offer/);
    expect(section).toContain('info@malafat.app');
  });

  it('gives a contact address', () => {
    renderPage('en');
    expect(document.querySelector('main')?.textContent).toContain('info@malafat.app');
  });

  it('renders right to left in Arabic with no raw translation keys', () => {
    renderPage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('سياسة الخصوصية');
    expect(document.body.textContent).not.toMatch(/\blanding\.[a-zA-Z]/);
  });

  it.each([
    ['en', 'Mutaba3a — Privacy Policy'],
    ['ar', 'متابعة — سياسة الخصوصية'],
  ] as const)('names the tab in the active language (%s, MUT-77)', (language, title) => {
    renderPage(language);
    expect(document.title).toBe(title);
  });
});
