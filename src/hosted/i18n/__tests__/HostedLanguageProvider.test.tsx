import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY, useAdoptAccountLocale } from '../HostedLanguageProvider';

/** mut-43-auth-states.md E4: a choice made in this browser wins; otherwise the account's locale applies. */

function Probe() {
  const { language, setLanguage } = useLanguage();
  const adopt = useAdoptAccountLocale();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span>{useT()('hosted.auth.title')}</span>
      <button onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}>switch</button>
      <button onClick={() => adopt('ar')}>adopt-ar</button>
      <button onClick={() => adopt('en')}>adopt-en</button>
    </div>
  );
}

function mount() {
  render(
    <HostedLanguageProvider>
      <Probe />
    </HostedLanguageProvider>,
  );
}

describe('HostedLanguageProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
  });

  it('opens in Arabic in an English browser with nothing stored, and stores nothing (MUT-209)', () => {
    mount();
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(screen.getByText('تسجيل الدخول')).toBeInTheDocument();
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBeNull();
  });

  it('adopts the account locale when this browser has no stored choice, without persisting it', () => {
    mount();
    act(() => screen.getByText('adopt-en').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBeNull();
  });

  it('ignores the account locale once this browser has a stored choice', () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
    mount();
    act(() => screen.getByText('adopt-ar').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('persists an explicit switch, and the default alone never persists', () => {
    mount();
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBeNull();
    act(() => screen.getByText('switch').click());
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBe('en');
    act(() => screen.getByText('adopt-ar').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });
});
