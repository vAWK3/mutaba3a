# motion-prompt-to-guide — Show me how → the guide

Moment: 14 · Hand-off from the prompt to the guide

Spatial hand-off. Portal: the drawer grows out of the Show me how button's own rect to its 480 px place at the inline-end. Phone: the half sheet grows out of the prompt card. The guide's content fades in once the surface has arrived. 0.46 s. In RTL the drawer opens on the left and grows from the button there.

Direction: has direction — use the `-rtl` frames in Arabic.

Plays once; never loops. Reduced motion: show `motion-prompt-to-guide-still.svg` (the final pose), no movement.

| Part | Property | From | To | Start | Duration | Easing (CSS / Flutter) | Note |
|---|---|---|---|---|---|---|---|
| scrim | opacity | 0 | 0.28 | 0 ms | 240 ms | `linear` / `Curves.linear` | shares the grow progress below |
| portal: drawer | bounds: the button's rect → the 480 px drawer at the inline-end | button | drawer | 0 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | --m-dur-nav; fill primary → surface in the first 40% |
| phone: sheet | bounds: the prompt card → the half sheet | card | sheet | 0 ms | 420 ms | `var(--m-ease-spring)` / `Cubic(0.32, 0.72, 0, 1)` | card colour → surface in the first 50% |
| guide content | opacity | 0 | 1 | 260 ms | 200 ms | `linear` / `Curves.linear` | title and step 1 art; ends 0.46 s |

Easings: `--m-ease-spring` = cubic-bezier(.32,.72,0,1); `--m-ease-overshoot` = cubic-bezier(.34,1.56,.64,1) (the all-done celebration only).
