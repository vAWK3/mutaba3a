import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { HostedLanguageProvider } from '../../i18n/HostedLanguageProvider';
import { ACTIVATING_EVERY_MS, ACTIVATING_MAX_MS, activatingPhase, useActivatingPoll } from '../../data/activatingPoll';
import { ActivatingMotion } from '../ActivatingMotion';
import { ACTIVATING_HOP_MS, hopEnd } from '../activatingHop';
import { ActivatingStatus } from '../ActivatingStatus';

/**
 * MUT-770 (DR-5, DR-11): after Stripe, the desk polls up to 2 minutes; `motion-activating` loops while it waits,
 * finishes its hop and resolves on the active pose; Activating and Active are said in a polite live region.
 */

const css = readFileSync(join(process.cwd(), 'src/hosted/hosted.css'), 'utf8');

function reducedMotion(on: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: on && query.includes('reduce'), media: query, addEventListener: () => {}, removeEventListener: () => {} }));
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.documentElement.dir = '';
});

describe('activatingPhase', () => {
  it('is active once paid, late past 2 minutes, activating before', () => {
    expect(activatingPhase(false, 0, ACTIVATING_MAX_MS - 1)).toBe('activating');
    expect(activatingPhase(false, 0, ACTIVATING_MAX_MS)).toBe('late');
    expect(activatingPhase(true, 0, 10)).toBe('active');
    expect(activatingPhase(true, 0, ACTIVATING_MAX_MS * 2)).toBe('active');
  });
});

describe('useActivatingPoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-28T10:00:00Z'));
  });

  it('asks again every few seconds and stops at 2 minutes with late', () => {
    const poll = vi.fn();
    const startedAt = Date.now();
    const { result } = renderHook(() => useActivatingPoll({ startedAt, paid: false, poll }));
    expect(result.current).toBe('activating');
    act(() => {
      vi.advanceTimersByTime(ACTIVATING_EVERY_MS);
    });
    expect(poll).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(ACTIVATING_MAX_MS);
    });
    expect(result.current).toBe('late');
    const calls = poll.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(ACTIVATING_EVERY_MS * 5);
    });
    expect(poll).toHaveBeenCalledTimes(calls);
  });

  it('turns active the moment the list says paid, and stops asking', () => {
    const poll = vi.fn();
    const startedAt = Date.now();
    const { result, rerender } = renderHook(({ paid }) => useActivatingPoll({ startedAt, paid, poll }), { initialProps: { paid: false } });
    rerender({ paid: true });
    expect(result.current).toBe('active');
    act(() => {
      vi.advanceTimersByTime(ACTIVATING_EVERY_MS * 3);
    });
    expect(poll).not.toHaveBeenCalled();
  });

  it('a page opened late (a reload after 2 minutes) is late at once', () => {
    const startedAt = Date.now() - ACTIVATING_MAX_MS;
    const { result } = renderHook(() => useActivatingPoll({ startedAt, paid: false, poll: () => {} }));
    expect(result.current).toBe('late');
  });
});

describe('ActivatingMotion', () => {
  beforeEach(() => reducedMotion(false));

  it('knows which dot the current hop ends on and when', () => {
    expect(hopEnd(0)).toEqual({ dot: 1, inMs: ACTIVATING_HOP_MS });
    expect(hopEnd(620)).toEqual({ dot: 2, inMs: 380 });
    expect(hopEnd(1200)).toEqual({ dot: 0, inMs: 300 });
    expect(hopEnd(1500 + 100)).toEqual({ dot: 1, inMs: 400 });
  });

  it('loops over three dots with the check undrawn, then finishes the hop and resolves from the dot it reached', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<ActivatingMotion done={false} />);
    const art = container.querySelector('.hp-activating')!;
    expect(art).toHaveAttribute('data-phase', 'loop');
    expect(art).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelectorAll('[data-part="dot"]')).toHaveLength(3);
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{6}/i);
    rerender(<ActivatingMotion done />);
    expect(art).toHaveAttribute('data-phase', 'loop');
    act(() => {
      vi.advanceTimersByTime(ACTIVATING_HOP_MS);
    });
    expect(container.querySelector('.hp-activating')).toHaveAttribute('data-phase', 'resolving');
    expect((container.querySelector('[data-part="nuqta"]') as SVGElement).style.getPropertyValue('--from-x')).toMatch(/^(0|11|22)px$/);
  });

  it('draws the -rtl key frames in Arabic: the group flipped inside the SVG, never a CSS mirror', () => {
    document.documentElement.dir = 'rtl';
    const { container } = render(
      <HostedLanguageProvider linkedLanguage="ar">
        <ActivatingMotion done={false} />
      </HostedLanguageProvider>,
    );
    expect(container.querySelector('svg > g')).toHaveAttribute('transform', 'matrix(-1 0 0 1 120 0)');
  });

  it('under reduced motion shows the still: the activating scene, no loop', () => {
    reducedMotion(true);
    const { container } = render(<ActivatingMotion done={false} />);
    expect(container.querySelector('.hp-activating')).toBeNull();
    expect(container.querySelector('[data-scene="activating"]')).toHaveAttribute('data-scene-art', 'activating');
  });

  it('carries the spec: a 1.5 s loop of 500 ms hops 11 px apart with 7/7/10 px arcs, a 600 ms resolve to (102, 22) at r 6', () => {
    expect(css).toContain('animation: hp-activating-hop-x 1500ms infinite, hp-activating-hop-arc 1500ms infinite;');
    expect(css).toMatch(/33\.333% \{ translate: 11px 0;/);
    expect(css).toMatch(/66\.667% \{ translate: 22px 0;/);
    expect(css).toMatch(/16\.667% \{ transform: translateY\(-7px\);/);
    expect(css).toMatch(/50% \{ transform: translateY\(-7px\);/);
    expect(css).toMatch(/83\.333% \{ transform: translateY\(-10px\);/);
    expect(css).toContain('animation: hp-activating-nuqta-home 600ms var(--ease-spring) both;');
    expect(css).toMatch(/to \{ translate: 36px -27px; scale: 1\.3333; \}/);
    expect(css).toMatch(/@keyframes hp-activating-check-draw \{ from \{ stroke-dashoffset: 31; \} to \{ stroke-dashoffset: 0; \} \}/);
  });
});

describe('ActivatingStatus', () => {
  beforeEach(() => reducedMotion(true));

  it('says Activating, then Active, in a polite live region with the customer’s name', () => {
    const { rerender } = render(
      <HostedLanguageProvider linkedLanguage="en">
        <ActivatingStatus name="Café Nour" phase="activating" />
      </HostedLanguageProvider>,
    );
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Café Nour: Activating…');
    rerender(
      <HostedLanguageProvider linkedLanguage="en">
        <ActivatingStatus name="Café Nour" phase="active" />
      </HostedLanguageProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Café Nour: Active');
  });

  it('after 2 minutes says Check back shortly, in Arabic too, with Close', () => {
    const onClose = vi.fn();
    render(
      <HostedLanguageProvider linkedLanguage="ar">
        <ActivatingStatus name="مقهى نور" phase="late" onClose={onClose} />
      </HostedLanguageProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('مقهى نور: تحقّق بعد قليل');
    screen.getByRole('button', { name: 'إغلاق' }).click();
    expect(onClose).toHaveBeenCalled();
  });
});
