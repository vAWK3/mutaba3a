import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { animate, motionValue, type MotionValue } from 'motion';
import { REDUCED_MOTION_FADE_SECONDS, UI_SPRING } from '../../../lib/motion/presets';

const MS_PER_SECOND = 1000;

/**
 * A bar's length that morphs from where it is (MUT-268 craft spec 3): the
 * first value is painted before the first frame (no entrance animation); each
 * change springs from the presentation value on `UI_SPRING`, so rapid leave-outs
 * or tab switches retarget mid-flight. Reduced motion swaps the value under a
 * short opacity dip (craft spec 8).
 */
export function useSpringScale(ref: RefObject<HTMLElement | null>, scale: number, axis: 'x' | 'y', reducedMotion: boolean, enterDelayMs?: number) {
  const value = useRef<MotionValue<number> | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!value.current) {
      // MUT-175 (DR21, opt-in): with an entrance delay the bar grows from 0 on first paint; without one it is painted as is
      const entering = enterDelayMs !== undefined && !reducedMotion;
      const created = motionValue(entering ? 0 : scale);
      const paint = () => {
        element.style.transform = axis === 'y' ? `scaleY(${created.get()})` : `scaleX(${created.get()})`;
      };
      created.on('change', paint);
      paint();
      value.current = created;
      if (!entering) return;
      const controls = animate(created, scale, { type: 'spring', ...UI_SPRING, delay: enterDelayMs / MS_PER_SECOND });
      return () => controls.stop();
    }
    if (reducedMotion) {
      value.current.jump(scale);
      element.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: REDUCED_MOTION_FADE_SECONDS * 1000 });
      return;
    }
    const controls = animate(value.current, scale, { type: 'spring', ...UI_SPRING });
    return () => controls.stop();
  }, [ref, scale, axis, reducedMotion, enterDelayMs]);

  useEffect(
    () => () => {
      // Cleared too, so StrictMode's rehearsal remount builds a fresh, painted value
      value.current?.destroy();
      value.current = null;
    },
    [],
  );
}
