# UI moments motion, 2026-11-27

Claude Design's motion for the plans, hand-over and pilot brief (`.claude/designs/2026-11-27-claude-design-brief-plans-handover-pilot.md`). The screen tickets build each animation from its folder; nothing here is built yet.

Each folder holds:

- `motion-<moment>-spec.md`: every part, property, from, to, start, duration and easing (CSS and Flutter).
- Numbered key frames, start to end (`-01-…svg`, `-02-…svg`, …).
- `motion-<moment>-still.svg`: the final pose. Under reduced motion, show it with no movement (a 150 ms fade-in is allowed).
- `-rtl` frames and still where the motion has direction: use them in Arabic, never a CSS mirror.

The reference `.gif` and `.mp4` loops stay in Basel's delivery (`~/Downloads/mtb3a-ui-moments-art-2026-11-27/motion/`); they are rendered from the same spec.

Easings: `--m-ease-spring` (`cubic-bezier(.32,.72,0,1)`, alias `--ease-spring`) for everything; `--m-ease-overshoot` (`cubic-bezier(.34,1.56,.64,1)`, alias `--ease-overshoot`) for celebrations only. Use the `--ease-*` aliases in portal CSS: under reduced motion the durations go to 0 and `--ease-overshoot` turns `linear`.

| Moment | Folder | Ticket | Direction | Total |
|---|---|---|---|---|
| The gift month | [gift-month](gift-month/) | MUT-733 (portal), MUT-706 (phone) | neutral | 1.40 s, once |
| Plan upgraded | [plan-upgraded](plan-upgraded/) | MUT-734 | neutral | 1.12 s, once |
| The account is theirs | [handover-claimed](handover-claimed/) | MUT-769 | -rtl | 1.32 s, once |
| Pilot welcome sheet | [pilot-sheet](pilot-sheet/) | MUT-755 (portal), MUT-756 (phone) | -rtl | 0.80 s, once (the spec's intro says 0.78 s; its table ends at 800 ms) |
| First scan, first invoice | [milestone](milestone/) | MUT-758 | -rtl | 0.94 s, once |
| Activating | [activating](activating/) | MUT-768 | -rtl | 1.5 s loop while polling (up to 2 min), then 0.6 s to resolve |
| Claim code reveal + Copied | [claim-code](claim-code/) | MUT-770 | neutral (codes are LTR) | 0.62 s reveal; Copied 0.24 s, reverts after 2 s |
| Usage meter 80% → 90% | [usage-meter](usage-meter/) | MUT-733 (portal), MUT-706 (phone) | -rtl | 0.6 s per step; tone change 0.35 s only when crossing 90% |
| Downgrade scheduled · Undo toast | [undo-toast](undo-toast/) | MUT-734 | -rtl | 0.42 s in, stays 6 s; Undo collapses in 0.49 s |
| Category filled for you | [autofill](autofill/) | MUT-775 | -rtl | 1.64 s (0.16 s draw, 1.2 s hold, 0.24 s fade) |

The scenes these moments start and end on are in `assets/illustrations/source/` and render through `Scene` (DESIGN.md › Scenes).
