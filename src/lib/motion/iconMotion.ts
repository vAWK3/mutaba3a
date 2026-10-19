import { animate, motionValue, type AnimationPlaybackControls } from 'motion';

/**
 * MUT-337: the icon system's playful/restrained split is one transform
 * (scale 0 -> 1) played through one of two named curves - never two
 * different engines (see `.claude/designs/mut-337-icon-animation-runtime.md`).
 * These are the exact same four control points as Flutter's `MMotion` class
 * (`mutaba3a/lib/presentation/theme/mutaba3a_theme.dart:74-76`) - keep them in
 * step if that file's numbers ever change.
 */
export const ICON_OVERSHOOT_EASE = [0.34, 1.56, 0.64, 1] as const; // MMotion.overshoot
export const ICON_RESTRAINED_EASE = [0.32, 0.72, 0, 1] as const; // MMotion.spring

const ICON_FEEDBACK_DURATION_SECONDS = 0.4;

export type IconFeedbackPreset = 'playful' | 'restrained';

export interface IconFeedbackOptions {
  preset: IconFeedbackPreset;
  reducedMotion: boolean;
}

// One in-flight animation per target: a re-trigger stops the prior play
// (from wherever it currently is) instead of stacking two animations on the
// same element.
const activeByTarget = new WeakMap<Element, AnimationPlaybackControls>();

/**
 * Plays the save-feedback pop on every element in `targets` (the caller's
 * own `data-part` elements - this never reaches into an icon by name).
 * Reduced motion skips straight to the settled state, no overshoot, on
 * either preset.
 */
export function playIconFeedback(targets: Element[], { preset, reducedMotion }: IconFeedbackOptions): void {
  const ease = preset === 'playful' ? ICON_OVERSHOOT_EASE : ICON_RESTRAINED_EASE;

  for (const target of targets) {
    activeByTarget.get(target)?.stop();
    const el = target as HTMLElement | SVGElement;
    const progress = motionValue(reducedMotion ? 1 : 0);
    const paint = () => {
      el.style.transform = `scale(${progress.get()})`;
    };
    progress.on('change', paint);
    paint();

    if (reducedMotion) {
      activeByTarget.delete(target);
      continue;
    }

    const controls = animate(progress, 1, {
      duration: ICON_FEEDBACK_DURATION_SECONDS,
      ease: [...ease],
      onComplete: () => {
        progress.destroy();
        activeByTarget.delete(target);
      },
    });
    activeByTarget.set(target, controls);
  }
}
