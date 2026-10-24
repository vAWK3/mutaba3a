import { useCallback, useEffect, useRef, useState } from 'react';
import { loadTurnstile, type TurnstileApi } from './loadTurnstile';

/**
 * One Turnstile widget on a form (MUT-368). Rendered with the form's action and the page's language (MUT-197 D2),
 * rendered again when either changes, removed when the form goes. A token is single-use (300 s at most), so the form
 * calls `reset()` after every answer and waits for the next one; `onToken` hands it over the moment it arrives, which
 * is how a press of Continue made before the check finished goes through (D15).
 */

export type TurnstileStatus = 'loading' | 'ready' | 'failed';
export type TurnstileAction = 'signup' | 'recover';

/** Cloudflare's published always-pass site key, when the build named none (tests). Builds always define one. */
const TEST_SITE_KEY = '1x00000000000000000000AA';

function siteKey(): string {
  return typeof __TURNSTILE_SITE_KEY__ !== 'undefined' && __TURNSTILE_SITE_KEY__ ? __TURNSTILE_SITE_KEY__ : TEST_SITE_KEY;
}

interface Options {
  action: TurnstileAction;
  language: 'en' | 'ar';
  /** Injectable for tests; defaults to Cloudflare's script. */
  load?: () => Promise<TurnstileApi>;
  onToken?: (token: string) => void;
}

interface WidgetState {
  /** Which render this state belongs to: a new action, language or Try again starts from nothing. */
  generation: string;
  token: string | null;
  status: TurnstileStatus;
}

export function useTurnstile({ action, language, load = loadTurnstile, onToken }: Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const latest = useRef({ load, onToken });
  useEffect(() => {
    latest.current = { load, onToken };
  });

  const [attempt, setAttempt] = useState(0);
  const generation = `${action}|${language}|${attempt}`;
  const [state, setState] = useState<WidgetState>({ generation, token: null, status: 'loading' });
  // A new render starts with no token, decided while rendering rather than in an effect (react-hooks v7).
  let current = state;
  if (state.generation !== generation) {
    current = { generation, token: null, status: 'loading' };
    setState(current);
  }

  useEffect(() => {
    let live = true;
    let rendered: { api: TurnstileApi; id: string } | null = null;
    const update = (token: string | null, status: TurnstileStatus) => {
      if (live) setState({ generation, token, status });
    };
    latest.current.load().then(
      (api) => {
        const container = containerRef.current;
        if (!live || !container) return;
        let id: string | undefined;
        try {
          id = api.render(container, {
            sitekey: siteKey(),
            action,
            language,
            theme: 'auto',
            size: 'flexible',
            callback: (token) => {
              update(token, 'ready');
              if (live) latest.current.onToken?.(token);
            },
            // Managed mode fetches a fresh token by itself; until then there is none to send.
            'expired-callback': () => update(null, 'loading'),
            'timeout-callback': () => update(null, 'loading'),
            'error-callback': () => {
              update(null, 'failed');
              return true;
            },
          });
        } catch {
          // A render Cloudflare refuses (a bad parameter, an API change) is a check that can't run, never a silent wait.
          id = undefined;
        }
        if (!id) return update(null, 'failed');
        widget.current = rendered = { api, id };
      },
      () => update(null, 'failed'),
    );
    return () => {
      live = false;
      if (!rendered) return;
      rendered.api.remove(rendered.id);
      if (widget.current === rendered) widget.current = null;
    };
  }, [action, language, generation]);

  /** The token was spent (any answer to a submit): run the check again. */
  const reset = useCallback(() => {
    const w = widget.current;
    if (w) w.api.reset(w.id);
    setState({ generation, token: null, status: 'loading' });
  }, [generation]);

  /** After a failure: a fresh widget (and a fresh script, if that was what failed). */
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { containerRef, token: current.token, status: current.status, reset, retry };
}
