import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useDirection, useLanguage } from '../../../lib/i18n';
import { LandingProviders, LANDING_DEFAULT_LANGUAGE } from '../LandingProviders';
import { chooseLanguage } from '../../../test/language';

function Probe() {
  const { language } = useLanguage();
  const direction = useDirection();
  return (
    <p data-testid="probe">
      {language} {direction}
    </p>
  );
}

/** The marketing site opens in Arabic whatever the system says, and leaves the app's language alone (MUT-202). */
describe('LandingProviders language', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it('defaults to Arabic', () => {
    expect(LANDING_DEFAULT_LANGUAGE).toBe('ar');
  });

  it('opens in Arabic, right to left, in an English browser with nothing stored, and stores nothing', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    render(
      <LandingProviders>
        <Probe />
      </LandingProviders>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('ar rtl');
    expect(document.documentElement.lang).toBe('ar');
    expect(localStorage.getItem('mutaba3a-language')).toBeNull();
  });

  it('keeps a visitor\'s own choice', () => {
    chooseLanguage('en');
    render(
      <LandingProviders>
        <Probe />
      </LandingProviders>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('en ltr');
  });

  it('opens in Arabic for a visitor whose English was only ever detected, by the app or by the landing before MUT-202', () => {
    localStorage.setItem('mutaba3a-language', 'en');
    render(
      <LandingProviders>
        <Probe />
      </LandingProviders>,
    );
    expect(screen.getByTestId('probe')).toHaveTextContent('ar rtl');
    expect(localStorage.getItem('mutaba3a-language')).toBe('en');
  });
});
