# MUT-337 — Icon animation runtime: evaluation + prototype

## Problem

The MUT-335 icon set is drawn multi-part (`data-part="nuqta"` etc., MUT-336)
specifically so something can animate one part independently, with a playful
preset for personal accounts and a restrained one for firms — but nothing
decides *how* that animation plays. MUT-338/339/340 (save-feedback, streaks,
milestones) are all blocked on this ticket landing first.

## What this repo already decided (the comparison isn't starting from zero)

Three prior decisions in this codebase bound the answer before any new
research:

1. **ADR-044 (MUT-80/82, `.claude/PATTERNS.md:1853`)**: this app's motion
   already runs on the `motion` package (Framer Motion's successor,
   `package.json` — no `lottie-web`, no `gsap`, no Rive anywhere in the repo).
   Pattern: drive `transform`/`opacity` from `motionValue`s with
   `.on('change', paint)`, write styles yourself, never React state for
   per-frame work. `src/lib/motion/{physics,presets,rowEnter,rowExit}.ts` is
   the established home for this.
2. **ADR-079/080 (MUT-203/204, `.claude/DECISIONS.md:3188`)**: the bloom
   loader rejected the **`lottie-web` runtime** specifically — not animation
   in general — because it needed a custom element injecting a `<style>` into
   a shadow root, and **the portal CSP is `default-src 'self'` with no
   `unsafe-inline`** (`server/src/app.ts`): no inline `<style>`, no `style=""`
   attribute text, no inline `<script>`. `BrandLoader.tsx` ports the same
   animation as plain SVG SMIL instead. Critically, **CSP does not restrict
   JS writing to `element.style` via the CSSOM** (`el.style.transform = …`) —
   only literal style/script *text* in the DOM. That's why `motion`'s
   JS-driven-transform approach already works under this CSP; a library that
   needs to inject markup or a stylesheet does not.
3. **The MUT-335 inventory doc's own style sheet** (mutaba3a-flutter's
   `.claude/designs/mut-335-icon-inventory.md`) already specifies the
   mechanism, not just the vibe: *"their playful/restrained distinction is
   carried entirely by easing curve and transform… reusing Flutter's existing
   `MMotion.overshoot` for playful, `MMotion.spring` for restrained."*
   `MMotion` is real, already shipping code:
   `mutaba3a/lib/presentation/theme/mutaba3a_theme.dart:74-76`:
   ```dart
   class MMotion {
     static const spring = Cubic(0.32, 0.72, 0, 1);
     static const overshoot = Cubic(0.34, 1.56, 0.64, 1);
   }
   ```
   These are cubic-bezier control points — portable byte-for-byte to any
   runtime that accepts a 4-number bezier (CSS `cubic-bezier()`, `motion`'s
   `ease: [x1,y1,x2,y2]`, Flutter's `Cubic`). The "preset" is not two
   different engines; it's the same transform played through one of two
   named curves.

So the real question isn't "which general-purpose animation engine" — it's
"what plays a transform on a `data-part` element, through one of these two
curves, cleanly under this CSP and this app's existing patterns." That
narrows the field to two genuinely distinct candidates plus the one the
ticket explicitly asks to rule in or out (Rive).

## Candidate comparison (AC #1)

| | **A: `motion`-driven transform (web) / `AnimationController` + `CurvedAnimation` (Flutter)** | **B: CSS keyframes via toggled class (web) / implicit `AnimatedXxx` widgets (Flutter)** | **C: Rive** |
|---|---|---|---|
| New dependency | None — both platforms already ship this exact tool for other motion (ADR-044; Flutter's bloom loader/capture entrance already use `MMotion`) | None | New on both platforms: `rive-react`/`@rive-app/canvas` (~100-200 KB web) + Flutter's `rive` package; plus a `.riv` binary export step per icon |
| Portal CSP | Clean — JS writes `element.style` directly, same proof as `BrandLoader` | Clean if the keyframes live in a compiled `.css` file (this app's existing stylesheets already do); breaks if generated inline per-instance | `.riv` asset fetch is `connect-src`/fetch, not script/style — survives CSP, but the runtime itself still needs `'wasm-unsafe-eval'` for its WASM module, which **isn't in `PORTAL_CSP` today** — a new CSP grant, the same category of change ADR-079 avoided |
| Playful ↔ restrained switch | Pass a different `ease` (the two `Cubic` tuples above) into the same `animate()` call / same `CurvedAnimation` — one code path, one runtime condition | Two keyframe sets or a CSS custom property swap — works, but means hand-authoring two keyframe declarations per animated icon instead of one parameterized call | Rive "state machines" are built for exactly this, but that capability is the thing being paid for with a new runtime + asset pipeline the other two don't need |
| Interruptibility (re-trigger before settle) | Native — `motionValue`s are the current live value, same mechanism `useDrawerMotion`/`rowExit` already rely on | Harder — CSS restarts from the keyframe's `0%`, not the element's current computed position, unless hand-rolled with FLIP; this app doesn't have that today | Native (state machine), but see above |
| Reduced motion | `usePrefersReducedMotion()` already exists (`src/lib/motion/mediaQuery.ts`) and is the established guard everywhere else motion plays | Same hook; gate the class toggle | Would need its own reduced-motion branch inside the `.riv` state machine or an app-side bypass |
| Cross-platform parity proof | The same 4 `Cubic`/bezier numbers on both platforms — a parity test (same shape as `bloomLoaderData.ts`'s parity test against the Lottie JSON) can assert web and Flutter use identical curves | Same numbers, same provability | Binary `.riv` format — no text diff to assert parity; would need a rendered-frame comparison instead |

**Decision: A** — a `motion`-driven transform on web, `AnimationController` +
`CurvedAnimation(curve: MMotion.overshoot | MMotion.spring)` on Flutter.
Rejected: **C (Rive)** for the same shape of reason ADR-079 rejected
`lottie-web` — a new runtime, a new CSP grant, and a new asset pipeline to buy
capability (full state machines) this ticket's actual requirement (swap one
of two known curves on a transform) doesn't need. **B (CSS keyframes)** isn't
wrong, but loses interruptibility this app already solved for everything else
motion touches (drawers, rows) — using it here would be a second, weaker
motion mechanism living next to the established one for no reason.

## Prototype scope (AC #2, #3) — this session, web half only

1. `src/lib/motion/iconMotion.ts` (new, alongside `presets.ts`): the two named
   curves, **the exact same four numbers as `MMotion`** —
   ```ts
   export const ICON_OVERSHOOT_EASE = [0.34, 1.56, 0.64, 1] as const; // MMotion.overshoot
   export const ICON_RESTRAINED_EASE = [0.32, 0.72, 0, 1] as const;   // MMotion.spring
   ```
   plus `playIconFeedback(targets: Element[], { preset, reducedMotion })` —
   takes the specific part elements to animate (the caller already has them
   via a ref + `querySelectorAll('[data-part]')`, same as MUT-337's own
   `data-part` design intends; the function never reaches into an icon's
   internals by name, so it doesn't couple to any one icon's part names) and
   an injected `reducedMotion` boolean (same shape as `playRowEnter`), so it's
   unit-testable without a real animation frame. Returns the `motion`
   playback controls so a rapid re-trigger can `stop()` the prior play and
   restart from the live value — the exact interruptibility this won over
   CSS keyframes for in the comparison above, so the prototype has to prove
   it, not just claim it.
2. Pilot icon: `SuccessIcon` (already generated, MUT-336 — a circle + check,
   exactly the save-feedback shape MUT-338 will need). A small
   `IconFeedbackDemo` or direct wiring is **not** added as new app UI — the
   prototype proves the mechanism via a component test that triggers
   `playIconFeedback` and asserts the two presets produce different
   `motionValue` targets/durations, plus one real-browser proof (`npm run
   dev`, manually trigger, confirm no CSP console error) since jsdom can't
   observe actual paint. Wiring this into a real save-feedback trigger is
   MUT-338's job, not this ticket's.
3. Reduced motion: `reducedMotion: true` skips the preset entirely — the part
   jumps straight to its end state in one frame (same fallback shape as
   `REDUCED_MOTION_FADE_SECONDS`/`captureExitSnapshot`), proven by a test.

## Flutter handoff (not built in this session)

`AnimationController` + `CurvedAnimation(curve: MMotion.overshoot /
.spring)` driving a `CustomPainter` (or `Transform.scale`/`Transform.rotate`
wrapping the generated icon widget's named part — MUT-336's Flutter half
decides the exact generated-widget shape, this ticket only needs the curve
wired through). Needs its own mutaba3a-flutter worktree.

## Parity test (both repos, follow-up)

A text-level test asserting the web `ICON_OVERSHOOT_EASE`/`ICON_RESTRAINED_EASE`
arrays equal Flutter's `MMotion.overshoot`/`.spring` control points —
same shape as the bloom loader's Lottie-JSON parity test. One repo can only
assert its own half; record the matching numbers in both PATTERNS.md entries
so a future change to one is caught by eye, same as the icon mirror's
`icons:check` catches drift in content.

## Test plan

- `src/lib/motion/__tests__/iconMotion.test.ts`: `playIconFeedback` with
  `preset: 'playful'` uses `ICON_OVERSHOOT_EASE`; `'restrained'` uses
  `ICON_RESTRAINED_EASE` (asserted by sampling the interpolated value at a few
  points in time and showing the two presets diverge — not just "which
  constant got passed in"); `reducedMotion: true` skips the animation and sets
  the end state immediately regardless of preset; re-triggering mid-flight
  `stop()`s the prior playback and restarts from its live value rather than
  jumping back to the start (the interruptibility claim in the comparison
  table, proven, not just asserted).

## QA scenarios

No user-visible feature ships from this ticket (same exception MUT-334's
epic grants the icon-foundation stories) — the prototype is a unit-tested
library function, not a screen. MUT-338 (the first consumer) carries its own
release-QA coverage per its own acceptance criteria.

## Business / product impact

Unblocks the epic's highest-priority mechanic (MUT-338, save-feedback) and
its two siblings (streaks, milestones) — without this decision, none of them
can start. Reuses tooling already paid for (ADR-044's `motion` adoption,
`MMotion`'s existing curves) instead of adding a new runtime/dependency on
both platforms, keeping the gamification epic's cost low relative to its
"highest-priority" framing in MUT-334.
