# motion-guide-step-change — Guide step change

Moment: 15 · Next step, one step at a time (phone)

Forward moves in the reading direction: in English the new step comes from the right, in Arabic from the left; Back is the reverse. Slide 0.35 s; the new step's art assembles once with the nuqta last (0.6 s total). Text slides with the art and is never hidden.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-guide-step-change-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| step 1 (art + text) | translateX toward the inline-start, out | 0 | −100% (LTR) / +100% (RTL) | 0 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | text moves with its art; nothing fades out of view |
| step 2 (art + text) | translateX from the inline-end, in | +100% (LTR) / −100% (RTL) | 0 | 0 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| step 2 art | assemble: opacity + rise 8 px | 0 / 8 px | 1 / 0 | 120 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | once per step, the first time it is shown |
| step 2 nuqta | scale (last) | 0 | 1 | 380 ms | 220 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | ends 0.60 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
