# motion-getstarted-done — Get started: all done

Moment: 3 · Every Get started step is finished

Plays once on the Get started card when the last step is ticked. The one celebration in this set: overshoot on the drop and the dots only. Lighter than the milestones: three dots, no confetti. Total 0.94 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-getstarted-done-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| nuqta | opacity | 0 | 1 | 0 ms | 120 ms | `linear` / `Curves.linear` |  |
| nuqta | drop onto the top step (translateY) | −48 px | 0 | 0 ms | 440 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| top step | bump scaleY from the ground | 1 | 1.05 | 400 ms | 140 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| top step | settle | 1.05 | 1 | 540 ms | 200 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| dots ×3 | spring out from the nuqta, scale 0→1 | nuqta centre | rest positions | 420 ms | 520 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` | pieces stagger 25 ms inside the 520 ms; ends 0.94 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
