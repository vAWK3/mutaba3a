/**
 * MUT-770: `motion-activating`'s timing (docs/design/motion/2026-11-27/activating/motion-activating-spec.md), pure so
 * ActivatingMotion's "finish the current hop, then resolve" is a unit test.
 */

/** The spec's loop and hop. */
export const ACTIVATING_LOOP_MS = 1500;
export const ACTIVATING_HOP_MS = 500;
/** The spec's resolve, after the current hop ends. */
export const ACTIVATING_RESOLVE_MS = 600;
const DOTS = 3;

/** Which dot the nuqta reaches when the hop it is on ends, and how long until then, `elapsed` ms into the loop. */
export function hopEnd(elapsed: number): { dot: number; inMs: number } {
  const intoLoop = ((elapsed % ACTIVATING_LOOP_MS) + ACTIVATING_LOOP_MS) % ACTIVATING_LOOP_MS;
  const hop = Math.floor(intoLoop / ACTIVATING_HOP_MS);
  return { dot: (hop + 1) % DOTS, inMs: ACTIVATING_HOP_MS - (intoLoop % ACTIVATING_HOP_MS) };
}
