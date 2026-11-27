# motion-undo-toast — Downgrade scheduled · Undo toast

Moment: 9 · Downgrade scheduled (MUT-734)

Toast rises 14 px and fades in; stays 6 s. Undo: press scale, the scheduled line collapses, toast fades 150 ms.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-undo-toast-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| toast | translateY | 14 px | 0 | 0 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| toast | opacity | 0 | 1 | 0 ms | 240 ms | `linear` / `Curves.linear` | stays 6 s (or until dismissed) |
| Undo button | press scale (--m-press-scale) | 1 | 0.96 | 1200 ms | 120 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-dur-press |
| Undo button | release | 0.96 | 1 | 1320 ms | 120 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| “Scheduled · Undo” line | opacity + height collapse | 1 | 0 | 1340 ms | 350 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| toast | opacity (dismiss) | 1 | 0 | 1440 ms | 150 ms | `linear` / `Curves.linear` | reduced motion: this 150 ms fade only |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
