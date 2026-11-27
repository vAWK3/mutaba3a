# motion-card-hide — Hide / collapse

Moment: 5 · Get started is hidden or finished

The card fades, settles 2% and its height closes; the Home tiles below rise with it. ≤ 0.3 s. Direction-neutral.

Direction: direction-neutral.

Plays once; never loops. Reduced motion: show `motion-card-hide-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| Get started card | opacity | 1 | 0 | 0 ms | 200 ms | `linear` / `Curves.linear` |  |
| Get started card | scale (from its top edge) | 1 | 0.98 | 0 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| Get started card | height (clip) → 0 | 196 px | 0 | 0 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | rows below follow the collapse |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
