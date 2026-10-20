import { useEffect, useRef } from 'react';
import { playIconFeedback, type IconFeedbackPreset } from '../../lib/motion/iconMotion';
import { useMediaQuery } from '../../lib/motion/mediaQuery';
import { SuccessIcon } from './generated';

/**
 * MUT-338: the first real consumer of MUT-337's `playIconFeedback`. The ref
 * lives on a plain wrapping `<span>`, not on `SuccessIcon` itself - the ref
 * was always meant to belong to the caller's container (MUT-337's brief:
 * "the caller already has them via a ref + querySelectorAll('[data-part]')"),
 * so no generated-icon/codegen change is needed.
 */
export interface SaveFeedbackIconProps {
  preset: IconFeedbackPreset;
  size?: number;
}

export function SaveFeedbackIcon({ preset, size = 16 }: SaveFeedbackIconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  useEffect(() => {
    if (!ref.current) return;
    playIconFeedback(Array.from(ref.current.querySelectorAll('[data-part]')), { preset, reducedMotion });
  }, [preset, reducedMotion]);

  return (
    <span ref={ref} className="save-feedback-icon" aria-hidden="true">
      <SuccessIcon size={size} />
    </span>
  );
}
