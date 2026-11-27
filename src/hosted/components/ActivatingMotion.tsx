import { useEffect, useRef, useState } from 'react';
import { useOptionalDirection } from '../../lib/i18n/core';
import { Scene } from './Scene';
import { hopEnd } from './activatingHop';

/**
 * MUT-770: `motion-activating` (`docs/design/motion/2026-11-27/activating/motion-activating-spec.md`), the desk's wait
 * for a customer's card. While polling, the nuqta hops over three dots above the card, 1.5 s a loop (dot 1 → 2 → 3 →
 * 1, arcs of 7, 7 and 10 px, 500 ms each on the spring). When `done` turns true it finishes the hop it is on, then
 * resolves in 0.6 s: the dots shrink, the check draws, the nuqta moves to the card's corner and grows from r 4.5 to 6,
 * which is the `activating` scene's pose. Not the bloom loader.
 *
 * The loop's geometry is Claude Design's key frames (`motion-activating-0[1-3]-loop-dot-*.svg`), painted with the
 * scene tokens; in Arabic it is their `-rtl` drawing (the same group flipped inside the SVG, never a CSS mirror). Once
 * resolved, and always under reduced motion, it is the `activating` scene itself (the still), through `Scene`.
 * Decorative: the words beside it carry the state.
 */

type Phase = { kind: 'loop' } | { kind: 'resolving'; fromDot: number } | { kind: 'still' };

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function ActivatingMotion({ done, size = 120 }: { done: boolean; size?: number }) {
  const [phase, setPhase] = useState<Phase>(() => (prefersReducedMotion() ? { kind: 'still' } : { kind: 'loop' }));
  const startedAt = useRef(0);

  useEffect(() => {
    startedAt.current = performance.now();
  }, []);

  useEffect(() => {
    if (!done || phase.kind !== 'loop') return undefined;
    const { dot, inMs } = hopEnd(performance.now() - startedAt.current);
    const timer = setTimeout(() => setPhase({ kind: 'resolving', fromDot: dot }), inMs);
    return () => clearTimeout(timer);
  }, [done, phase.kind]);

  if (phase.kind === 'still') return <Scene name="activating" size={size} className="hp-activating-still" />;
  return <ActivatingLoopArt size={size} resolvingFrom={phase.kind === 'resolving' ? phase.fromDot : null} />;
}

const DOT_X = [66, 77, 88] as const;

function ActivatingLoopArt({ size, resolvingFrom }: { size: number; resolvingFrom: number | null }) {
  const rtl = useOptionalDirection() === 'rtl';
  const resolving = resolvingFrom !== null;
  return (
    <span className="hp-scene hp-activating" aria-hidden="true" data-scene="activating" data-phase={resolving ? 'resolving' : 'loop'}>
      <svg width={size} height={Math.round((size * 96) / 120)} viewBox="0 0 120 96" aria-hidden="true" focusable="false">
        <g transform={rtl ? 'matrix(-1 0 0 1 120 0)' : undefined}>
          <rect x="18" y="22" width="84" height="54" rx="9" fill="var(--m-field-bg)" stroke="var(--m-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" data-part="card" />
          <rect x="28" y="34" width="16" height="12" rx="3" fill="var(--m-field-bg)" stroke="var(--m-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" data-part="chip" />
          <path d="M28 62h22" fill="none" stroke="var(--m-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" data-part="bars" />
          {DOT_X.map((x) => (
            <circle key={x} cx={x} cy="58" r="2.5" fill="var(--m-primary)" data-part="dot" />
          ))}
          <path d="M68 58l6 6 13-13" fill="none" stroke="var(--m-primary)" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="31" data-part="check" />
          <circle
            cx="66"
            cy="49"
            r="4.5"
            fill="var(--m-peach-strong)"
            data-part="nuqta"
            style={resolving ? { ['--from-x' as string]: `${DOT_X[resolvingFrom] - DOT_X[0]}px` } : undefined}
          />
        </g>
      </svg>
    </span>
  );
}
