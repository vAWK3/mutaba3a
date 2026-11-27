# motion-activating — Activating

Moment: 6 · Desk polls for the client's card (MUT-768)

Wait loop 1.5 s (repeats up to the 2 min poll). On active, finishes the current hop then resolves in 0.6 s. Not the bloom loader: no rotation, no petals.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-activating-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| nuqta | hop dot 1 → 2 (arc 7 px) | dot 1 | dot 2 | 0 ms | 500 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | loop: 1.5 s, repeats while polling |
| nuqta | hop dot 2 → 3 | dot 2 | dot 3 | 500 ms | 500 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| nuqta | hop dot 3 → 1 (arc 10 px) | dot 3 | dot 1 | 1000 ms | 500 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| on active: dots → check | dots shrink; check draws (dash) | 3 dots | check | 0 ms | 600 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | starts at the end of the current hop; ≤ 0.6 s |
| on active: nuqta | moves to card corner, r 4.5 → 6 | current dot | (102,22) | 0 ms | 600 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
