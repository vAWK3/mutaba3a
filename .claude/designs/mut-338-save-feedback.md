# MUT-338 — Animated save-feedback: playful personal / restrained firm

**Tracker**: Jira · barmajiyat.atlassian.net · MUT via `atlassian-barmajiyat` ·
`Backlog` = not committed · `In Progress` = building · `In Review` = merged,
awaiting `/qa-reconcile` · `Done` = reconciled. MUT-338 itself is `Backlog`
(no plan existed yet — this is that plan).

## Blocker gate (Step 1b)

Formal blockers MUT-335/336/337 all show Jira `In Review`, not `Done`. Verified
against `git log` on local `main` (jira-status-lag pattern — status lags
merges by days):

- `8f3bd488` Merge `feature/mut-337-icon-animation-runtime` (ADR-152) — merged.
- `6b948247` Merge `feature/mut-336-icon-codegen` — merged.
- MUT-335's output (`assets/icons/source/*.svg`, 61 files) is what MUT-336's
  codegen already consumed — `src/components/icons/generated/SuccessIcon.tsx`
  exists with `data-part="ring"`/`data-part="check"`.

**Gate cleared**: all three are code-complete on local `main`, just not yet
transitioned to `Done`. Safe to plan and build.

## Neighborhood

Epic MUT-334 (Backlog) — "Gamification: playful for personal, restrained for
firms." Siblings MUT-339 (streaks) and MUT-340 (milestones), both Backlog,
**untouched** — out of scope here (ticket's own "Scope (out)"). MUT-350
(relates to, illustration spec refinement) is unrelated to icons, ignored.

## What already exists (reuse, don't rebuild)

- `src/lib/motion/iconMotion.ts`: `playIconFeedback(targets, {preset,
  reducedMotion})`, `ICON_OVERSHOOT_EASE`/`ICON_RESTRAINED_EASE` (ADR-152).
  Takes DOM elements, is unit-tested, proven interruptible. **This ticket's
  entire job is wiring this into a real save, per MUT-337's own brief**: "no
  new UI ships from MUT-337... wiring it into a real save trigger ... is
  MUT-338's job."
- `src/components/icons/generated/SuccessIcon.tsx`: circle (`data-part="ring"`)
  + check (`data-part="check"`), exactly the save-feedback shape.
- `src/lib/motion/mediaQuery.ts`'s `useMediaQuery` — the existing
  `prefers-reduced-motion` pattern (`rowEnter.ts`/`rowExit.ts` already use it).

## The real gap: there is no visible static chip to "add motion to" on web

The ticket's problem statement models web as having a static
`CheckCircleIcon` success chip, mirroring Flutter's `last_saved_chip.dart`.
That's not what's actually in the code. The real save-confirmation surfaces
are the "claimed" branch of `SavedFlashAnnouncer.tsx` (legacy app) and
`SavedNotice.tsx` (portal) — both render **only**:
```tsx
<span className="sr-only" role="status" aria-live="polite">Saved</span>
```
Screen-reader-only, nothing visible, no icon. The "unclaimed" branch (save
landed off-screen) does show something visible — a toast/notice with a
message and a Show action — but it has no icon either. And the legacy app's
`ExpenseDrawer.tsx` has **no success confirmation of any kind** today (create/
update produce no toast; only delete does).

This changes the shape of the ticket from "animate an existing icon" to "add
the first visible icon to these confirmations, animated from day one." Still
squarely inside the AC ("play the icon system's save-feedback animation" on
save) — just means the diff touches presentation, not only motion wiring.

## Five save surfaces (two apps, both need coverage)

| # | App | Entry kind | Current success UI | File |
|---|-----|-----------|---------------------|------|
| 1 | Legacy (top-level `src/`, Dexie, always local, no firm concept) | Income | `markSaved` → `SavedFlashAnnouncer` (claimed: sr-only "Saved"; unclaimed: toast+Show) | `src/components/drawers/IncomeDrawer.tsx`, `src/components/layout/SavedFlashAnnouncer.tsx` |
| 2 | Legacy | Expense | **none** (gap) | `src/components/drawers/ExpenseDrawer.tsx` |
| 3 | Portal (`src/hosted/`, `PortalMode` local-or-remote) | Income | direct toast, `tone: 'info'` | `src/hosted/components/IncomeCaptureDrawer.tsx`, `src/hosted/components/Toast.tsx` |
| 4 | Portal | Expense | `markSaved` → `SavedNotice` (claimed: sr-only; unclaimed: `NoticeBox`) | `src/hosted/components/ExpenseDrawer.tsx`, `src/hosted/components/SavedNotice.tsx` |
| 5 | Portal | Conversion | same as #4 | `src/hosted/components/ConversionDrawer.tsx`, `SavedNotice.tsx` |

Payments (`PartialPaymentDrawer.tsx`) are explicitly out of the ticket's scope
("Scope (out): ... any animation not tied to the immediate save action" plus
the AC list names only expense/income/conversion) — **leave untouched**, even
though `savedFlashStore`'s `kind` union includes `'payment'`.

## Personal vs firm/org: the preset source doesn't exist yet in one place

- Portal: `HostedProfile.type: "PERSONAL" | "BUSINESS" | null` +
  `isPersonalDefault: boolean`, already read via `useMe()`
  (`src/hosted/session/me`) elsewhere (`ProfileSwitcher.tsx`,
  `profileRules.ts`). Restrained only when `type === 'BUSINESS'`.
- Legacy app: `BusinessProfile` (`src/types/index.ts`) has **no** `type` field
  — local organizations never carry a firm flag (MUT-299 B11: "Firm features
  are never available signed out: local organizations never get
  `firmEnabledAt`"). So the legacy app's preset is always `'playful'` — not a
  workaround, it's the documented rule.

New pure helper (testable without React, matches the project's "inject
booleans" pattern already used by `playIconFeedback`/`playRowEnter`):

```ts
// src/lib/motion/saveFeedbackPreset.ts
export function saveFeedbackPreset(
  profile: { type?: 'PERSONAL' | 'BUSINESS' | null } | null | undefined
): IconFeedbackPreset {
  return profile?.type === 'BUSINESS' ? 'restrained' : 'playful';
}
```
Legacy call sites pass nothing (`saveFeedbackPreset(null)` → `'playful'`).
Portal call sites pass the active profile from `useMe()`.

## New shared component

```tsx
// src/components/icons/SaveFeedbackIcon.tsx
interface SaveFeedbackIconProps { preset: IconFeedbackPreset; size?: number }
export function SaveFeedbackIcon({ preset, size = 16 }: SaveFeedbackIconProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    if (!ref.current) return;
    playIconFeedback(Array.from(ref.current.querySelectorAll('[data-part]')), { preset, reducedMotion });
  }, [preset, reducedMotion]); // re-trigger covers a toast/notice re-mounting per save (new `key`)
  return (
    <span ref={ref} className="save-feedback-icon">
      <SuccessIcon size={size} />
    </span>
  );
}
```
**Revised after `/plan-eng-review` (finding below): no codegen/forwardRef
change.** `SuccessIcon` stays exactly as generated. The ref lives on a plain
wrapping `<span>`, queried the same way `playIconFeedback`'s own contract was
already written for (MUT-337's brief: "the caller already has them via a ref +
`querySelectorAll('[data-part]')`") — the ref was always meant to belong to
the caller's container, not the icon component itself. Purely additive by
construction: it mounts and animates *after* the save already happened (every
call site below renders it from data the save already produced), never gates
anything.

**Known, accepted gap (low severity, not fixed here):** `playIconFeedback`
(`src/lib/motion/iconMotion.ts`) doesn't hand its `AnimationPlaybackControls`
back to the caller — only `activeByTarget` tracks them internally, keyed by
element, for the next *re-trigger* to `.stop()`. If `SaveFeedbackIcon` unmounts
before the 400ms animation completes (toast dismissed early, page navigated
away), nothing explicitly stops it — it keeps writing `el.style.transform` on
a detached node for the remainder of its 400ms, then completes and cleans up
its own WeakMap entry. Harmless (no error, no leak — the element is GC-eligible
once `onComplete` fires), already true of MUT-337's shipped function as
reviewed. Not worth widening `iconMotion.ts`'s API for a ~400ms tail; flagging
so it isn't mistaken for an oversight.

## Per-surface wiring (smallest diff per surface)

1. **Legacy income** — `SavedFlashAnnouncer.tsx`'s claimed branch: swap the
   `sr-only` span for a small visible chip (`<SaveFeedbackIcon preset="playful" />`
   + the same text, no longer visually hidden). Unclaimed branch: prepend the
   icon to the existing toast's content (new `icon` slot on
   `showToast`/`ToastContainer`, default none so other callers are unaffected).
   Preset is always `'playful'` — no profile lookup needed, legacy has no
   firm concept.
2. **Legacy expense** — add the missing success toast first (mirrors
   `IncomeDrawer`'s shape: `showToast(t('expenses.saveSuccess'), { type:
   'success' })` after create/update resolve), with the icon via the same new
   `icon` slot. Flagging this explicitly: it's new user-visible confirmation
   text that didn't exist before, not just motion — net-new, in-scope only
   because the AC names expense saves by name and there'd otherwise be nothing
   to attach the required animation to. Preset always `'playful'`, same reason
   as #1.
3. **Portal income** — `src/hosted/components/Toast.tsx` gains a third tone,
   `'success'`, rendering `<SaveFeedbackIcon preset={...} />` instead of
   `InfoIcon` (mirrors the existing `error`→`AlertIcon`/`info`→`InfoIcon`
   pattern exactly). `IncomeCaptureDrawer.tsx` passes `tone: 'success'`
   instead of `'info'`. This drawer already holds the full `profile` object
   (`profile.id` used at lines 226/342) — `saveFeedbackPreset(profile)`
   directly, no extra lookup.
4. **Portal expense/conversion** — `SavedNotice.tsx`'s claimed branch (sr-only
   span) and `NoticeBox` (unclaimed) both gain the icon, same shape as #1.
   **Correction after `/plan-eng-review`:** `SavedNotice`, `ExpenseDrawer`
   (hosted) and `ConversionDrawer` only receive `profileId: string`
   (`SavedNoticeProps.profileId`, `ExpenseDrawerProps.profileId`) — not the
   full `HostedProfile`. The original draft assumed these three had the same
   `profile` object `IncomeCaptureDrawer` does; they don't. Fix: resolve the
   preset inline with `useMe()`, the same `.find()`-by-id shape already used
   at `ProfilesManageDrawer.tsx:48` and `ProfileEditForm.tsx:120` (no new
   helper — matches the existing convention, doesn't thread a new prop
   through three existing call chains):
   ```ts
   const me = useMe();
   const preset = saveFeedbackPreset(me?.profiles.find((p) => p.id === profileId));
   ```

## Reduced motion (AC)

`useMediaQuery('(prefers-reduced-motion: reduce)')` → `reducedMotion: true` →
`playIconFeedback` already jumps straight to the settled state in one frame
(proven in MUT-337's test suite) — no new logic, just wiring the existing
flag through `SaveFeedbackIcon`.

## Test plan (TDD — write these first)

- `src/lib/motion/__tests__/saveFeedbackPreset.test.ts`: `{type:'BUSINESS'}` →
  `'restrained'`; `{type:'PERSONAL'}`, `{type:null}`, `undefined`, `null` →
  `'playful'`.
- `src/components/icons/__tests__/SaveFeedbackIcon.test.tsx`: mount calls
  `playIconFeedback` (spy) with the right preset; `prefers-reduced-motion:
  reduce` (mock `matchMedia`) passes `reducedMotion: true`; re-mounting with a
  new key re-triggers.
- Extend `IncomeDrawer.test.tsx`, add `ExpenseDrawer` save-success test,
  `IncomeCaptureDrawer.test.tsx`, hosted `ExpenseDrawer`/`ConversionDrawer`
  tests, `SavedFlashAnnouncer`/`SavedNotice` tests: icon renders on successful
  save; absent on a failed save (error path untouched); a failing save is
  never delayed by the icon (assert toast/notice still fires synchronously).
- `scripts/__tests__/icon-set.test.ts` (or new test) covers the ref-forwarding
  template change in codegen, so `npm run icons:check` still passes clean.

## release-QA (CLAUDE.md definition of done)

Extend `qa/features/web/income.yaml` and `.../expenses.yaml` (legacy, `app:
web`) and the portal equivalents under `qa/features/portal/` with a
`save-feedback-animation` scenario each:
- personal/legacy profile → playful preset plays (assert via a captured frame
  or the eased-overshoot timing, per existing motion QA conventions — check
  `qa/features/web/drawer-motion.yaml` for the established assertion shape).
- portal BUSINESS profile → restrained preset plays.
- `prefers-reduced-motion: reduce` (Playwright `emulateMedia`) → the icon
  renders settled, no motion asserted.
Tagged specs in `qa/specs/web/` and `qa/specs/portal/`, run once via
`release-qa run --attach --only <id>` before calling this done.

## Build sequencing (`/plan-eng-review` complexity finding)

Counted: 2 new modules (`SaveFeedbackIcon.tsx`, `saveFeedbackPreset.ts`) +
~10 touched files (`SavedFlashAnnouncer`, `SavedNotice`, hosted `Toast`,
`IncomeDrawer`, legacy `ExpenseDrawer`, `IncomeCaptureDrawer`, hosted
`ExpenseDrawer`, `ConversionDrawer`, `ToastContainer`/`toastStore`) + their
tests — past the single-PR comfort zone. None of the five surfaces is
droppable (the AC names all three entry kinds across both apps), so this
isn't a scope cut — it's a build-order recommendation for `/eng-build`'s
checkpoint-commit discipline:
1. Shared primitives (`saveFeedbackPreset.ts`, `SaveFeedbackIcon.tsx`) + tests — nothing else depends on anything but these.
2. Legacy income (`IncomeDrawer` + `SavedFlashAnnouncer`) — the fullest existing infra, proves the wiring end to end.
3. Legacy expense (adds the missing success toast + icon).
4. Portal income (`Toast.tsx` tone + `IncomeCaptureDrawer`).
5. Portal expense/conversion (`SavedNotice` + the `useMe()` preset lookup, same shape for both drawers).
Each step is independently testable and shippable; a reviewer can stop after
any step with a working, non-broken state.

## Flutter (out of this repo)

The AC also requires the Flutter capture flow. Per MUT-336/337 precedent,
Flutter's half is planned and built in its own `mutaba3a-flutter` worktree/
session — not here. Recommend: comment on MUT-338 noting the split, or spin a
sibling ticket via `/pm-intake` in that repo for the
`AnimationController`/`CurvedAnimation` wiring MUT-337 already scoped in its
"Flutter handoff" section. This mini-crm plan covers the web AC items only.

## Scope check against the ticket's AC

- ✅ Personal save plays playful icon (legacy always, portal PERSONAL/null).
- ✅ Firm/org save plays restrained icon (portal BUSINESS).
- ✅ Reduced-motion fallback (existing `playIconFeedback` behavior, wired through).
- ⚠️ "Works across both Flutter capture flow and mini-crm web" — this plan is
  the mini-crm half only; Flutter needs its own ticket/session (flagged above).
- ✅ Purely additive, never gates the save.
- ⬜ release-qa coverage — planned above, written during the build.

## Business / product impact

MUT-338 is the epic's (MUT-334) highest-priority mechanic and the **first
real consumer** of MUT-337's animation runtime — until this lands, MUT-339
(streaks) and MUT-340 (milestones) have no proven wiring pattern to copy.
Landing it also quietly closes a real UX gap found during planning (legacy
expense saves currently confirm nothing at all), not just a cosmetic add.
Low cost: reuses `motion` (already paid for by ADR-044) and the MMotion-
matched curves (ADR-152) — no new dependency on either platform.
