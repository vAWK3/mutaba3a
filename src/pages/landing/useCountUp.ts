import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

export const COUNT_UP_MS = 600;

/** Ease-out cubic: fast at first, settling into the final value. */
function easeOut(progress: number): number {
  return 1 - Math.pow(1 - progress, 3);
}

/**
 * Counts an integer (amounts in minor units) from 0 up to `target` once, over
 * `durationMs`. Skipped under reduced motion. A re-render with the same target
 * doesn't restart it; a new target counts again.
 */
export function useCountUp(target: number, durationMs: number = COUNT_UP_MS): number {
  const reduced = usePrefersReducedMotion();
  // The frame remembers which target it belongs to, so a new target reads as 0
  // until its first frame, without resetting state inside the effect.
  const [frame, setFrame] = useState({ target, value: 0 });

  useEffect(() => {
    if (reduced) return;
    let id = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / durationMs);
      setFrame({ target, value: Math.round(target * easeOut(progress)) });
      if (progress < 1) id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [target, durationMs, reduced]);

  if (reduced) return target;
  return frame.target === target ? frame.value : 0;
}
