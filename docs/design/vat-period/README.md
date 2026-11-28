# VAT period (Claude Design, 2026-11-28; MUT-783)

- `layout.html`: the refined layout, every state, Arabic and English, light and dark (a reference, not shipped).
- `SPEC.md`, `tracks.json`: the three motions (Done 680 ms, Confirm 420 ms, More needed 600 ms) with their parts, curves and reduced-motion stills.
- The scenes are in `assets/illustrations/source/` (`receipts-sent`, `period-confirmed`, `more-needed`, `desk-all-clear`, `period-unset`, with `-rtl` drawings where they point) and the icons in `src/hosted/components/VatIcons.tsx`.
- **Not built yet (TD-377):** the three motions. The portal swaps the chip and the scene without the choreography; reduced motion already matches the spec (the end pose, the chip fades).
