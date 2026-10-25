import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../../lib/theme';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../i18n/HostedLanguageProvider';
import { LanguageSwitch, PortalTitle, Wordmark } from '../Brand';

/**
 * The portal's Wordmark (MUT-104, R6): it heads sign-in, the boot screens and
 * the shell, so the product name must survive the switch to a mark + name lockup.
 */

function renderWordmark(language: 'en' | 'ar', props: Parameters<typeof Wordmark>[0] = {}) {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  return render(
    <HostedLanguageProvider>
      <ThemeProvider>
        <Wordmark {...props} />
      </ThemeProvider>
    </HostedLanguageProvider>,
  );
}

afterEach(() => localStorage.clear());

describe('Wordmark (MUT-104, MUT-402)', () => {
  it('draws the MTB3A logotype in English', () => {
    const { container } = renderWordmark('en');
    expect(screen.getByRole('img', { name: 'MTB3A' })).toBeInTheDocument();
    expect(container.querySelector('.hp-wordmark')).not.toHaveTextContent(/Mutaba3a/);
  });

  it('writes متابعة as live text in Arabic, with no logotype', () => {
    const { container } = renderWordmark('ar');
    expect(container.querySelector('.hp-wordmark .brand-name-ar')).toHaveTextContent('متابعة');
    expect(screen.queryByRole('img', { name: 'MTB3A' })).toBeNull();
  });

  it('heads sign-in, setup, terms-update and the boot screens at a 40px mark, and takes You › App’s 32 (design D3, MUT-426)', () => {
    const { container, unmount } = renderWordmark('en');
    expect(container.querySelector('.hp-wordmark img')).toHaveAttribute('width', '40');
    unmount();
    const app = renderWordmark('en', { className: 'hp-you-wordmark', markSize: 32 }).container;
    expect(app.querySelector('.hp-wordmark')).toHaveClass('hp-you-wordmark');
    expect(app.querySelector('.hp-wordmark img')).toHaveAttribute('width', '32');
  });

  it('leads with the decorative Brand v2 mark for the active theme', () => {
    localStorage.setItem('mutaba3a-theme', 'dark');
    const { container } = renderWordmark('en');
    const img = container.querySelector('.hp-wordmark img');
    expect(img).toHaveAttribute('alt', '');
    expect(img?.getAttribute('src')).toMatch(/\/mark-dark\.svg/);
  });
});

describe('PortalTitle (MUT-402 D3)', () => {
  it('names the tab MTB3A in English and متابعة in Arabic, following the switch', () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
    render(
      <HostedLanguageProvider>
        <PortalTitle />
        <LanguageSwitch />
      </HostedLanguageProvider>,
    );
    expect(document.title).toBe('MTB3A');
    fireEvent.click(screen.getByRole('button', { name: 'عربي' }));
    expect(document.title).toBe('متابعة');
  });
});
