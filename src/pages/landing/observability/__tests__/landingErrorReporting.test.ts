import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EARLY_QUEUE_LIMIT,
  reportLandingCrash,
  resetLandingErrorReportingForTests,
  startLandingErrorReporting,
  type LandingErrorReportingOptions,
} from '../landingErrorReporting';
import type { LandingReporter, LandingSentryModule } from '../landingSentry';

/**
 * The landing's gate (MUT-150 D1, eng O5/O8/R1): always in the web entry,
 * small, and the only thing that can load the SDK chunk, on website pages only.
 */

function fakeModule() {
  const reporter: LandingReporter = { reportGlobal: vi.fn(), reportBoundary: vi.fn() };
  const module: LandingSentryModule = { startLandingSentry: vi.fn(() => reporter) };
  return { reporter, module };
}

/** Runs the scheduled load when the test says so, like afterLoadIdle firing. */
function manualSchedule() {
  let pending: (() => void) | null = null;
  return {
    schedule: (run: () => void) => {
      pending = run;
      return () => {
        pending = null;
      };
    },
    fire: () => pending?.(),
  };
}

function start(overrides: Partial<LandingErrorReportingOptions> = {}) {
  const { reporter, module } = fakeModule();
  const timing = manualSchedule();
  const load = vi.fn(() => Promise.resolve(module));
  startLandingErrorReporting({ enabled: true, load, schedule: timing.schedule, ...overrides });
  return { reporter, module, load, fire: timing.fire };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const throwOnWindow = (error: unknown) => window.dispatchEvent(new ErrorEvent('error', { error, message: String(error) }));
const rejectOnWindow = (reason: unknown) => {
  const event = new Event('unhandledrejection') as PromiseRejectionEvent;
  Object.defineProperty(event, 'reason', { value: reason });
  window.dispatchEvent(event);
};

afterEach(() => {
  resetLandingErrorReportingForTests();
  window.history.replaceState(null, '', '/');
});

describe('landingErrorReporting (MUT-150)', () => {
  it('does nothing in a build without a DSN', async () => {
    const { load, fire } = start({ enabled: false });
    fire();
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it.each(['/app', '/app/clients', '/hosted', '/unknown'])('never starts on %s: only website pages may report (ADR-024)', async (path) => {
    window.history.replaceState(null, '', path);
    const { load, fire } = start();
    fire();
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it('loads the SDK only when the page has loaded and gone idle, never before', async () => {
    const { load, fire } = start();
    await settle();
    expect(load).not.toHaveBeenCalled();
    fire();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it(`holds up to ${EARLY_QUEUE_LIMIT} early errors, then hands them over in order`, async () => {
    const { reporter, fire } = start();
    const errors = Array.from({ length: EARLY_QUEUE_LIMIT + 2 }, (_, index) => new Error(`early ${index}`));
    errors.forEach(throwOnWindow);
    fire();
    await settle();
    expect(vi.mocked(reporter.reportGlobal).mock.calls.map(([error]) => error)).toEqual(errors.slice(0, EARLY_QUEUE_LIMIT));
  });

  it('holds unhandled rejections too', async () => {
    const { reporter, fire } = start();
    rejectOnWindow(new Error('rejected'));
    fire();
    await settle();
    expect(reporter.reportGlobal).toHaveBeenCalledWith(new Error('rejected'));
  });

  it('ignores a window error with no error object (a cross-origin "Script error.")', async () => {
    const { reporter, fire } = start();
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    fire();
    await settle();
    expect(reporter.reportGlobal).not.toHaveBeenCalled();
  });

  it('holds a crash the error boundary caught before the SDK arrived, then sends it once', async () => {
    const { reporter, fire } = start();
    reportLandingCrash(new Error('render'), '\n    at Hero');
    fire();
    await settle();
    expect(reporter.reportBoundary).toHaveBeenCalledTimes(1);
    expect(reporter.reportBoundary).toHaveBeenCalledWith(new Error('render'), '\n    at Hero');
  });

  it('sends a boundary crash straight to the SDK once it is up', async () => {
    const { reporter, fire } = start();
    fire();
    await settle();
    reportLandingCrash(new Error('later'));
    expect(reporter.reportBoundary).toHaveBeenCalledWith(new Error('later'), undefined);
  });

  it("stops forwarding window errors after the handover: the SDK's own handlers send them, once (eng O8)", async () => {
    const { reporter, fire } = start();
    fire();
    await settle();
    throwOnWindow(new Error('after'));
    rejectOnWindow(new Error('after rejection'));
    expect(reporter.reportGlobal).not.toHaveBeenCalled();
  });

  it('drops what it holds once the page is no longer a website page (eng R1)', async () => {
    const { reporter, fire } = start();
    throwOnWindow(new Error('on the landing'));
    window.history.pushState(null, '', '/app/clients');
    throwOnWindow(new Error('in the app'));
    reportLandingCrash(new Error('app crash'));
    fire();
    await settle();
    expect(reporter.reportGlobal).not.toHaveBeenCalled();
    expect(reporter.reportBoundary).not.toHaveBeenCalled();
  });

  it('ignores a rejection with no reason, as it ignores an error event with none', async () => {
    const { reporter, fire } = start();
    rejectOnWindow(undefined);
    fire();
    await settle();
    expect(reporter.reportGlobal).not.toHaveBeenCalled();
  });

  it('forgets everything, stops listening and never throws when the chunk fails to load (ad blocker, stale tab)', async () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    const { fire } = start({ load: () => Promise.reject(new Error('chunk 404')) });
    throwOnWindow(new Error('held'));
    fire();
    await settle();
    expect(removed).toHaveBeenCalledWith('error', expect.any(Function));
    expect(removed).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(() => reportLandingCrash(new Error('after failure'))).not.toThrow();
    // Nothing is held or retried for the rest of the page load
    const retry = start();
    retry.fire();
    await settle();
    expect(retry.load).not.toHaveBeenCalled();
  });

  it('starts once, however often main.tsx is evaluated', async () => {
    const first = start();
    const second = start();
    first.fire();
    second.fire();
    await settle();
    expect(first.load).toHaveBeenCalledTimes(1);
    expect(second.load).not.toHaveBeenCalled();
  });

  it('ignores boundary crashes when it never started', () => {
    expect(() => reportLandingCrash(new Error('no gate'))).not.toThrow();
  });
});
