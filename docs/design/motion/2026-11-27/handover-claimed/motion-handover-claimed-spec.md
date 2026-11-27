# motion-handover-claimed — The account is theirs

Moment: 3 · Client claims the account (MUT-769)

Starts from the handover-welcome pose and ends on handover-claimed. Has direction: use the -rtl frames in Arabic. Total 1.32 s.

Direction: has direction — use the `-rtl` frames in Arabic.

Reduced motion: show `motion-handover-claimed-still.svg` (the final pose) with no movement; a 150 ms fade-in is allowed.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| offer trail | opacity | 1 | 0 | 0 ms | 200 ms | `linear` / `Curves.linear` |  |
| key | travel along arc to folder front; tilt −16° mid-way | held out (116,34) | resting (106,114) | 0 ms | 700 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| folder label bar | opacity (key takes its place) | 1 | 0 | 400 ms | 200 ms | `linear` / `Curves.linear` |  |
| folder tab | fill field → peach (cross-fade) | field | peach | 640 ms | 280 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| folder tab | scale from its base | 1 | 1.08 | 640 ms | 160 ms | `var(--m-ease-overshoot)` / `Cubic(0.34, 1.56, 0.64, 1)` |  |
| folder tab | scale settle | 1.08 | 1 | 800 ms | 240 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| sparkles | scale + opacity | 0 | 1 | 900 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | ends 1.32 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (celebrations only).
