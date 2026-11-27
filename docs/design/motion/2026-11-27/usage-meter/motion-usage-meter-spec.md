# motion-usage-meter — Usage meter 80% → 90%

Moment: 8 · Getting close to the limit (MUT-733 / 706)

Fill grows from inline-start (mirror in RTL). Tone change only when the value crosses 90%. Each step ≤ 0.6 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-usage-meter-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| meter fill | width (from inline-start) | 0 / previous | 80% | 0 ms | 600 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-dur ≤ 0.6 s; first paint only |
| meter fill | width 80 → 90% | 80% | 90% | 1400 ms | 600 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| track + fill + figure | tone: primary → butter (fill --m-butter-ink, track --m-butter) | primary | butter | 1650 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-dur-toggle; only when crossing 90% |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
