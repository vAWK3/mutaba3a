# motion-autofill — Category filled for you

Moment: 13 · Receipt category from the vendor (MUT-775)

A soft peach underline draws from inline-start in 160 ms, holds 1.2 s, fades in 240 ms. Reduced motion: underline shown, then the 240 ms fade.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-autofill-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| peach underline | opacity | 0 | 1 | 0 ms | 80 ms | `linear` / `Curves.linear` |  |
| peach underline | scaleX from inline-start | 0 | 1 | 0 ms | 160 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| peach underline | opacity (fade away) | 1 | 0 | 1400 ms | 240 ms | `linear` / `Curves.linear` | after a 1.2 s hold; motion time 0.4 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
