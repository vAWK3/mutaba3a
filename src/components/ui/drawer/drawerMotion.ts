import { animate, motionValue, type AnimationPlaybackControls, type MotionValue } from 'motion';
import { springFromResponse } from '../../../lib/motion/physics';
import { exitDistance, overlayOpacity } from './drawerGesture';
import type { ExitSnapshot } from './exitSnapshot';

/**
 * How a drawer moves (MUT-80, brief R2, ADR-043). One critically damped spring
 * for every move: an overshoot would pull the panel off its screen edge.
 */
export const DRAWER_SPRING = springFromResponse(0.3, 1);

/** Reduced motion swaps every move for an opacity cross-fade of this length. */
export const REDUCED_MOTION_FADE_SECONDS = 0.15;

export interface DrawerGeometry {
  width: number;
  rtl: boolean;
}

export interface DrawerPose {
  /** Along the closing axis: 0 open, positive toward the panel's edge. */
  offset: number;
  /** Opacity factor for reduced-motion fades: 1 shown, 0 gone. */
  presence: number;
}

/**
 * Write a pose to the DOM. At rest the inline transform and opacity are
 * cleared: a transform would make the panel the containing block for its
 * `position: fixed` descendants (popovers, typeahead lists).
 */
export function paintDrawer(panel: HTMLElement, overlay: HTMLElement, pose: DrawerPose, geometry: DrawerGeometry) {
  const x = geometry.rtl ? -pose.offset : pose.offset;
  panel.style.transform = pose.offset === 0 ? '' : `translateX(${x}px)`;
  panel.style.opacity = pose.presence === 1 ? '' : String(pose.presence);
  const dim = overlayOpacity(pose.offset, geometry.width) * pose.presence;
  overlay.style.opacity = dim === 1 ? '' : String(dim);
}

export function springTo(
  value: MotionValue<number>,
  target: number,
  velocity: number,
  onComplete: () => void,
): AnimationPlaybackControls {
  return animate(value, target, { type: 'spring', ...DRAWER_SPRING, velocity, onComplete });
}

export function fadeTo(value: MotionValue<number>, target: number, onComplete: () => void): AnimationPlaybackControls {
  return animate(value, target, { duration: REDUCED_MOTION_FADE_SECONDS, ease: 'easeOut', onComplete });
}

/** Animate an attached snapshot out from the live drawer's last pose and velocity, then remove it. */
export function playSnapshotExit(
  snapshot: ExitSnapshot,
  from: DrawerPose & { velocity: number },
  geometry: DrawerGeometry,
  reducedMotion: boolean,
) {
  const offset = motionValue(from.offset);
  const presence = motionValue(from.presence);
  const paint = () =>
    paintDrawer(snapshot.panel, snapshot.overlay, { offset: offset.get(), presence: presence.get() }, geometry);
  offset.on('change', paint);
  presence.on('change', paint);
  paint();

  const finish = () => {
    snapshot.remove();
    offset.destroy();
    presence.destroy();
  };
  if (reducedMotion) fadeTo(presence, 0, finish);
  else springTo(offset, exitDistance(geometry.width), from.velocity, finish);
}
