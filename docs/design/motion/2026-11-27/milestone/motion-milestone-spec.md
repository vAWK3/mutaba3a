# motion-milestone — First scan, first invoice

Moment: 5 · Pilot milestones (MUT-758)

Shared by milestone-first-scan and milestone-first-invoice (same badge position). Small celebration, ≤ 1 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-milestone-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| nuqta | opacity | 0 | 1 | 0 ms | 120 ms | `linear` / `Curves.linear` |  |
| nuqta | drop into badge (translateY) | −36 px | 0 | 0 ms | 420 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| badge | bump scale | 1 | 1.06 | 380 ms | 140 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| badge | settle | 1.06 | 1 | 520 ms | 200 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| dots ×3 | spring out from nuqta, scale 0→1 | nuqta centre | rest positions | 420 ms | 520 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` | pieces stagger 25 ms inside the 520 ms; ends 0.94 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
