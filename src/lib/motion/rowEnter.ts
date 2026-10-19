import { animate, motionValue } from 'motion';
import { REDUCED_MOTION_FADE_SECONDS, UI_SPRING } from './presets';

/**
 * A row coming back into its list (MUT-268, craft spec 2: "Undo retraces the
 * path"): the reverse of `captureRowExit`. The row is already in its slot; it
 * starts part-way toward the inline end, transparent, and settles on the same
 * spring the exit used. Reduced motion fades it in and moves nothing
 * (ADR-044 §5). No layout means no motion.
 */

/** How far toward the inline end the row starts, as a share of its width. */
const ENTER_OFFSET = 0.3;

export function playRowEnter(row: HTMLElement, { reducedMotion }: { reducedMotion: boolean }): void {
  const { width } = row.getBoundingClientRect();
  if (width === 0) return;
  const rtl = row.closest('[dir]')?.getAttribute('dir') === 'rtl';
  const distance = width * ENTER_OFFSET * (rtl ? -1 : 1);
  const progress = motionValue(0);
  const paint = () => {
    const p = progress.get();
    row.style.opacity = String(Math.min(1, Math.max(0, p)));
    row.style.transform = reducedMotion || p >= 1 ? '' : `translateX(${(1 - p) * distance}px)`;
  };
  progress.on('change', paint);
  paint();
  const finish = () => {
    row.style.opacity = '';
    row.style.transform = '';
    progress.destroy();
  };
  if (reducedMotion) animate(progress, 1, { duration: REDUCED_MOTION_FADE_SECONDS, ease: 'easeOut', onComplete: finish });
  else animate(progress, 1, { type: 'spring', ...UI_SPRING, onComplete: finish });
}
