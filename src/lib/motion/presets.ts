import { springFromResponse } from './physics';

/**
 * How the app's surfaces move (ADR-044 §4, §5), shared by drawers (MUT-80) and
 * list rows (MUT-82). One critically damped spring for every move: an
 * overshoot would pull a drawer off its edge or a row past its slot.
 */
export const UI_SPRING = springFromResponse(0.3, 1);

/** Reduced motion swaps a move for an opacity cross-fade of this length. */
export const REDUCED_MOTION_FADE_SECONDS = 0.15;
