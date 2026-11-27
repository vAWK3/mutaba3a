# motion-gift-month — The gift month

Moment: 1 · You've outgrown your plan (MUT-733 / 706)

Plays once when the notice appears (drawer banner slot / half sheet). Celebration: overshoot allowed on leaves, nuqta pop and confetti. Direction-neutral. Total 1.40 s.

Direction: direction-neutral.

Reduced motion: show `motion-gift-month-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| stem | grows (draw from pot) | 0 | tip y 38 | 0 ms | 560 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| nuqta | scale (rides stem tip) | 0.4 | 1 | 0 ms | 560 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| leaf 1 | scale from stem | 0 | 1 | 200 ms | 360 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| leaf 2 | scale from stem | 0 | 1 | 300 ms | 360 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| leaf 3 (above the line) | scale from stem | 0 | 1 | 420 ms | 360 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| limit line | opacity (left behind) | 1 | 0.55 | 360 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| nuqta | pop: scale +25% | 1 | 1.25 | 540 ms | 160 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| nuqta | pop: settle | 1.25 | 1 | 700 ms | 240 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| confetti ×6 | fly out from nuqta, scale 0→1, fade in | nuqta centre | rest positions | 640 ms | 760 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` | pieces stagger 30 ms inside the 760 ms; ends 1.40 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
