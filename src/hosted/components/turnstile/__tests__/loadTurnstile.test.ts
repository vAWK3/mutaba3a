import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURNSTILE_LOAD_TIMEOUT_MS, TURNSTILE_ONLOAD, TURNSTILE_SCRIPT_URL, forgetTurnstileLoad, loadTurnstile, type TurnstileApi } from '../loadTurnstile';

/** MUT-368 (D5): Cloudflare's script, explicit render, injected once per page and only when a form asks for it. */

type Win = Window & { turnstile?: TurnstileApi } & Record<string, unknown>;
const win = window as unknown as Win;
const fakeApi: TurnstileApi = { render: () => 'w1', reset: () => {}, remove: () => {} };
const scripts = () => [...document.head.querySelectorAll('script')].filter((s) => s.src.startsWith('https://challenges.cloudflare.com/'));

beforeEach(() => {
  forgetTurnstileLoad();
  delete win.turnstile;
  for (const s of scripts()) s.remove();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('loadTurnstile', () => {
  it('asks for explicit render with our onload callback, from Cloudflare only', () => {
    expect(TURNSTILE_SCRIPT_URL).toBe(`https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_ONLOAD}`);
  });

  it('injects one script however many callers ask, and resolves with the API when Cloudflare calls back', async () => {
    const first = loadTurnstile();
    const second = loadTurnstile();
    expect(scripts()).toHaveLength(1);
    expect(scripts()[0]!.src).toBe(TURNSTILE_SCRIPT_URL);
    win.turnstile = fakeApi;
    (win[TURNSTILE_ONLOAD] as () => void)();
    await expect(first).resolves.toBe(fakeApi);
    await expect(second).resolves.toBe(fakeApi);
  });

  it('answers at once when the API is already on the page', async () => {
    win.turnstile = fakeApi;
    await expect(loadTurnstile()).resolves.toBe(fakeApi);
    expect(scripts()).toHaveLength(0);
  });

  it('a script that fails to load rejects, and the next ask tries again with a fresh script', async () => {
    const first = loadTurnstile();
    scripts()[0]!.dispatchEvent(new Event('error'));
    await expect(first).rejects.toThrow(/Turnstile/);
    expect(scripts()).toHaveLength(0);
    void loadTurnstile();
    expect(scripts()).toHaveLength(1);
  });

  it('a script that never answers (blocked without an error) gives up after the timeout', async () => {
    vi.useFakeTimers();
    const pending = loadTurnstile();
    const settled = expect(pending).rejects.toThrow(/Turnstile/);
    await vi.advanceTimersByTimeAsync(TURNSTILE_LOAD_TIMEOUT_MS);
    await settled;
  });
});
