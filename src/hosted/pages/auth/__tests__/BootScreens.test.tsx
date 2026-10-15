import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '../../../../lib/theme';
import { HostedLanguageProvider, PORTAL_LANGUAGE_KEY } from '../../../i18n/HostedLanguageProvider';
import { __resetLoaderChainForTests, LOADER_DELAY_MS, LOADER_SLOW_MS } from '../../../../components/brand/BrandLoader';
import { pageStartsNow } from '../../../../test/pageStart';
import { emptyProfileRoutes, me, ok, renderPortal, stubApi } from '../../../__tests__/harness';
import { ME_TIMEOUT_MS } from '../../../session/me';
import { CheckingSession } from '../BootScreens';

/**
 * MUT-207 D4 (eng review R1): the portal's session check is the boot splash's
 * mark, in the same spot, until the page has waited LOADER_DELAY_MS; then the
 * bloom loader blooms in place and says what it is doing. "Still connecting…"
 * from 3 s (DR5); at 15 s the check gives up and BootUnreachable offers Retry
 * (DR6).
 */

const REDUCE = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: reduce && query === REDUCE,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList,
  );
}

function renderChecking(language: 'en' | 'ar' = 'en') {
  localStorage.setItem(PORTAL_LANGUAGE_KEY, language);
  return render(
    <ThemeProvider>
      <HostedLanguageProvider>
        <CheckingSession />
      </HostedLanguageProvider>
    </ThemeProvider>,
  );
}

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

beforeEach(() => {
  vi.useFakeTimers();
  __resetLoaderChainForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('CheckingSession (MUT-207 D4)', () => {
  it('shows the decorative 80 px mark first, then the loader saying it is checking the session', () => {
    pageStartsNow(0);
    const { container } = renderChecking();
    const splash = container.querySelector('.boot-splash')!;
    expect(splash).not.toBeNull();
    expect(splash.closest('[aria-hidden="true"]')).toBeNull();
    const mark = screen.getByRole('presentation');
    expect(mark).toHaveAttribute('width', '80');
    expect(mark).toHaveClass('boot-splash-mark');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Mutaba3a')).toBeNull();

    advance(LOADER_DELAY_MS);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Checking your session');
    expect(status).not.toHaveClass('brand-loader--enter');
    expect(status.querySelector('svg')).toHaveAttribute('width', '96');
    expect(screen.queryByRole('presentation')).toBeNull();
    expect(container.querySelector('.boot-splash')).toBe(splash);
  });

  it('says it in Arabic', () => {
    pageStartsNow(0);
    renderChecking('ar');
    advance(LOADER_DELAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('جارٍ التحقق من جلستك');
  });

  it('on a slow page load blooms on its first render (DR9)', () => {
    pageStartsNow(2500);
    renderChecking();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
  });

  it('under reduced motion keeps the still mark and shows the words (DR7)', () => {
    prefersReducedMotion(true);
    pageStartsNow(0);
    const { container } = renderChecking();
    advance(LOADER_DELAY_MS);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(container.querySelectorAll('animate, animateTransform')).toHaveLength(0);
    expect(container.querySelector('.brand-loader__caption')).toHaveTextContent('Checking your session');
  });

  it('says "Still connecting…" once the loader has waited 3 s, and the mark stays put (DR5)', () => {
    pageStartsNow(0);
    const { container } = renderChecking();
    advance(LOADER_DELAY_MS);
    const svg = container.querySelector('svg');
    advance(LOADER_SLOW_MS - 1);
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    advance(1);
    expect(screen.getByRole('status').textContent).toBe('Still connecting…');
    expect(container.querySelector('svg')).toBe(svg);
    expect(svg).toHaveAttribute('width', '96');
  });

  it('under reduced motion "Still connecting…" replaces the words at 3 s', () => {
    prefersReducedMotion(true);
    pageStartsNow(0);
    const { container } = renderChecking();
    // Two steps: the loader mounts at LOADER_DELAY_MS and starts its own 3 s
    // timer in an effect, which React commits only between advances.
    advance(LOADER_DELAY_MS);
    advance(LOADER_SLOW_MS);
    expect(container.querySelector('.brand-loader__caption')).toHaveTextContent('Still connecting…');
  });
});

describe('the session check gives up at 15 s (MUT-207 DR6)', () => {
  /** /v1/me that never answers, except by honouring its abort signal; then answers on retry. */
  function slowThenOk() {
    const { fetchMock } = stubApi({ 'GET /v1/me': () => ok(me()), ...emptyProfileRoutes() });
    let meCalls = 0;
    const wrapped = vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      if (new URL(String(input), 'http://portal.test').pathname !== '/v1/me' || ++meCalls > 1) return fetchMock(input, init);
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    });
    vi.stubGlobal('fetch', wrapped);
    return { meCalls: () => meCalls };
  }

  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // AbortSignal.timeout runs on jsdom's own clock: drive it from the faked setTimeout instead
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
      return controller.signal;
    });
    pageStartsNow(2500);
    localStorage.setItem(PORTAL_LANGUAGE_KEY, 'en');
  });

  const flush = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

  /**
   * The portal's routes load lazily, so /v1/me (and its 15 s deadline) starts
   * a few real ticks after render, not at fake time 0. Yield real macrotasks
   * until the request is in flight, so the clock below is measured from it.
   */
  async function untilMeRequested(meCalls: () => number) {
    for (let i = 0; i < 200 && meCalls() === 0; i++) {
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve));
        await vi.advanceTimersByTimeAsync(0);
      });
    }
    expect(meCalls()).toBe(1);
  }

  it('keeps checking until 15 s, then offers Retry, which checks again', async () => {
    const { meCalls } = slowThenOk();
    renderPortal('/');
    await untilMeRequested(meCalls);
    await flush(ME_TIMEOUT_MS - 100);
    expect(screen.getByRole('status')).toHaveTextContent('Still connecting…');
    expect(screen.queryByRole('alert')).toBeNull();

    await flush(100);
    // TanStack Query hands the error to React through a setTimeout(0), which the fake clock holds.
    await flush(1);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent("Can't reach Mutaba3a right now");
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await flush(50);
    expect(meCalls()).toBe(2);
  });

  it('turns the timeout into a network error, not an unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      const { meCalls } = slowThenOk();
      renderPortal('/');
      await untilMeRequested(meCalls);
      await flush(ME_TIMEOUT_MS);
      // TanStack Query hands the error to React through a setTimeout(0), which the fake clock holds.
      await flush(1);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
