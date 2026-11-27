# motion-website-entrance — Website entrance

Moment: 9 · Help centre page load

Confirmed: --m-stagger-rise 14 px and --m-stagger 50 ms. Adjusted for reading pages: only the first screen moves (headline, lead, first block), text starts at 35% opacity so it can be read from frame 1, and the 6 px blur is on the headline only. Body text never blurs: Arabic dots and Hebrew vowel marks smear first. Same timing in Arabic, English and Hebrew; the rise is vertical, so it needs no RTL version.

Direction: direction-neutral.

Plays once; never loops. Reduced motion: show `motion-website-entrance-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| headline | opacity (text readable from frame 1) | 0.35 | 1 | 0 ms | 200 ms | `linear` / `Curves.linear` |  |
| headline | translateY (--m-stagger-rise) | 14 px | 0 | 0 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` |  |
| headline | blur (--m-stagger-blur) | 6 px | 0 | 0 ms | 300 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | headline only |
| lead paragraph | opacity | 0.35 | 1 | 50 ms | 200 ms | `linear` / `Curves.linear` |  |
| lead paragraph | translateY | 14 px | 0 | 50 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | no blur on body text |
| first block | opacity | 0.35 | 1 | 100 ms | 200 ms | `linear` / `Curves.linear` |  |
| first block | translateY | 14 px | 0 | 100 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | ends 0.52 s; nothing below the first screen animates |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
