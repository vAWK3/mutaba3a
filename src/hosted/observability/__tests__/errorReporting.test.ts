import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setMode, setUnhintedMode, MODE_KEY } from '../../session/mode';
import { EARLY_QUEUE_LIMIT, reportBoundaryError, resetErrorReportingForTests, setReporterUser, startErrorReporting } from '../errorReporting';
import type { PortalReporter, PortalSentryModule } from '../portalSentry';

/** A stand-in for the lazy chunk: records what the gate hands it. */
function fakeChunk() {
  const reporter = { reportGlobal: vi.fn(), reportBoundary: vi.fn(), setUser: vi.fn(), stop: vi.fn() } satisfies PortalReporter;
  const startPortalSentry = vi.fn(() => reporter);
  const load = vi.fn(async (): Promise<PortalSentryModule> => ({ startPortalSentry }));
  return { reporter, startPortalSentry, load };
}

const currentRouteId = () => '/authed/p/$profileId/';
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function throwGlobally(error: unknown) {
  window.dispatchEvent(new ErrorEvent('error', { error, message: String(error), cancelable: true }));
}

/** Marks the synthetic window errors as handled, so Vitest doesn't report them as the test's own. */
const handled = (event: Event) => event.preventDefault();

function rejectGlobally(reason: unknown) {
  const event = new Event('unhandledrejection') as Event & { reason?: unknown };
  event.reason = reason;
  window.dispatchEvent(event);
}

beforeEach(() => {
  window.addEventListener('error', handled);
  localStorage.removeItem(MODE_KEY);
  setUnhintedMode('remote');
});

afterEach(() => {
  window.removeEventListener('error', handled);
  resetErrorReportingForTests();
});

describe('the crash-reporting gate (MUT-149 D1, ADR-097 §10)', () => {
  it('does nothing in a build without a DSN', async () => {
    const chunk = fakeChunk();
    startErrorReporting({ enabled: false, currentRouteId, load: chunk.load });
    throwGlobally(new Error('boom'));
    await flush();
    expect(chunk.load).not.toHaveBeenCalled();
  });

  it('never loads the SDK signed out (local mode)', async () => {
    setMode('local');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    throwGlobally(new Error('boom'));
    reportBoundaryError(new Error('render'));
    await flush();
    expect(chunk.load).not.toHaveBeenCalled();
  });

  it('loads the SDK once when signed in, and hands it the route reader', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    setMode('remote');
    await flush();
    expect(chunk.load).toHaveBeenCalledTimes(1);
    expect(chunk.startPortalSentry).toHaveBeenCalledWith({ currentRouteId });
  });

  it('holds errors from before the SDK arrives and replays them in order (R1)', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    const first = new Error('first');
    const second = new Error('second');
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    throwGlobally(first);
    reportBoundaryError(second, '\n    at Page');
    await flush();
    expect(chunk.reporter.reportGlobal).toHaveBeenCalledWith(first);
    expect(chunk.reporter.reportBoundary).toHaveBeenCalledWith(second, '\n    at Page');
    expect(chunk.reporter.reportGlobal.mock.invocationCallOrder[0]).toBeLessThan(chunk.reporter.reportBoundary.mock.invocationCallOrder[0]);
  });

  it('holds unhandled rejections too', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    const reason = new Error('rejected');
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    rejectGlobally(reason);
    await flush();
    expect(chunk.reporter.reportGlobal).toHaveBeenCalledWith(reason);
  });

  it(`keeps at most ${EARLY_QUEUE_LIMIT} early errors, the first ones`, async () => {
    localStorage.removeItem(MODE_KEY);
    setUnhintedMode('probe');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    const errors = Array.from({ length: EARLY_QUEUE_LIMIT + 5 }, (_, i) => new Error(`e${i}`));
    errors.forEach(throwGlobally);
    setMode('remote');
    await flush();
    expect(chunk.reporter.reportGlobal).toHaveBeenCalledTimes(EARLY_QUEUE_LIMIT);
    expect(chunk.reporter.reportGlobal).toHaveBeenNthCalledWith(1, errors[0]);
  });

  it('discards held errors when the visit turns out to be signed out', async () => {
    localStorage.removeItem(MODE_KEY);
    setUnhintedMode('probe');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    throwGlobally(new Error('before the probe answered'));
    setMode('local');
    setMode('remote');
    await flush();
    expect(chunk.reporter.reportGlobal).not.toHaveBeenCalled();
  });

  it('lets the SDK own window errors once it has loaded, so nothing is sent twice', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    await flush();
    throwGlobally(new Error('after load'));
    expect(chunk.reporter.reportGlobal).not.toHaveBeenCalled();
    const render = new Error('render');
    reportBoundaryError(render);
    expect(chunk.reporter.reportBoundary).toHaveBeenCalledWith(render, undefined);
  });

  it('stops the SDK and forgets the user on sign-out, and starts again on the next sign-in', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    setReporterUser('u1');
    await flush();
    expect(chunk.reporter.setUser).toHaveBeenLastCalledWith('u1');
    setMode('local');
    expect(chunk.reporter.stop).toHaveBeenCalledTimes(1);
    reportBoundaryError(new Error('signed out'));
    expect(chunk.reporter.reportBoundary).not.toHaveBeenCalled();
    setMode('remote');
    await flush();
    expect(chunk.startPortalSentry).toHaveBeenCalledTimes(2);
    expect(chunk.reporter.setUser).toHaveBeenLastCalledWith(null);
  });

  it('passes the user to an SDK that loads later', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    setReporterUser('u2');
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    await flush();
    expect(chunk.reporter.setUser).toHaveBeenCalledWith('u2');
  });

  it('swallows a chunk that fails to load: no throw, no retry, nothing held (F11)', async () => {
    setMode('remote');
    const load = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    startErrorReporting({ enabled: true, currentRouteId, load });
    throwGlobally(new Error('held'));
    await flush();
    setMode('remote');
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    // A mode change is the next chance
    setMode('local');
    setMode('remote');
    await flush();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('ignores a window error with no error object (a cross-origin "Script error.")', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.', cancelable: true }));
    await flush();
    expect(chunk.reporter.reportGlobal).not.toHaveBeenCalled();
  });

  it('starts once, however often it is called', async () => {
    setMode('remote');
    const chunk = fakeChunk();
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    startErrorReporting({ enabled: true, currentRouteId, load: chunk.load });
    throwGlobally(new Error('once'));
    await flush();
    expect(chunk.reporter.reportGlobal).toHaveBeenCalledTimes(1);
  });
});
