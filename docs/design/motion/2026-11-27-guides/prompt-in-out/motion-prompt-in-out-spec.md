# motion-prompt-in-out — Prompt appears / dismissed

Moment: 14 · A prompt banner at the top of a page

In: rises 12 px over 0.4 s. Out: fades and lifts 6 px in 0.18 s while the content below closes the gap in 0.25 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-prompt-in-out-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| prompt banner | opacity | 0 | 1 | 0 ms | 160 ms | `linear` / `Curves.linear` |  |
| prompt banner | translateY | 12 px | 0 | 0 ms | 400 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | content below is already placed: the slot is reserved |
| prompt banner (dismiss) | opacity | 1 | 0 | 1400 ms | 180 ms | `linear` / `Curves.linear` |  |
| prompt banner (dismiss) | translateY | 0 | −6 px | 1400 ms | 180 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| content below | rises into the gap (height collapse) | slot | 0 | 1400 ms | 250 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | leave ≤ 0.25 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
