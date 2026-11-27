# motion-claim-code — Claim code reveal + Copied

Moment: 7 · Accountant shows the code (MUT-770)

Digits settle one by one (0.62 s). Copied: label cross-fade 150 ms + check 240 ms, reverts after 2 s. Codes are LTR in every language: direction-neutral.

Direction: direction-neutral.

Reduced motion: show `motion-claim-code-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| digit 1 | translateY | 10 px | 0 | 0 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | stagger 60 ms, leftmost first in both directions (codes are LTR) |
| digit 1 | opacity | 0 | 1 | 0 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 2 | translateY | 10 px | 0 | 60 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 2 | opacity | 0 | 1 | 60 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 3 | translateY | 10 px | 0 | 120 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 3 | opacity | 0 | 1 | 120 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 4 | translateY | 10 px | 0 | 180 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 4 | opacity | 0 | 1 | 180 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 5 | translateY | 10 px | 0 | 240 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 5 | opacity | 0 | 1 | 240 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 6 | translateY | 10 px | 0 | 300 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| digit 6 | opacity | 0 | 1 | 300 ms | 320 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| copy label | cross-fade to Copied | Copy | Copied | 0 ms | 150 ms | `linear` / `Curves.linear` |  |
| check icon | scale | 0.6 | 1 | 0 ms | 240 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| copy label | revert | Copied | Copy | 2000 ms | 150 ms | `linear` / `Curves.linear` | after a 2 s hold |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
