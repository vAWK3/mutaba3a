# MUT-155 — The hosted portal asks to share anonymous usage, then counts opens and saved money

Epic MUT-152, ADR-090, rules in `docs/analytics/README.md`, contract `docs/analytics/events.json`
1.1.0. Built in the epic worktree after MUT-154 and reusing its `src/lib/analytics`. Planned
2026-10-17. Eng decisions are auto-decided on the recommended option (§6), as Basel asked.

## 1. Design

```
HostedShell (authed)
  ├─ <UsagePrompt/>        top of <main>: one-time, inline, hp-banner-info + two equal buttons
  ├─ UserMenu              + "Share anonymous usage" menuitemcheckbox (the portal has no Settings page)
  └─ usePortalUsage(me)    on mount: owner check → start SDK if on → portal_opened (once per page load)

src/hosted/analytics/portalAnalytics.ts   (the only portal file that imports posthog-js)
  syncPortalUsage(userId) / choosePortalUsage(choice, prompt) / endPortalUsage() / trackPortal(event, props)
  record: localStorage "mutaba3a-portal-usage" = { owner: <user id>, choice: "on" | "off" }

IncomeCaptureDrawer  → trackPortal('income_recorded',  { currency, paid: kind === 'received' })  after the server confirms
RecordPaymentDrawer  → trackPortal('payment_recorded', { currency })                             after the settle succeeds
ExpenseDrawer        → trackPortal('expense_recorded', { currency })                             create only, not edit
endSession()         → endPortalUsage() on signed_out (this tab and other tabs)
server/src/app.ts    → PORTAL_CSP connect-src += https://eu.i.posthog.com
```

**Rules applied:**
- **No SDK before consent.** The SDK isn't initialised until the person turns sharing on (rule 4).
- **SDK setup** (`posthogInitOptions('portal')`):
  - `persistence: 'localStorage'`, never a cookie (rule 3);
  - `request_batching: false`, so every event leaves at once and the opt-out order holds (rule 5);
  - `person_profiles: 'never'`, every feature off, and the guard (rule 1: no URL, path, host or
    referrer).
- **Turning it on:**
  - first time in this page: init with a new ID;
  - again in the same page: `opt_in_capturing({ captureEventName: false })` after the earlier
    reset, so no `$opt_in` event (rule 7).
  - Either way, `analytics_opted_in { prompt }` follows.
- **Turning it off:** capture `analytics_opted_out` (sent immediately), then `reset(true)`, then
  `opt_out_capturing()` (as built: `reset()` clears posthog-js's consent, so opting out after it is
  what keeps the SDK silent), then remove every `ph_*` / `__ph_*` key. The record becomes `off`.
- **Sign-out or another account** (rule 6):
  - **Sign-out** (this tab or another): reset without sending anything, and clear the record and
    the keys.
  - **Expiry:** keeps the record. A person whose session expired and who signs back in is the same
    person.
  - **Owner check:** a different account signing in fails it, so everything is reset and the new
    person is asked.
- **Locale and version:** the locale comes from `<html lang>`; `APP_VERSION` comes from
  `src/lib/appVersion`.
- **The prompt** is never shown again to that person on that browser once they choose (or until
  they sign out).
- **Store links:** the account menu's "Get the app" links carry `mutaba3a-portal`.
- **Privacy policy (en + ar):**
  - the portal sentence goes into `usageAnalytics`;
  - the portal sentence goes into `network`;
  - the intro already names the portal (MUT-154).
- **Server:** `PORTAL_CSP` adds `https://eu.i.posthog.com` to `connect-src`, and the two pinned
  test strings are updated.

## 2. Tests (first)

- `src/hosted/analytics/__tests__/portalAnalytics.test.ts`:
  - no key → no-op;
  - no SDK before a choice; `on` → init with the portal config, then `analytics_opted_in`;
  - `off` → the order `analytics_opted_out` → `opt_out_capturing` → `reset(true)`, and the
    `ph_*` keys removed;
  - sign-out → reset, nothing captured, record cleared;
  - owner mismatch → reset and asked again;
  - `trackPortal` is a no-op unless on;
  - `portal_opened` once per page load;
  - on again after off → `opt_in_capturing` with no `$opt_in`.
- `UsagePrompt.test.tsx`: shows only with no choice; the two buttons record the choice and hide
  it; en/ar copy.
- `UserMenu` test: the checkbox reflects and changes the choice.
- The three drawer tests: the event and its properties after a confirmed save; nothing on a failed
  save; no expense event on edit.
- `endSession` test: `endPortalUsage` is called on `signed_out`, not on `expired`.
- `server/src/__tests__/portal.test.ts`: the CSP string.

## 3. Release-QA (`qa/features/portal/usage-analytics.yaml`, `qa/specs/portal/usage-analytics.spec.ts`)

API stubbed (as the other portal specs do), PostHog answered by the fixture:
1. `prompt-silent-until-chosen`: sign in. The prompt shows and no request goes to PostHog.
2. `opt-in-counts`: press "Share anonymous usage". `analytics_opted_in {prompt: first_run}`, then
   `portal_opened` on reload. No URL or path properties. No `ph_` cookie.
3. `save-income-counts`: opted in, add a received income. `income_recorded {currency, paid: true}`.
4. `opt-out-last-note`: turn it off in the account menu. One `analytics_opted_out`, then nothing
   on reload; the storage keys are gone.
5. `sign-out-resets`: opted in, sign out, sign back in. The prompt is shown again and nothing was
   sent at sign-out.

**As built (2026-10-17):**
- All 5 scenarios pass on a keyed preview build, plus `@portal.account.get-the-app` for the store
  links.
- The whole portal suite passes except the known preview-build failure `boot-slow-session`
  (TEST_PLAN).
- The spy answers every `*.posthog.com` host; `opt-in-counts` asserts that only event posts leave.

## 4. Out of scope

Conversions (not in the contract), the server sending events (MUT-156 closed), errors (Sentry).

## 5. Release note

The portal ships inside the API image. Analytics only work once a server release carries the new
CSP **and** `dist-hosted` is built with `MUTABA3A_POSTHOG_KEY`.

## 6. Auto-decided (for Basel)

| # | Decision | Why |
|---|----------|-----|
| B1 | The prompt is an inline notice at the top of the page, not a modal or floating card | No blocking dialog for consent; a floating card would sit on the toast's corner |
| B2 | Both buttons are the same visual weight (secondary) | Consent without nudging |
| B3 | The toggle is in the account menu (`menuitemcheckbox`) | The portal has no Settings page; the README already says "account menu" |
| B4 | Session expiry keeps the choice; sign-out and another account reset it | Expiry is the same person; rule 6 covers sign-out and account switch |
| B5 | The consent record stores the user id locally (never sent) to detect another account | The cheapest reliable account-switch check |
| B6 | Expense edits are not counted | The contract says "saved" for activation; an edit isn't a new record |
