import { describe, it, expect, beforeEach, vi } from 'vitest';
import { chooseLanguage } from '../../../test/language';
import { render, screen } from '@testing-library/react';
import { LandingProviders } from '../../landing/LandingProviders';
import { DownloadPage } from '../DownloadPage';

// Only the GitHub release lookup is stubbed. The page renders under exactly what
// src/main.tsx gives it (no React Query, router or database), so a component that
// needs any of them fails here the way it fails in the web build.
vi.mock('../../../hooks/useLatestRelease', () => ({
  useLatestRelease: () => ({ release: null, isLoading: false, error: null }),
}));

function renderPage(language: 'en' | 'ar' = 'en') {
  chooseLanguage(language);
  return render(
    <LandingProviders>
      <DownloadPage />
    </LandingProviders>,
  );
}

beforeEach(() => localStorage.clear());

describe('DownloadPage', () => {
  it('renders under the providers the web build mounts it with', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Download');
    expect(screen.getByRole('link', { name: 'Download DMG' })).toBeInTheDocument();
  });

  it('wears the landing chrome: skip link, landing header home to /, footer', () => {
    renderPage();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main-content');
    expect(document.querySelector('header.landing-header a.landing-header-brand')).toHaveAttribute('href', '/');
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('has none of the app top bar', () => {
    renderPage();
    expect(document.querySelector('.topbar')).toBeNull();
  });

  it('renders right to left in Arabic with no raw translation keys', () => {
    renderPage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('تحميل');
    expect(document.body.textContent).not.toMatch(/\b(download|landing)\.[a-zA-Z]/);
  });

  it.each([
    ['en', 'MTB3A — Download'],
    ['ar', 'متابعة — تحميل'],
  ] as const)('names the tab in the active language (%s, MUT-77)', (language, title) => {
    renderPage(language);
    expect(document.title).toBe(title);
  });
});
