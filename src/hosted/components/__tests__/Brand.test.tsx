import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeProvider } from '../../../lib/theme';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { Wordmark } from '../Brand';
import en from '../../i18n/en.json';
import ar from '../../i18n/ar.json';

/**
 * The portal's Wordmark (MUT-104, R6): it heads sign-in, the boot screens and
 * the shell, so the product name must survive the switch to a mark + name lockup.
 */

function renderWordmark(language: 'en' | 'ar') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  return render(
    <HostedLanguageProvider>
      <ThemeProvider>
        <Wordmark className="hp-side-wordmark" />
      </ThemeProvider>
    </HostedLanguageProvider>,
  );
}

afterEach(() => localStorage.clear());

describe('Wordmark (MUT-104)', () => {
  it.each([
    ['en', en.hosted.brand],
    ['ar', ar.hosted.brand],
  ] as const)('shows the product name in %s', (language, name) => {
    const { container } = renderWordmark(language);
    const wordmark = container.querySelector('.hp-wordmark');
    expect(wordmark).toHaveTextContent(name);
    expect(wordmark).toHaveClass('hp-side-wordmark');
  });
});
