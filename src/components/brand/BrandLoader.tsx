import { useEffect, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { useOptionalT } from '../../lib/i18n/core';
import { BLOOM_DURATION, BLOOM_PIECES, BLOOM_ROTATION, BLOOM_VIEWBOX } from './bloomLoaderData';
import './BrandLoader.css';

/** The designed sizes (24/40/64) plus the boot screen's 96. A union, so no one draws a sub-24 loader inline. */
export type BrandLoaderSize = 24 | 40 | 64 | 96;

/** How long a wait stays blank before the loader shows (MUT-206 D5): a quick load never flashes one. */
export const LOADER_DELAY_MS = 400;
/** When a long wait says so (DR5), counted from mount, delay included. */
export const LOADER_SLOW_MS = 3000;
/** A loader mounting this soon after a shown one left skips its delay and fade (DR11): one wait, not two. */
export const LOADER_CHAIN_MS = 100;

/** When the last loader that was actually shown unmounted (placeholders don't count). */
let lastShownLoaderHiddenAt = -Infinity;

/** Tests only: forget the last shown loader, so one test's loader never chains into the next. */
// eslint-disable-next-line react-refresh/only-export-components -- lives beside the module state it resets
export function __resetLoaderChainForTests(): void {
  lastShownLoaderHiddenAt = -Infinity;
}

const now = () => performance.now();

interface BrandLoaderProps {
  size: BrandLoaderSize;
  /** What the status says. Default: `common.loaderLabel` ("Loading" / "جارٍ التحميل"). */
  label?: string;
  /** Blank time before the loader shows; `0` shows it at once, with no fade. Default `LOADER_DELAY_MS`. */
  delay?: number;
  /** Shown (and announced) under the mark once the wait passes `LOADER_SLOW_MS`. Full-page waits only. */
  slowCaption?: string;
  className?: string;
}

/**
 * The bloom loader (MUT-206, ADR-079): the mark folds into four drops and
 * blooms back over a 4.5 s loop. A React port of the delivered SVG: inline
 * SMIL, no runtime, no `style` attribute, so it runs under the portal's CSP.
 * Fills come from the `--mark-*` tokens, so it follows the in-app theme.
 *
 * - Mount: a `role="status"` live region that stays put, empty, around a
 *   blank SVG of the same size (no layout shift, nothing announced).
 * - After `delay`: the SVG is replaced by a fresh one (a new `key`, so its
 *   SMIL clock starts at frame 0) and the label is set as text: visually
 *   hidden, or, under reduced motion, visible under a still mark (DR7, DR14).
 * - After `LOADER_SLOW_MS`: `slowCaption`, when given, replaces the label.
 */
export function BrandLoader({ size, label, delay = LOADER_DELAY_MS, slowCaption, className }: BrandLoaderProps) {
  const t = useOptionalT();
  const reducedMotion = usePrefersReducedMotion();
  // Decided once: a loader with no delay, or one chained from a loader that just left, shows at once.
  const [immediate] = useState(() => delay <= 0 || now() - lastShownLoaderHiddenAt < LOADER_CHAIN_MS);
  const [shown, setShown] = useState(immediate);
  const [slow, setSlow] = useState(false);
  const hasSlowCaption = !!slowCaption;

  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(timer);
  }, [shown, delay]);

  useEffect(() => {
    if (!hasSlowCaption) return;
    const timer = setTimeout(() => setSlow(true), LOADER_SLOW_MS);
    return () => clearTimeout(timer);
  }, [hasSlowCaption]);

  // `shown` only ever turns on, so this cleanup runs when a shown loader unmounts.
  useEffect(() => {
    if (!shown) return;
    return () => {
      lastShownLoaderHiddenAt = now();
    };
  }, [shown]);

  const name = label ?? t?.('common.loaderLabel') ?? '';
  let text: ReactNode = null;
  if (shown && slow && slowCaption) text = <span className="brand-loader__caption">{slowCaption}</span>;
  else if (shown && reducedMotion) text = <span className="brand-loader__caption">{name}</span>;
  else if (shown) text = <span className="sr-only">{name}</span>;

  const classes = ['brand-loader', shown && !immediate && !reducedMotion && 'brand-loader--enter', className].filter(Boolean).join(' ');

  return (
    <span role="status" className={classes}>
      <svg
        key={shown ? 'on' : 'wait'}
        className="brand-loader__svg"
        viewBox={BLOOM_VIEWBOX}
        width={size}
        height={size}
        aria-hidden="true"
        focusable="false"
      >
        {shown && <BloomFrames animate={!reducedMotion} />}
      </svg>
      {text}
    </span>
  );
}

/** The four pieces at frame 0 (the mark), with their loop when motion is allowed (D3: SMIL ignores the CSS rule). */
function BloomFrames({ animate }: { animate: boolean }) {
  return (
    <g>
      {BLOOM_PIECES.map((piece) => (
        <path key={piece.cls} className={`brand-loader-${piece.cls}`} d={piece.values[0]}>
          {animate && (
            <animate
              attributeName="d"
              dur={BLOOM_DURATION}
              repeatCount="indefinite"
              calcMode="spline"
              keyTimes={piece.keyTimes}
              keySplines={piece.keySplines}
              values={piece.values.join(';')}
            />
          )}
        </path>
      ))}
      {animate && (
        <animateTransform
          attributeName="transform"
          type="rotate"
          dur={BLOOM_DURATION}
          repeatCount="indefinite"
          calcMode="spline"
          keyTimes={BLOOM_ROTATION.keyTimes}
          keySplines={BLOOM_ROTATION.keySplines}
          values={BLOOM_ROTATION.values}
        />
      )}
    </g>
  );
}
