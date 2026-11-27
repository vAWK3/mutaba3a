# motion-plan-upgraded — Plan upgraded

Moment: 2 · After Confirm on an upgrade (MUT-734)

One-shot on the done pane. No overshoot: a settled step up. Direction-neutral (dots stagger from inline-start). Total 1.12 s.

Direction: direction-neutral.

Reduced motion: show `motion-plan-upgraded-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| tier 3 (new level) | translateY | −28 px | 0 | 0 ms | 480 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| tier 3 | opacity | 0 | 1 | 0 ms | 200 ms | `linear` / `Curves.linear` |  |
| nuqta | hop: tier 2 → tier 3 (arc, peak −22 px) | y 74 | y 46 | 300 ms | 520 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| tier 3 dots ×3 | scale | 0 | 1 | 600 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | stagger 60 ms, inline-start first |
| sparkles | scale + opacity | 0 | 1 | 760 ms | 360 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
