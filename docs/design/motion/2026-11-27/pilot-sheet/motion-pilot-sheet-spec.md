# motion-pilot-sheet — Pilot welcome sheet

Moment: 4 · First open as a pilot tester (MUT-755 / 756)

Half sheet springs up; the three Welcome steps rise with the brand stagger; each spot's nuqta pops last. Total 0.78 s. Layout is wireframe A; bars stand for copy.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-pilot-sheet-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| scrim | opacity | 0 | 0.32 | 0 ms | 240 ms | `linear` / `Curves.linear` |  |
| half sheet | translateY | +100% (332 px) | 0 | 0 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-dur-nav |
| step 1 card | translateY (--m-stagger-rise) | 14 px | 0 | 180 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-stagger 50 ms |
| step 1 card | opacity | 0 | 1 | 180 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| step 1 spot nuqta | scale | 0 | 1 | 480 ms | 220 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| step 2 card | translateY (--m-stagger-rise) | 14 px | 0 | 230 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-stagger 50 ms |
| step 2 card | opacity | 0 | 1 | 230 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| step 2 spot nuqta | scale | 0 | 1 | 530 ms | 220 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| step 3 card | translateY (--m-stagger-rise) | 14 px | 0 | 280 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-stagger 50 ms |
| step 3 card | opacity | 0 | 1 | 280 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| step 3 spot nuqta | scale | 0 | 1 | 580 ms | 220 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
