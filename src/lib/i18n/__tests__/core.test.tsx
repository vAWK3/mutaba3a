import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { LanguageProvider, useLanguage } from '../context';
import { DEFAULT_LANGUAGE, I18nProvider, createTranslator, useT } from '../core';

const DICT = {
  en: { greet: { hello: 'Hello, {name}' }, plain: 'Plain' },
  ar: { greet: { hello: 'مرحباً، {name}' }, plain: 'عادي' },
};

describe('createTranslator', () => {
  const t = createTranslator(DICT.en, 'en');

  it('walks nested keys and interpolates every {var}', () => {
    expect(t('greet.hello', { name: 'Nour' })).toBe('Hello, Nour');
    expect(t('plain')).toBe('Plain');
  });

  it('returns the key itself for a missing or non-string value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(t('greet.nope')).toBe('greet.nope');
    expect(t('greet')).toBe('greet');
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

function Probe() {
  const { language, direction, setLanguage } = useLanguage();
  const t = useT();
  return (
    <div>
      <span data-testid="lang">{language}</span>
      <span data-testid="dir">{direction}</span>
      <span data-testid="text">{t('nav.overview')}</span>
      <button onClick={() => setLanguage(language === 'en' ? 'ar' : 'en')}>switch</button>
    </div>
  );
}

describe('I18nProvider (controlled)', () => {
  it('provides t and direction for the given language and sets <html lang dir>', () => {
    function Text() {
      return <span>{useT()('greet.hello', { name: 'Nour' })}</span>;
    }
    render(
      <I18nProvider translations={DICT} language="ar" setLanguage={() => {}}>
        <Text />
      </I18nProvider>,
    );
    expect(screen.getByText('مرحباً، Nour')).toBeInTheDocument();
    expect(document.documentElement.lang).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('LanguageProvider (the app) behaves as before the split', () => {
  beforeEach(() => localStorage.clear());

  it('uses a stored choice, persists on mount and on change, and flips direction', () => {
    localStorage.setItem('mutaba3a-language', 'ar');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
    expect(screen.getByTestId('text')).toHaveTextContent('نظرة عامة');
    act(() => screen.getByText('switch').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(localStorage.getItem('mutaba3a-language')).toBe('en');
    expect(document.documentElement.dir).toBe('ltr');
  });

  it('detects the system language when nothing is stored, and persists it on mount', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('ar-PS');
    render(
      <LanguageProvider>
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(localStorage.getItem('mutaba3a-language')).toBe('ar');
  });
});

describe('LanguageProvider with a defaultLanguage (the marketing site, MUT-202)', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('opens in the default whatever the system language, and stores nothing until someone chooses', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
    expect(localStorage.getItem('mutaba3a-language')).toBeNull();
  });

  it('lets a person\'s stored choice win over the default', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    localStorage.setItem('mutaba3a-language-chosen', '1');
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });

  it('stores the language once someone presses the switch', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    act(() => screen.getByText('switch').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
    expect(localStorage.getItem('mutaba3a-language')).toBe('en');
    expect(localStorage.getItem('mutaba3a-language-chosen')).toBe('1');
  });

  it('does not let a language stored by detection beat the default', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    expect(localStorage.getItem('mutaba3a-language')).toBe('en');
  });

  it('ignores a stored value that is not a language', () => {
    localStorage.setItem('mutaba3a-language', 'fr');
    localStorage.setItem('mutaba3a-language-chosen', '1');
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
  });

  it('still renders, in the default, when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(
      <LanguageProvider defaultLanguage="ar">
        <Probe />
      </LanguageProvider>,
    );
    expect(screen.getByTestId('lang')).toHaveTextContent('ar');
    act(() => screen.getByText('switch').click());
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });
});

describe('DEFAULT_LANGUAGE (MUT-209)', () => {
  it('is Arabic: every surface opens in Arabic until a person chooses', () => {
    expect(DEFAULT_LANGUAGE).toBe('ar');
  });
});

