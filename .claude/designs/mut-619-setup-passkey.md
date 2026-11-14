# MUT-619: offer a passkey on `/setup`, right after the password is set

Status: planned 2026-11-14 (eng-ticket), building on `feature/mut-619-setup-passkey`.
Epic MUT-322. Related: MUT-115 (passkeys), MUT-370 (Home suggestion, ADR-191), MUT-415 (passkey review after a
recovery), ADR-159 d9 (every account keeps a password). Sibling: MUT-618 (email sign-in code; owns `SignInPage.tsx` and
`server/src/auth/sign-in.ts`, which this ticket does not touch).

## Problem

People set a long, often browser-generated password on a computer, then have to type it on the phone. The first
passkey offer (MUT-370's Home card) only comes after a later sign-in. Basel (2026-11-14): offer a passkey during setup,
alongside the password, which stays required.

## Acceptance criteria (from the ticket)

1. After setting a password through a setup link on a browser that can create passkeys, the person sees the passkey
   step. Create a passkey registers one; the next sign-in on that device or a synced phone can use it.
2. Not now lands on Home and spends one MUT-370 offer; the Home card then follows MUT-370's 30-day and three-offer rules.
3. Browsers that can't create passkeys, and accounts that already hold one, never see the step. A recovery with existing
   passkeys still goes to the MUT-415 review.
4. A cancelled or failed ceremony never blocks setup.
5. Release-QA: the setup flows gain the passkey step and pass in en and ar (375 px RTL).

## Design

No server change. Everything the step needs already exists:

| Need | Existing piece |
|---|---|
| Is an offer due (no passkey, an offer left, not hidden, not closing) | `/v1/me` `user.passkeyPrompt.due`, returned by `POST /v1/sessions` (the `me` that `signIn()` already holds) |
| Can this device make one | `passkeySupport()` (`src/hosted/passkeys/webauthn.ts`), MUT-370's check |
| Create | `addPasskeyFlow()` (`src/hosted/passkeys/addPasskey.ts`), no password: the sign-in is seconds old |
| Not now spends an offer | `useAnswerPasskeyPrompt()` → `PATCH /v1/me/passkey-prompt {action:'not-now'}` → `applyPasskeyNotNow` |
| After adding | `passkeysChanged(queryClient)` (re-reads `/v1/me`, so the Home card is gone) |

### D1. One predicate for "may we offer a passkey here"

`src/hosted/data/passkeyPrompt.ts` gains `passkeyOfferable(me, { supported, local })`: supported, not local, the server
says due, no closure, `ownSignIn !== false` (MUT-596). `passkeySuggestionShows` becomes
`passkeyOfferable(...) && !trialWelcomeDue(...)`, unchanged in behaviour. The setup step uses `passkeyOfferable`
without the trial gate: the step comes on `/setup`, before Home and before the trial's first-run step.

### D2. Where the next screen is decided

`SetupForm.signIn()` today navigates at once. It now works out `next` (signup: `firstRunPath(me)`; otherwise Home, or
the MUT-415 review when `passkeysToReview()` says so) and:

- `passkeyOfferable(me, { supported: passkeySupport(), local: false })` → render the passkey step, which calls
  `onDone()` → `navigate(next)`.
- otherwise → `navigate(next)` as today.

Order: the offer is checked first. `due` is false whenever the account holds a passkey, so a recovery with passkeys
never sees the step and still reaches the review (AC3). `passkeysToReview` runs only when no offer is shown, so an
account with no passkeys costs no extra request.

### D3. The step: `src/hosted/pages/auth/SetupPasskeyStep.tsx`

In the same `AuthLayout` card as the form (no route of its own: a reload or Back must never show it again with no
session context; the URL stays `/setup`).

- Heading "Create a passkey"; lead "Your password is set. Create a passkey so you won't need to type it. It syncs to
  your phone through iCloud Keychain or Google Password Manager."
- Primary **Create a passkey**: `addPasskeyFlow()`.
  - `added` → `passkeysChanged`, toast "Passkey added" (the existing key), `onDone()`.
  - `cancelled` → note "No passkey was created. You can try again, or add one later in You › Account." Buttons stay.
  - anything else (`failed`, `unreachable`, `stepUp`, `operatorPasskeyFirst`, `limit`, `wrongPassword`) → note
    "Couldn't create a passkey. You can try again, or add one later in You › Account." Buttons stay.
- Secondary **Not now**: `answer.mutateAsync('not-now')`, awaited so Home never flashes the card, then `onDone()` even
  if the write fails (setup never gets stuck, AC4). The optimistic `/v1/me` write hides the card either way.
- Both buttons disabled while either is busy; focus moves to the heading when the step appears (screen readers).

The person always leaves with Create (success) or Not now. Cancelled → Not now spends an offer: that is the person's
answer, the same as on the Home card.

### D4. Analytics (opt-in, ADR-090; release-only, ADR-236)

`docs/analytics/events.json` 2.8.0 → 2.9.0, portal emitter, each with `link` (`setup` | `reset` | `signup`):
`setup_passkey_offered`, `setup_passkey_created`, `setup_passkey_not_now`, `setup_passkey_not_created` (`reason`:
`cancelled` | `offline` | `other`; the taxonomy bans "failed" in event names, errors go to Sentry). Sent through `trackPortal`, which
sends nothing unless the person turned usage sharing on, so counts from brand-new accounts will be near zero (the
first-run usage question comes later). Same caveat the trial prompt's events carry. `users.passkeyPrompt` holds every
Not now regardless.

### D5. Accountant invite (`/accountant-invite`): not in this ticket

The invite's new-account path also sets a password, then lands on `/client-books`. Leave it out here:

- Accountants work the client-books desk on a computer; the complaint is typing the password on a phone.
- Its QA runs on the stubbed API (`portal.accountant-invite`), which has no WebAuthn relying party; proving the step
  there needs a new live-API invite flow in `portal-selfservice`.
- `SetupPasskeyStep` takes only `onDone`, so the invite can adopt it in one follow-up with no refactor.

Queued for Basel as a follow-up decision, not a blocker.

## Files

- `src/hosted/data/passkeyPrompt.ts`: `passkeyOfferable` (D1).
- `src/hosted/pages/auth/SetupPasskeyStep.tsx` (new, D3).
- `src/hosted/pages/auth/SetupPage.tsx`: `signIn()` decides `next`, renders the step (D2).
- `src/hosted/analytics/portalAnalytics.ts`, `docs/analytics/events.json`: four events (D4).
- `src/hosted/i18n/en.json`, `ar.json`: `hosted.setup.passkey.*`.
- Styles: reuse `hp-card hp-signin-card`, `hp-setup-lead`, `btn` classes; no new CSS expected.
- QA: see below. Knowledge files: CHANGELOG, SYSTEM_OVERVIEW (setup section), TEST_PLAN.

## Tests (Vitest, written first)

`src/hosted/data/__tests__/passkeyPrompt.test.ts`
- `passkeyOfferable`: true when supported + due; false when unsupported, local, not due, null prompt, closing,
  `ownSignIn: false`; `passkeySuggestionShows` unchanged (existing tests stay green).

`src/hosted/pages/auth/__tests__/SetupPage.test.tsx` (mock `passkeySupport` and `createPasskey` from `passkeys/webauthn`)
- supported + due: after save, the step shows ("Create a passkey" heading), the URL is still `/setup`, Home not reached.
- Create → options + `POST /v1/passkeys` called; lands on Home; toast "Passkey added".
- Create cancelled → note shown, still on the step; Not now → `PATCH /v1/me/passkey-prompt {action:'not-now'}`, Home.
- Create failed (server 500 on add) → error note; Not now continues.
- Not now with the PATCH failing → still lands on Home.
- unsupported device → straight to Home, no step (existing tests already cover this path since Vitest has no RP ID).
- `due: false` with passkeys (RESET) → no step, MUT-415 review URL (`?passkeys=true&review=recovery`).
- SIGNUP purpose → after Not now, lands on `firstRunPath(me)`.
- analytics: offered on show, not_now / created / failed on each answer (with usage sharing on).

Command: `heavy --light -l "MUT-619 vitest" -- npx vitest run src/hosted/pages/auth src/hosted/data src/hosted/analytics scripts/__tests__/analytics-taxonomy.test.ts --maxWorkers=3`, then the repo's lint, typecheck, full `test:run` and build through the queue.

## QA scenarios (release-qa)

The step only appears where WebAuthn has a real relying party, which in QA is the `portal-selfservice` app (live API,
`WEBAUTHN_RP_ID=localhost`, Chromium's virtual authenticator). The stubbed `portal` app has no relying party, so
`portal.setup` is the "can't create a passkey" device.

New area `qa/features/portal-selfservice/setup.yaml` + `qa/specs/portal-selfservice/setup.spec.ts`:

| id | steps | expect |
|---|---|---|
| `passkey-create` (core) | Operator account; open its setup link, set a password; on the passkey step press Create a passkey; sign out; Sign in with a passkey | Step shows with both buttons; "Passkey added", Home with no suggestion card; the passkey signs in |
| `passkey-not-now` | Sign up, open the mail's link, set a password; Not now; answer the trial step | Home shows no suggestion card; `/v1/me` passkeyPrompt has notNowCount 1 and is hidden ~30 days |
| `passkey-cancelled` | Setup link, set a password; device away; Create a passkey; then Not now | Note "No passkey was created…", buttons stay; Not now lands on Home |
| `passkey-arabic-phone` | Arabic account at 375 px: setup link, set a password | "أنشئ مفتاح مرور" step right to left, no sideways scroll; Not now (ليس الآن) lands on Home |

Changed, directly affected (they set a password on `/setup` on the passkey host, so they now meet the step):
- `portal-selfservice.passkeys.suggest-first-sign-in`: signup now meets the setup step first; it presses Not now, and
  the expectation becomes "Home shows no card after the trial step" (not asked twice in a row). Its "card on Home"
  coverage stays in `suggest-not-now` / `suggest-add` / `suggest-arabic-phone` (operator accounts redeemed via API).
- `portal-selfservice.passkeys.review-after-recovery`: unchanged expectation; asserts no passkey step on the way.
- `portal-selfservice.recover.*` and `portal-selfservice.signup.*` flows that set a password in the UI: press Not now
  on the step (a helper in `qa/support/selfService.ts`).
- `portal.setup.set-password`: adds "no passkey step on a device that can't make one" (stubbed API, no RP).

Not re-run: everything else in `portal`, `portal-live`, `web` (no `/setup` path changes there; `portal-live` builds have
no `MUTABA3A_PASSKEY_RP_ID`, so `passkeySupport()` is false and its signup flow is unchanged; checked in build).

## Cost / scale

No new endpoints, tables or reads. One `PATCH` per Not now (already the Home card's), one options + one add per
Create. `passkeysToReview` now runs only when no offer is shown, which removes one `GET /v1/passkeys` for new accounts.
