import { projectMomentum, rubberband } from '../../../lib/motion/physics';

/**
 * The drawer's gesture rules (MUT-80, brief R2), as pure functions. Offsets
 * are measured along the closing axis: 0 is fully open, positive is toward
 * the panel's own edge (right in LTR, left in RTL), negative is past fully
 * open.
 */

/** Movement before a press becomes a horizontal drag or gives way to scrolling. */
export const DRAG_THRESHOLD_PX = 10;

/** Extra travel past the panel's width so its shadow leaves the screen too. */
export const SHADOW_CLEARANCE_PX = 32;

export type DragIntent = 'pending' | 'horizontal' | 'vertical';
export type ReleaseTarget = 'open' | 'dismiss';

/** Which way a press is going, once it has moved far enough to tell. Ties go to scrolling. */
export function classifyDrag(dx: number, dy: number, threshold = DRAG_THRESHOLD_PX): DragIntent {
  const horizontal = Math.abs(dx);
  const vertical = Math.abs(dy);
  if (horizontal < threshold && vertical < threshold) return 'pending';
  return horizontal > vertical ? 'horizontal' : 'vertical';
}

/** A horizontal pointer movement expressed along the closing axis. */
export function closingDelta(dx: number, rtl: boolean): number {
  return rtl ? -dx : dx;
}

/** Where the panel rests once fully closed. */
export function exitDistance(width: number): number {
  return width + SHADOW_CLEARANCE_PX;
}

/** Where the panel is drawn for a raw drag offset: 1:1 up to closed, rubber-banded past open. */
export function displayOffset(raw: number, width: number): number {
  if (raw < 0) return rubberband(raw, width);
  return Math.min(raw, exitDistance(width));
}

/** Release past half the width, after projecting the flick's momentum, dismisses. */
export function releaseTarget(offset: number, velocity: number, width: number): ReleaseTarget {
  return offset + projectMomentum(velocity) > width / 2 ? 'dismiss' : 'open';
}

/** The overlay dims with the panel's progress: 1 open, 0 closed. */
export function overlayOpacity(offset: number, width: number): number {
  if (width <= 0) return 1;
  return Math.min(1, Math.max(0, 1 - offset / width));
}

const NO_DRAG_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [data-drawer-no-drag]';

function scrollsHorizontally(element: HTMLElement): boolean {
  if (element.scrollWidth <= element.clientWidth) return false;
  const { overflowX } = getComputedStyle(element);
  return overflowX === 'auto' || overflowX === 'scroll';
}

/**
 * A press that must not move the panel: form fields keep text selection,
 * horizontally scrolling regions keep their scroll, and anything marked
 * `data-drawer-no-drag` opts out.
 */
export function isNoDragTarget(target: EventTarget | null, panel: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest(NO_DRAG_SELECTOR)) return true;
  for (let node: Element | null = target; node && node !== panel; node = node.parentElement) {
    if (node instanceof HTMLElement && scrollsHorizontally(node)) return true;
  }
  return false;
}
