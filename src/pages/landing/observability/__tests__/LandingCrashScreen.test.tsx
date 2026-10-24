import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../../../components/ui/ErrorBoundary';
import { LandingProviders } from '../../LandingProviders';
import { LandingCrashScreen } from '../LandingCrashScreen';
import { chooseLanguage } from '../../../../test/language';

function Broken(): never {
  throw new Error('render crash');
}

function renderCrash(onError = vi.fn()) {
  render(
    <LandingProviders>
      <ErrorBoundary onError={onError} fallback={<LandingCrashScreen />}>
        <Broken />
      </ErrorBoundary>
    </LandingProviders>,
  );
  return onError;
}

/** A crash on a website page shows the website's own screen in the visitor's language (MUT-150 eng D9). */
describe('LandingCrashScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens in Arabic, says nothing about "your data", and reports the crash once', () => {
    const onError = renderCrash();
    expect(screen.getByRole('heading', { name: 'لم تُعرض هذه الصفحة كما ينبغي' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'إعادة تحميل الصفحة' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/data|بيانات/i);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toEqual(new Error('render crash'));
  });

  it('speaks English to a visitor who chose English', () => {
    chooseLanguage('en');
    renderCrash();
    expect(screen.getByRole('heading', { name: "This page didn't load properly" })).toBeInTheDocument();
    expect(screen.getByText('Something went wrong on our side. Reloading the page usually fixes it.')).toBeInTheDocument();
  });

  it('reloads the page from its button', () => {
    const reload = vi.fn();
    vi.spyOn(window, 'location', 'get').mockReturnValue({ ...window.location, reload });
    chooseLanguage('en');
    renderCrash();
    fireEvent.click(screen.getByRole('button', { name: 'Reload page' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
