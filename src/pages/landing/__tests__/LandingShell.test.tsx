import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LandingShell } from '../LandingShell';
import { resetLandingErrorReportingForTests, startLandingErrorReporting } from '../observability/landingErrorReporting';
import type { LandingReporter } from '../observability/landingSentry';

function Broken(): never {
  throw new Error('hero crashed');
}

/** The wiring main.tsx relies on (MUT-150 review): a website page's crash shows its screen and reaches the reports. */
describe('LandingShell', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    resetLandingErrorReportingForTests();
    vi.restoreAllMocks();
  });

  it('shows the website crash screen and reports the crash once, with its component stack', async () => {
    const reporter: LandingReporter = { reportGlobal: vi.fn(), reportBoundary: vi.fn() };
    let load: (() => void) | null = null;
    startLandingErrorReporting({
      enabled: true,
      load: () => Promise.resolve({ startLandingSentry: () => reporter }),
      schedule: (run) => {
        load = run;
        return () => undefined;
      },
    });

    render(
      <LandingShell>
        <Broken />
      </LandingShell>,
    );
    expect(await screen.findByRole('heading', { level: 1, name: 'لم تُعرض هذه الصفحة كما ينبغي' })).toBeInTheDocument();

    load!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(reporter.reportBoundary).toHaveBeenCalledTimes(1);
    expect(reporter.reportBoundary).toHaveBeenCalledWith(new Error('hero crashed'), expect.stringContaining('Broken'));
  });
});
