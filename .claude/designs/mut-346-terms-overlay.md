# MUT-346 — Portal: a terms bump mid-session must not throw away an open drawer's draft

Epic MUT-322. Relates MUT-324. **Decision (Basel, 2026-10-25): option 2, an overlay above the Outlet** (Jira comment 12626).

## Where things are (read 2026-10-25)

- `src/hosted/session/AuthGate.tsx:45`: `if (me.data?.terms?.accepted === false) return <TermsUpdatePage version=… />;`. This replaces the
  whole authed subtree: shell, pages and every drawer, since drawers mount inside `HostedShell`/pages and are inline, not portaled.
  Boot and mid-session aren't told apart. `meQuery` (`me.tsx:23-28`) has `staleTime 60 s`, and window-focus refetch is on (TanStack default),
  plus many `ME_KEY` invalidations.
- `TermsUpdatePage.tsx` is a full-page card (`hp-signin`). `agree()` posts `/v1/me/terms-acceptance`, then
  `setQueryData(ME_KEY)` (no refetch). A 409 `TERMS_VERSION_STALE` makes it take `details.current`. It has no dialog role and no focus handling.
- Drawers (`DrawerFrame.tsx`) are inline `role="dialog" aria-modal`, z-index 200/201 (`index.css:2299-2331`), and they put a
  **document-level Escape listener** on (`:31-37`). Popovers do the same (`usePopover.ts:30` and others).
- `Drawer.test.tsx:33-43` forbids `role="dialog"` and `aria-modal` anywhere under `src/hosted` (non-test), so dialog
  primitives live in `src/components/ui`.
- The server doesn't refuse writes while terms are unaccepted (ADR-102 D7, TD-180), so the client must make the background
  unreachable.
- `AccountClosingPage` (`AuthGate.tsx:43`) stays a full page. Closing is deliberate and server-enforced, so there's no draft to keep.

## Plan

1. **New primitive `src/components/ui/modal/BlockingDialog.tsx`** (+ CSS next to the drawer CSS). It's portaled to `document.body`.
   - `role="dialog" aria-modal="true" aria-labelledby`, with a backdrop that has no click-to-close.
   - z-index 300/301 (above drawers 200/201 and popovers; toasts at 9999 stay visible).
   - Logical CSS properties (RTL).
   - Focus moves to the heading on open. Tab is trapped with `focusablesWithin` (`src/lib/dom/focusable`). Focus goes back to the previously active element on close.
   - **Escape is swallowed:** a `window` capture-phase keydown listener calls `stopPropagation()` and `preventDefault()` for Escape while open, so the drawer's document listener never sees it and the draft survives.
2. **AuthGate:** `blocked = me.data?.terms?.accepted === false`.
   ```
   <MeProvider me={me.data}>
     <div className="hp-authed" inert={blocked} aria-hidden={blocked || undefined}><Outlet /></div>
     {blocked && <TermsUpdateDialog version={me.data.terms.version} />}
   </MeProvider>
   ```
   - The same path covers boot and mid-session. At boot the shell renders behind the dialog but can't be reached (inert): no second code path and no boot/mid-session state. `inert` blocks focus, clicks and assistive tech for the whole background, including Save buttons, which matters because the server accepts writes (TD-180).
   - The wrapper `div` must not change the layout. Use `display: contents`, or check that `.hp-shell` still fills the viewport.
3. **`TermsUpdatePage` → `TermsUpdateDialog`.**
   - Same body and behaviour (agree, 409 changed, sign out, language switch, decline line).
   - Rendered inside `BlockingDialog`, without the full-page `hp-signin` wrapper.
   - Its `useLayoutEffect` locale adoption in AuthGate is unchanged.
   - After agreeing, `setQueryData` flips `accepted`, the dialog unmounts and focus returns to the drawer field.
4. **i18n:** no new strings (it reuses `hosted.terms.*`). The `title` becomes the dialog's label.

## Tests

- **Unit** (`src/hosted/session/__tests__/AuthGate.terms.test.tsx`, harness `renderPortal`/`stubApi`):
  - **Draft survives:** a drawer is open with typed text; a `/v1/me` refetch says `accepted:false`; the dialog shows and the drawer input still has its value; agree; the dialog is gone and the value is still there.
  - **Background is unreachable:** while blocked, the Outlet wrapper is `inert`, and pressing Escape doesn't close the drawer.
  - **Focus:** focus is inside the dialog when it opens, and back on the previously focused element after agreeing.
  - **Existing tests:** `TermsUpdatePage.test.tsx` moves over (rename to `TermsUpdateDialog`). All 10 cases are kept.
  - **Primitive:** `BlockingDialog` gets its own test (focus trap wraps, Escape swallowed, no close on backdrop click).
  - **Structural test:** `Drawer.test.tsx` stays green, because the primitive lives in `src/components/ui`.
- **Release-QA:**
  - `qa/features/portal/terms.yaml` gets a new feature `bumped-mid-session-keeps-draft` (tier core). Its paths are AuthGate, `BlockingDialog` and `TermsUpdateDialog`.
  - Spec `@portal.terms.bumped-mid-session-keeps-draft`: open the Add expense drawer and type an amount and a note; `api.bumpTerms(NEWER)`; trigger a refetch (blur/focus, or an action that invalidates `ME_KEY`); the dialog shows; agree; the amount and note are still there; Save works.
  - `updated-terms-step` (`terms.spec.ts:77` `getByRole('navigation') toHaveCount(0)`) becomes "the dialog is shown and the navigation can't be reached" (inert/aria-hidden). Check that Playwright's role query excludes it, otherwise assert `inert`.
  - Run EN and AR.
- Verification: lint, typecheck, `test:run` (affected files while iterating, the full suite through the heavy gate at the end), and the `release-qa run --only` for both ids.

## NOT in scope
- The phone (MUT-344). Server enforcement (TD-180). AccountClosingPage stays a full page.

## Eng review: outside voice (Claude Plan subagent; codex not installed), folded in

The reviewer confirmed the following:
- React 19.2.3 supports the `inert` boolean.
- Nothing in `src/hosted` portals outside AuthGate except toasts.
- There are no `window` keydown listeners, so a capture-phase Escape swallow wins.
- `dir` and the theme are on `<html>`, so a body portal keeps RTL.
- useDrawerFocus won't fight the dialog.
- The closing-page order holds.

Amendments (they replace the matching parts of the Plan and Tests above):

1. **Boot keeps today's behaviour; mid-session gets the overlay.**
   - A `shellShown` ref in AuthGate: the Outlet renders only once it has rendered unblocked.
   - Blocked before that, at boot or sign-in: the dialog shows over an empty backdrop. No shell queries, no `TrialWelcomeOpener` one-shot used up, no `portal_opened` analytics, no figures under the backdrop.
   - Blocked after it, mid-session: the inert background stays mounted and the draft is kept.
   - This holds to Basel's overlay decision (it's what saves drafts) and changes nothing at boot. Existing boot specs and tests keep their meaning.
2. **Focus.**
   - The previously active element is captured **during render** (a `useState` initializer, as in `useDrawerFocus:15`).
   - It's restored in a **passive cleanup with `queueMicrotask`**, after `inert` is removed in the same commit.
   - It's guarded by `isConnected`, with a fallback: the open drawer panel, else `main`.
3. **Wrapper is `display: contents`** (required: `#root` height 100%, `.hp-shell` min-height 100%).
4. **Background stays unreachable, toasts included.**
   - While blocked, `ToastProvider` hides action buttons (Undo/Retry). The server accepts those writes (TD-180).
   - The wrapper has both `inert` and `aria-hidden`. Playwright's role engine ignores `inert`; Chrome's ancestor-aria-hidden warning is harmless.
5. **Dialog markup.**
   - No `<main>` and no `hp-signin` wrappers.
   - Heading: h2 when over the background; h1 at boot over the empty backdrop, so terms.spec's `level: 1` queries stay valid for boot.
   - Check the view-transition snapshot on the boot redirect in EN and AR.
6. **Deterministic mid-session trigger in the spec.**
   - TanStack 5.90 `focusManager` listens to `visibilitychange` only, and `meQuery` is stale only after 60 s.
   - The spec opens the drawer, then `api.bumpTerms(NEWER)`, then `page.clock.fastForward('61s')`, then dispatches `visibilitychange` (hidden → visible).
   - If the clock fights drawer motion, use the FakeApi refusal path that calls `rereadMe` (`queryClient.ts:36`). Decide while building and record it in the spec comment.
7. **Proof lives in Playwright; jsdom 27.4 has no `inert`.**
   - **Unit tests assert only:** the attribute is present, Escape doesn't close the drawer, the draft value survives, and the dialog is gone after agreeing (the POST was made).
   - **Spec asserts:**
     - clicking or tabbing into the background does nothing while blocked;
     - after agreeing, the **drawer input is focused** and still holds its draft;
     - Save works.
   - `TermsUpdatePage.test.tsx` "then opens the portal" asserts the POST plus the dialog gone, not the `/p/ORG_A` navigation (which would now happen behind it mid-session).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Outside Review | in-host Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 13 findings, 3 high; all folded in |
| Eng Review | `/plan-eng-review` (condensed) | Architecture & tests | 1 | issues_open | overlay decided by Basel; boot path kept |

- **VERDICT:** ready to implement via /eng-build MUT-346.

NO UNRESOLVED DECISIONS
