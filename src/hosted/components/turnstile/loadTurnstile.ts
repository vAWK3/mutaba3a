/**
 * Cloudflare Turnstile's script for the portal's two public forms, /signup and /recover (MUT-368, D5). Explicit
 * render, injected once per page and only when a form asks: sign-in and every signed-in page never contact Cloudflare.
 * PORTAL_CSP allows exactly this origin in script-src and frame-src (server/src/app.ts).
 */

export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
/** The global the script calls once `window.turnstile` is ready (explicit render's documented hook). */
export const TURNSTILE_ONLOAD = '__mtb3aTurnstileReady';
export const TURNSTILE_SCRIPT_URL = `${TURNSTILE_ORIGIN}/turnstile/v0/api.js?render=explicit&onload=${TURNSTILE_ONLOAD}`;
/** A script an extension blocks quietly never errors: after this long the form says the check can't run. */
export const TURNSTILE_LOAD_TIMEOUT_MS = 15_000;

export interface TurnstileRenderOptions {
  sitekey: string;
  /** Must equal the server's: `signup` or `recover` (server/src/auth/turnstile.ts compares it exactly). */
  action: string;
  language: string;
  theme: 'auto' | 'light' | 'dark';
  /** `flexible`: the card's width, never under Turnstile's 300 px minimum. */
  size: 'normal' | 'flexible' | 'compact';
  callback: (token: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  /** Returning true tells Turnstile the page handled it, so it doesn't throw. */
  'error-callback': (code: string) => boolean;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: TurnstileRenderOptions): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi } & Record<string, unknown>;

let loading: Promise<TurnstileApi> | null = null;

/** The API, loading Cloudflare's script on the first ask. A failed or silent load is forgotten, so Try again retries. */
export function loadTurnstile(): Promise<TurnstileApi> {
  const win = window as unknown as TurnstileWindow;
  if (win.turnstile) return Promise.resolve(win.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    const timer = window.setTimeout(() => fail('Turnstile did not load in time'), TURNSTILE_LOAD_TIMEOUT_MS);
    function fail(message: string) {
      window.clearTimeout(timer);
      script.remove();
      loading = null;
      reject(new Error(message));
    }
    win[TURNSTILE_ONLOAD] = () => {
      window.clearTimeout(timer);
      if (win.turnstile) resolve(win.turnstile);
      else fail('Turnstile loaded without its API');
    };
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;
    script.addEventListener('error', () => fail('Turnstile could not be loaded'));
    document.head.appendChild(script);
  });
  return loading;
}

/** Tests only: start the next `loadTurnstile()` from nothing. */
export function forgetTurnstileLoad(): void {
  loading = null;
}
