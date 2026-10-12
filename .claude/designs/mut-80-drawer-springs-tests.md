# MUT-80 — Drawers open, close and drag on springs: test plan

- **Ticket:** MUT-80 (epic MUT-74) · **Brief:** `landing-apple-redesign.md` R2 (and HP1: the hosted portal inherits it) · **ADR:** ADR-043 (the `motion` dependency and the exit model)
- **Files:** `src/lib/motion/__tests__/physics.test.ts`, `src/components/ui/drawer/__tests__/drawerGesture.test.ts`, `src/components/ui/drawer/__tests__/exitSnapshot.test.ts`, `src/components/ui/drawer/__tests__/DrawerFrame.test.tsx`, `src/lib/dom/__tests__/focusable.test.ts`, `e2e/drawer-motion.spec.ts`

## Implementation decisions

| # | Decision |
|---|---|
| D1 | **One shared frame.** `DrawerFrame` (`src/components/ui/drawer/`) owns the shell and all motion, focus and gesture behaviour. The local `Drawer` and the hosted portal's `Drawer` become thin wrappers. `components/ui` is importable from `src/hosted/**`, so the lint boundary (no `components/drawers` in the portal) holds. The local wrapper's close label becomes `t('common.close')` instead of a hard-coded "Close". |
| D2 | **State closes at once; the exit is presentation.** `onClose` stays synchronous for Escape, ✕ and the overlay. Consumers keep closing through their stores on Save, Cancel and Delete. The drawer is closed the moment `onClose` runs; nothing waits for an animation. |
| D3 | **Exit snapshot.** When a drawer unmounts while visible, the frame clones its overlay and panel. It copies the current input, textarea, checkbox/radio and select state and the scroll positions, marks the clone `inert` + `aria-hidden` with `pointer-events: none`, and inserts it where the original was. The clone then springs from the panel's current offset and velocity to off-screen, the overlay fading in step, and is removed when settled. A microtask first checks that the original really left the document, so StrictMode's simulated unmount leaves nothing behind. *Why not keep the live tree mounted (AnimatePresence)?* The stores reset on close (`{ isOpen: false, mode: 'create' }`), so a live tree would re-render during its exit with reset state: an edit title turning into "New", or a deleted record turning into a loading state. iOS uses snapshot views for transitions for the same reason. |
| D4 | **Drag.** A primary-button press on the panel starts tracking, except on `input`, `textarea`, `select`, editable content, `[data-drawer-no-drag]`, inside an element that scrolls horizontally, or while text is selected in the drawer. After 10px of movement: horizontal becomes a drag (`setPointerCapture`, `user-select: none`); vertical means scrolling wins for the rest of that press. `touch-action: pan-y`. The offset follows the pointer 1:1 from where it was grabbed (offset at grab + pointer delta). Past fully open it rubber-bands (Apple's constant 0.55; dimension = panel width). The click that ends a drag is swallowed. |
| D5 | **Release.** Velocity comes from the pointer samples of the last 100ms. Projected = offset + `projectMomentum(v, 0.998)`. Past half the panel width it dismisses; otherwise it springs back to open, carrying the velocity. A drag dismiss is a *live* exit that the drawer commits itself: it springs out with the release velocity and calls `onClose` once it is off-screen. |
| D6 | **Interrupt.** A press on the panel during any live motion (enter, spring back, drag dismiss) stops it where it is on screen, and tracking continues from there; release decides again. A press that never becomes a drag resumes by the same release rule, so a click during the enter finishes opening. Snapshot exits are committed (the record is saved, the store is closed) and cannot be caught. |
| D7 | **Springs.** Apple's response and damping ratio become stiffness and damping: `k = (2π/response)²`, `c = 4π·ζ/response`, mass 1. Every drawer spring is response 0.3 and damping ratio 1.0 (critically damped). An overshoot would pull the panel away from the screen edge, so there is no bounce even after a flick. |
| D8 | **Overlay.** Opacity = 1 − clamp(offset / width), for both the live drawer and the snapshot. While rubber-banding it stays 1. |
| D9 | **RTL.** The panel's computed `direction` picks the edge: the offset sign flips, and dragging left dismisses. |
| D10 | **Reduced motion.** Enter and exit cross-fade opacity over 150ms (panel and overlay) with no translate. A drag still tracks 1:1, because it is the person's own motion. A dismiss fades out from where the panel is; a spring back returns at once. |
| D11 | **No layout, no motion.** When the panel has no width (not laid out; jsdom), there is no enter and no snapshot: the drawer appears and disappears as before. Existing component tests therefore keep their synchronous behaviour. |
| D12 | **At rest the panel has no inline `transform`** (it is cleared at offset 0, and `opacity` is cleared at 1). A transform would make the panel the containing block for `position: fixed` descendants (popovers, typeahead lists). |
| D13 | **Focus.** The frame remembers the element focused when it first renders (the trigger). After mount, if no child took focus (`autoFocus`), it focuses the dialog (`tabIndex=-1`). Tab and Shift+Tab wrap at the ends; this is a keydown handler on the panel, so it doesn't fight a modal opened on top. On a real unmount, focus returns to the trigger if the trigger is still in the document and nothing else has taken focus. The dialog gets `aria-labelledby` for its title. (The ticket says "still work", but there was no trap before; this adds it.) |
| D14 | **Dependency.** `motion@13.4.4` is pinned exactly: the newest release at least two weeks old on 2026-10-12. Only the vanilla `animate` and `motionValue` are used, never the `motion.div` component. The bundle cost is recorded in ADR-043. |
| D15 | The `slideIn` / `slideInRTL` keyframes and the overlay's `fadeIn` animation are removed from `.drawer` / `.drawer-overlay`; JS drives them now. |
| D16 | The focusable-element selector moves from `useMenuButton` to `src/lib/dom/focusable.ts` (`FOCUSABLE_SELECTOR`, `focusablesWithin`), shared by the menu button's dialog mode and the drawer trap. |
| D17 | The physics stays generic in `src/lib/motion/physics.ts` (`springFromResponse`, `projectMomentum`, `rubberband`, `rubberbandInverse`, `velocityFromSamples`) for the later stories (payment, after-save). Drawer-specific rules live in `drawerGesture.ts`. |

**Out of scope:** modals, menus and popovers keep their current motion. Trackpad horizontal scroll (wheel `deltaX`) does not dismiss a drawer.

## Rules under test

| # | Rule | Level |
|---|---|---|
| T1 | `projectMomentum`: 0 → 0; 1000 px/s at 0.998 → 499 px; the sign is kept; 0.99 projects less | unit |
| T2 | `rubberband`: 0 → 0; a small overshoot ≈ 0.55× itself; monotonic; never reaches the dimension; the sign is kept. `rubberbandInverse` undoes it | unit |
| T3 | `springFromResponse(0.3, 1)` → stiffness ≈ 438.65, damping ≈ 41.89, mass 1; a lower ratio gives less damping | unit |
| T4 | `velocityFromSamples`: fewer than 2 samples → 0; only samples in the last 100ms of the newest count; px/s; zero elapsed time → 0 | unit |
| T5 | `classifyDrag`: under 10px either way → pending; ≥10 horizontal and more than vertical → horizontal; ≥10 vertical and at least horizontal → vertical | unit |
| T6 | `closingDelta`: LTR → right is positive; RTL → left is positive | unit |
| T7 | `displayOffset`: non-negative values pass through, capped at the exit distance; negative values rubber-band | unit |
| T8 | `releaseTarget`: slow and past half → dismiss; slow and short of half → open; an 800 px/s flick from 60px → dismiss; a flick toward open from 300px → open; exactly half → open | unit |
| T9 | `overlayOpacity`: 0 → 1; width → 0; half → 0.5; negative → 1; beyond the width → 0 | unit |
| T10 | `exitDistance(width)` = width + 32 (shadow clearance) | unit |
| T11 | `isNoDragTarget`: inputs, textareas, selects, editable content, `[data-drawer-no-drag]` descendants and horizontally scrolling regions refuse a drag; a button or plain text accepts one | unit |
| T12 | `captureExitSnapshot` copies the text value, textarea value, `selectedIndex` and `checked` onto the clone; the clone root is `aria-hidden`, `inert`, `pointer-events: none` | unit |
| T13 | `attach()` inserts the clones where the originals were and restores the descendants' `scrollTop` | unit |
| T14 | `focusablesWithin` lists enabled controls in DOM order and skips disabled ones, `tabindex="-1"` and `[hidden]` subtrees | unit |
| T15 | The dialog is named by its title (`aria-labelledby`), is `aria-modal`, and the close button has the given label | component |
| T16 | Escape, ✕ and the overlay call `onClose` synchronously | component |
| T17 | With layout: after unmount, a hidden snapshot of the overlay and panel stays; the live dialog leaves the accessibility tree at once; the snapshot moves toward the edge and is removed when settled | component |
| T18 | RTL: the snapshot moves toward the left edge (negative translate) | component |
| T19 | Reduced motion: the enter has no transform and starts at opacity 0; the exit snapshot keeps its position, fades out and is removed | component |
| T20 | No layout: no inline transform on mount and no snapshot after unmount | component |
| T21 | Under StrictMode, mounting leaves no snapshot behind | component |
| T22 | Drag: a slow drag past half, then release → `onClose` after the exit, not on release; a slow drag short of half → springs back, `onClose` never called; a vertical move first → the panel never moves; a press on an input → the panel never moves; RTL → dragging left dismisses | component |
| T23 | The overlay opacity follows the drag (offset 240 of 480 → 0.5) | component |
| T24 | Interrupt: pressing the panel during a drag-dismiss exit, dragging back and releasing → `onClose` is never called and the panel comes to rest open | component |
| T25 | Focus: with no child autofocus, focus moves to the dialog; a child's `autoFocus` is kept; Tab from the last control wraps to the first and Shift+Tab from the first wraps to the last; after unmount, focus returns to the trigger; it is not stolen when something else has taken focus | component |
| T26 | The existing suites pass unchanged: IncomeDrawer, hosted ExpenseDrawer, PartialPaymentDrawer, OrphanedRecordsDrawer, ClientDetailPage, useMenuButton | regression |
| T27 | Escape on the income drawer: the dialog leaves the accessibility tree at once; the snapshot slides out and is gone within a second | e2e |
| T28 | A mouse drag right by more than half the panel closes it; less than half leaves it open | e2e |
| T29 | In Arabic the panel is on the left, and dragging left closes it | e2e |

## Edge cases

- Escape while dragging → `onClose` runs, and the snapshot continues from where the finger left it.
- Overlay click during a drag-dismiss exit → `onClose` is called once; the live exit is stopped by the unmount and never calls it again.
- A drawer that swaps its loading shell for the form keeps the same frame instance (same element type, same position), so it doesn't re-enter.
- The whole app shell unmounts while a drawer is open → the snapshot leaves with its parent.

## Browser checks (web-mut74 preview, port 5182)

- Open, Escape, ✕, overlay, Save and Cancel all leave along the same edge; nothing flashes or changes content during the exit (edit income, then Save).
- Drag slowly past and short of half; flick from a short offset; catch a flicked drawer mid-exit and pull it back.
- Vertical scroll inside a long drawer still scrolls; dragging from inside a text field selects text instead of moving the drawer.
- Arabic: the drawer enters from and leaves to the left; dragging left dismisses.
- Reduced motion (emulated): cross-fades only.
- A typeahead list inside the drawer sits under its field at rest (no containing-block shift).
- Bundle: the web build's entry chunk, gzipped, before and after.
