/**
 * Gesture physics shared by anything a person can drag or flick (MUT-80,
 * brief R2). The values follow Apple's "Designing Fluid Interfaces"
 * (WWDC 2018): springs are described by a response and a damping ratio, a
 * flick lands where scroll-view deceleration would take it, and a boundary
 * resists progressively instead of stopping dead.
 */

/** Scroll-view deceleration per millisecond; 0.99 is the "fast" rate. */
export const SCROLL_DECELERATION_RATE = 0.998;

/** Apple's rubber-band constant: how much an overshoot still follows. */
export const RUBBERBAND_CONSTANT = 0.55;

/** How far back pointer samples count toward the release velocity. */
export const VELOCITY_WINDOW_MS = 100;

const MS_PER_SECOND = 1000;

export interface SpringPhysics {
  stiffness: number;
  damping: number;
  mass: number;
}

export interface MotionSample {
  /** Milliseconds, from `performance.now()`. */
  time: number;
  /** Pixels along the gesture's axis. */
  position: number;
}

/**
 * Apple's two designer-facing parameters as physics at mass 1. `response` is
 * roughly how long the value takes to reach its target, in seconds (not a
 * duration: the settle time emerges); `dampingRatio` 1 is critically damped,
 * below 1 overshoots.
 */
export function springFromResponse(response: number, dampingRatio: number): SpringPhysics {
  const angularFrequency = (2 * Math.PI) / response;
  return {
    stiffness: angularFrequency ** 2,
    damping: 2 * dampingRatio * angularFrequency,
    mass: 1,
  };
}

/**
 * How much further a gesture released at `velocity` (px/s) would travel under
 * scroll-view deceleration. Apple's projection, not the textbook v²/2a.
 */
export function projectMomentum(velocity: number, decelerationRate = SCROLL_DECELERATION_RATE): number {
  return ((velocity / MS_PER_SECOND) * decelerationRate) / (1 - decelerationRate);
}

/** Where an `overshoot` past a boundary is drawn: the further, the less it follows. */
export function rubberband(overshoot: number, dimension: number, constant = RUBBERBAND_CONSTANT): number {
  const distance = Math.abs(overshoot);
  const drawn = (distance * dimension * constant) / (dimension + constant * distance);
  return Math.sign(overshoot) * drawn;
}

/** The overshoot that `rubberband` draws at `drawn`: lets a grab start from the drawn position. */
export function rubberbandInverse(drawn: number, dimension: number, constant = RUBBERBAND_CONSTANT): number {
  const distance = Math.abs(drawn);
  const overshoot = (distance * dimension) / (constant * (dimension - distance));
  return Math.sign(drawn) * overshoot;
}

/** Release velocity in px/s from the samples in the last `VELOCITY_WINDOW_MS` before the newest one. */
export function velocityFromSamples(samples: readonly MotionSample[], windowMs = VELOCITY_WINDOW_MS): number {
  if (samples.length < 2) return 0;
  const newest = samples[samples.length - 1];
  const oldest = samples.find((sample) => newest.time - sample.time <= windowMs) ?? newest;
  const elapsed = newest.time - oldest.time;
  if (elapsed <= 0) return 0;
  return ((newest.position - oldest.position) / elapsed) * MS_PER_SECOND;
}
