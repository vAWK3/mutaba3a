import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useLanguage, useT } from '../../../lib/i18n/core';
import { api } from '../../api/client';
import { HostedLanguageProvider, PORTAL_ACCOUNT_LOCALE_KEY, PORTAL_LANGUAGE_KEY, useAdoptAccountLocale } from '../HostedLanguageProvider';

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

  it('remembers the adopted account locale as a hint, not a choice, so the next visit boots in it without a flip', () => {
    mount();
    act(() => screen.getByText('adopt-en').click());
    expect(localStorage.getItem(PORTAL_ACCOUNT_LOCALE_KEY)).toBe('en');
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBeNull();
    cleanup();
    mount();
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('lets a choice in this browser beat the remembered account locale', () => {
    localStorage.setItem(PORTAL_ACCOUNT_LOCALE_KEY, 'en');
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    mount();
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
  });

  it('ignores a remembered account locale that is not a language', () => {
    localStorage.setItem(PORTAL_ACCOUNT_LOCALE_KEY, 'fr');
    mount();
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
  });
});

/** MUT-369 (D5): a link from the landing names the page language (`/signup?lang=en`). */
describe('HostedLanguageProvider with a linked language', () => {
  beforeEach(() => localStorage.clear());

  const mountLinked = (linkedLanguage: 'en' | 'ar') =>
    render(
      <HostedLanguageProvider linkedLanguage={linkedLanguage}>
        <Probe />
      </HostedLanguageProvider>,
    );

  it('opens in the link language instead of the Arabic default, and stores nothing', () => {
    mountLinked('en');
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBeNull();
  });

  it('beats a stored choice and the account hint for this load only', () => {
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'ar');
    localStorage.setItem(PORTAL_ACCOUNT_LOCALE_KEY, 'ar');
    mountLinked('en');
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBe('ar');
    cleanup();
    mount();
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
  });

  it('still stores the person’s own switch', () => {
    mountLinked('en');
    act(() => screen.getByText('switch').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(localStorage.getItem(PORTAL_LANGUAGE_KEY)).toBe('ar');
  });
});

/** MUT-464: every API call carries the portal language, so the server names seeded categories in it. */
describe('HostedLanguageProvider and the API language', () => {
  beforeEach(() => localStorage.clear());

  it('sends the language the portal shows, and follows a switch and an adopted account locale', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const sent = async () => {
      await api.expenseCategories('p1');
      const init = (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1];
      return new Headers(init.headers).get('accept-language');
    };
    mount();
    expect(await sent()).toBe('ar');
    act(() => screen.getByText('adopt-en').click());
    expect(await sent()).toBe('en');
    act(() => screen.getByText('switch').click());
    expect(await sent()).toBe('ar');
    cleanup();
    vi.unstubAllGlobals();
  });
});
