import { vi } from 'vitest';
import type { TurnstileApi, TurnstileRenderOptions } from '../components/turnstile/loadTurnstile';
import { forgetTurnstileLoad } from '../components/turnstile/loadTurnstile';

/**
 * A stand-in for Cloudflare's Turnstile on `window` (MUT-368), so page tests never inject the real script. `pass`
 * mode answers every render with a token at once, like the always-pass test key; `hold` waits for `issue()`;
 * `fail` calls the error callback, like the always-fail key.
 */
export function fakeTurnstile(mode: 'pass' | 'hold' | 'fail' = 'pass') {
  forgetTurnstileLoad();
  const widgets = new Map<string, TurnstileRenderOptions>();
  let next = 0;
  let issued = 0;
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      const id = `w${++next}`;
      widgets.set(id, options);
      if (mode === 'pass') queueMicrotask(() => options.callback(`token-${++issued}`));
      if (mode === 'fail') queueMicrotask(() => options['error-callback']('600010'));
      return id;
    }),
    reset: vi.fn((id: string) => {
      const options = widgets.get(id);
      if (options && mode === 'pass') queueMicrotask(() => options.callback(`token-${++issued}`));
    }),
    remove: vi.fn((id: string) => void widgets.delete(id)),
  };
  vi.stubGlobal('turnstile', api);
  const last = () => [...widgets.values()].at(-1);
  return {
    api,
    last,
    /** `hold` mode: the check finishes now. */
    issue: () => last()?.callback(`token-${++issued}`),
  };
}
