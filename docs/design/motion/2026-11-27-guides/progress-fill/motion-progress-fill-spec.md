# motion-progress-fill — Progress fill

Moment: 4 · The Get started count changes

Fill grows from the inline-start (right in Arabic). Plays right after step-done. ≤ 0.5 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-progress-fill-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| count | cross-fade 1 / 4 → 2 / 4 | old | new | 0 ms | 150 ms | `linear` / `Curves.linear` |  |
| progress fill | width from inline-start | 25% | 50% | 0 ms | 500 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | same 0.5 s for any step; never animates on first paint |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
