import { Scene } from './Scene';

/**
 * MUT-769: `motion-handover-claimed` (`docs/design/motion/2026-11-27/handover-claimed/motion-handover-claimed-spec.md`),
 * "the account is theirs", 1.32 s once. It starts from the `handover-welcome` pose and ends on `handover-claimed`: the
 * offer trail fades, the key travels on an arc from the accountant's hand to the folder front (tilting −16° mid-way)
 * and takes the label's place, the tab turns peach with a small pop, then the sparkles come.
 *
 * Built on the two generated scenes, stacked: `handover-claimed` animates its own parts (key, tab, tab-claimed,
 * sparkles) from the welcome pose; above it, `handover-welcome` shows only what the claimed art does not hold (the
 * offer trail and the folder label) and fades it out. Both are `Scene`, so Arabic gets the `-rtl` drawings. Under
 * reduced motion only the claimed scene shows (the still), with the 150 ms fade-in the spec allows. CSS in
 * hosted.css › Handover claimed. Decorative: the heading beside it carries the meaning.
 */
export function HandoverClaimedMotion({ size = 160 }: { size?: number }) {
  return (
    <span className="hp-handover-claimed" aria-hidden="true" data-motion="handover-claimed">
      <Scene name="handover-claimed" size={size} className="hp-handover-claimed-art" />
      <Scene name="handover-welcome" size={size} className="hp-handover-claimed-welcome" />
    </span>
  );
}
