import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../../../components/ui/ErrorBoundary';
import { LandingProviders } from '../../LandingProviders';
import { LandingCrashScreen } from '../LandingCrashScreen';
import { chooseLanguage } from '../../../../test/language';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
    // The crash screen is the whole page, so it carries the page's one h1 (review D3)
    expect(screen.getByRole('heading', { level: 1, name: 'لم تُعرض هذه الصفحة كما ينبغي' })).toBeInTheDocument();
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

  it('gives its only action a phone-sized touch target', () => {
    chooseLanguage('en');
    renderCrash();
    expect(screen.getByRole('button', { name: 'Reload page' }).closest('.landing-crash')).not.toBeNull();
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/ErrorBoundary.css'), 'utf8');
    expect(css).toMatch(/\.landing-crash \.btn\s*\{[^}]*min-height: 44px/);
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
