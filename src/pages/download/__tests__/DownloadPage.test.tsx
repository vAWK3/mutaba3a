import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { LanguageProvider } from '../../../lib/i18n';
import { DownloadPage } from '../DownloadPage';

// The app frame's TopBar needs the router and the database; the title is all this test reads.
vi.mock('../../../components/layout', () => ({ TopBar: () => null }));

vi.mock('../../../hooks/useLatestRelease', () => ({
  useLatestRelease: () => ({ release: null, isLoading: false, error: null }),
}));

beforeEach(() => localStorage.clear());

describe('DownloadPage title (MUT-77)', () => {
  it.each([
    ['en', 'Mutaba3a — Download'],
    ['ar', 'متابعة — تحميل'],
  ] as const)('names the tab in the active language (%s)', (language, title) => {
    localStorage.setItem('mutaba3a-language', language);
    render(
      <LanguageProvider>
        <DownloadPage />
      </LanguageProvider>,
    );
    expect(document.title).toBe(title);
  });
});
