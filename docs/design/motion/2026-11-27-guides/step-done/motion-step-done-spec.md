# motion-step-done — Step done

Moment: 4 · A Get started row is ticked

The circle takes the done tone and the check draws in. ≤ 0.35 s. The row's label is there throughout.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-step-done-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| circle | fill + border: empty → done tone (--m-mint-ink as in the wireframe) | empty | done | 0 ms | 200 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| check | draw in (stroke-dashoffset), inline-start foot first | 0% | 100% | 100 ms | 250 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | ends 0.35 s; the row text never moves |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
