import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import { useTurnstile, type TurnstileStatus } from '../useTurnstile';
import type { TurnstileApi, TurnstileRenderOptions } from '../loadTurnstile';

/** MUT-368: the widget's life on a form: rendered with the form's action and the page's language, single-use tokens. */

function fakeTurnstile() {
  const widgets = new Map<string, TurnstileRenderOptions>();
  let next = 0;
  const api: TurnstileApi = {
    render: vi.fn((_el: HTMLElement, options: TurnstileRenderOptions) => {
      const id = `w${++next}`;
      widgets.set(id, options);
      return id;
    }),
    reset: vi.fn(),
    remove: vi.fn((id: string) => void widgets.delete(id)),
  };
  const last = () => [...widgets.values()].at(-1)!;
  return { api, widgets, last };
}

type Seen = { token: string | null; status: TurnstileStatus; reset: () => void; retry: () => void };
/** What the hook last returned; a mutable box, since a test reads it from outside React. */
const box: { seen: Seen | null } = { seen: null };

function Probe({ action, language, load, onToken }: { action: 'signup' | 'recover'; language: 'en' | 'ar'; load: () => Promise<TurnstileApi>; onToken?: (token: string) => void }) {
  const { containerRef, ...widget } = useTurnstile({ action, language, load, onToken });
  useEffect(() => {
    box.seen = widget;
  });
  return <div data-testid="box" ref={containerRef} />;
}

const flush = () => act(async () => {});

afterEach(() => {
  box.seen = null;
});

describe('useTurnstile', () => {
  it('renders once loaded, with the form’s action, the page’s language and the build’s site key, managed and themed', async () => {
    const fake = fakeTurnstile();
    render(<Probe action="signup" language="ar" load={() => Promise.resolve(fake.api)} />);
    expect(box.seen!.status).toBe('loading');
    await flush();
    expect(fake.api.render).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fake.api.render).mock.calls[0]![0]).toBe(screen.getByTestId('box'));
    expect(fake.last()).toMatchObject({ sitekey: '1x00000000000000000000AA', action: 'signup', language: 'ar', theme: 'auto' });
  });

  it('a token makes it ready and is handed to the form; expiry and timeout take it back', async () => {
    const fake = fakeTurnstile();
    const onToken = vi.fn();
    render(<Probe action="recover" language="en" load={() => Promise.resolve(fake.api)} onToken={onToken} />);
    await flush();
    act(() => fake.last().callback('tok-1'));
    expect(box.seen).toMatchObject({ token: 'tok-1', status: 'ready' });
    expect(onToken).toHaveBeenCalledWith('tok-1');
    act(() => fake.last()['expired-callback']());
    expect(box.seen).toMatchObject({ token: null, status: 'loading' });
    act(() => fake.last().callback('tok-2'));
    act(() => fake.last()['timeout-callback']());
    expect(box.seen).toMatchObject({ token: null, status: 'loading' });
  });

  it('a widget error, or a script that never loads, fails; Try again renders a fresh widget', async () => {
    const fake = fakeTurnstile();
    render(<Probe action="signup" language="en" load={() => Promise.resolve(fake.api)} />);
    await flush();
    let handled: unknown;
    act(() => {
      handled = fake.last()['error-callback']('300030');
    });
    expect(handled).toBe(true);
    expect(box.seen).toMatchObject({ token: null, status: 'failed' });
    act(() => box.seen!.retry());
    await flush();
    expect(fake.api.remove).toHaveBeenCalledWith('w1');
    expect(fake.api.render).toHaveBeenCalledTimes(2);
    expect(box.seen!.status).toBe('loading');

    let rejectLoad!: (e: Error) => void;
    render(<Probe action="signup" language="en" load={() => new Promise((_, reject) => (rejectLoad = reject))} />);
    await act(async () => rejectLoad(new Error('blocked')));
    expect(box.seen!.status).toBe('failed');
  });

  it('a render Cloudflare refuses, or one that names no widget, is a failed check, never a silent wait (review #4)', async () => {
    const throwing: TurnstileApi = { render: () => { throw new Error('bad sitekey'); }, reset: vi.fn(), remove: vi.fn() };
    render(<Probe action="signup" language="en" load={() => Promise.resolve(throwing)} />);
    await flush();
    expect(box.seen!.status).toBe('failed');
    const silent: TurnstileApi = { render: () => undefined, reset: vi.fn(), remove: vi.fn() };
    render(<Probe action="signup" language="en" load={() => Promise.resolve(silent)} />);
    await flush();
    expect(box.seen!.status).toBe('failed');
  });

  it('reset() spends the token: the widget runs again and the form waits for a new one', async () => {
    const fake = fakeTurnstile();
    render(<Probe action="signup" language="en" load={() => Promise.resolve(fake.api)} />);
    await flush();
    act(() => fake.last().callback('tok-1'));
    act(() => box.seen!.reset());
    expect(fake.api.reset).toHaveBeenCalledWith('w1');
    expect(box.seen).toMatchObject({ token: null, status: 'loading' });
  });

  it('a language switch renders the widget again in the new language; leaving the page removes it', async () => {
    const fake = fakeTurnstile();
    const load = () => Promise.resolve(fake.api);
    const view = render(<Probe action="signup" language="en" load={load} />);
    await flush();
    act(() => fake.last().callback('tok-en'));
    view.rerender(<Probe action="signup" language="ar" load={load} />);
    await flush();
    expect(fake.api.remove).toHaveBeenCalledWith('w1');
    expect(fake.last().language).toBe('ar');
    expect(box.seen).toMatchObject({ token: null, status: 'loading' });
    view.unmount();
    expect(fake.api.remove).toHaveBeenCalledWith('w2');
  });
});
