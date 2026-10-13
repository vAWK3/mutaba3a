import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { PrivacyPolicyPage } from '../PrivacyPolicyPage';

function renderPage(language: 'en' | 'ar') {
  localStorage.setItem('mutaba3a-language', language);
  return render(
    <LanguageProvider>
      <PrivacyPolicyPage />
    </LanguageProvider>
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

  it('names no hosted product, only the apps this page links to', () => {
    renderPage('en');
    const text = document.querySelector('main')?.textContent ?? '';
    expect(text).not.toMatch(/\bhosted\b/i);
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
});
