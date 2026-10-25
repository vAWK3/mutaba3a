# MUT-370 — Suggest a passkey after the first sign-in (portal half)

Ticket: MUT-370 (epic MUT-322). Design source: `.claude/designs/mut-331-self-service-signup.md` §9 (Q3) and story S6; ADR-159 decision 9.
Blocked by MUT-115 (web half merged 052662ef, In Review) and MUT-368 (merged 305cbe56, In Review): both on local main, so the portal half can be built.
Scope here: **server + portal**. The phone half (Flutter) is built in the run's phone phase and consumes the same `/v1/me` field and route (§8).

## 1. Problem and acceptance criteria

Basel decided (MUT-331 Q3) that a password is required and a passkey is optional but **actively suggested as the more secure way**. MUT-115 shipped passkeys; nothing yet suggests one.

- AC1. The first sign-in after signup shows the card: "Add a passkey: the more secure way to sign in. Your password still works." with **Add a passkey** and **Not now**.
- AC2. Not now hides it for 30 days. After three offers, or once a passkey exists, it never shows again. Never on a device/host that can't create one (`passkeySupport()`).
- AC3. Adding from the card works, and the next sign-in can use it.
- AC4. Pilot and operator-issued accounts see it under the same rules.
- AC5. The card never collides with MUT-418's first-run trial step; the trial step comes first.
- AC6. en/ar, RTL at 375 px. Release-QA flows in `portal-selfservice`: shown after the first sign-in, Not now, added, never with a passkey.

## 2. Decisions (pending Basel's confirmation)

- **D1 — stored on the server, per person.** JSON `users.passkeyPrompt` `{ notNowCount, hiddenUntil }`, so the rules hold across the portal and the phone (the MUT-418 `users.trialPrompt` pattern). It is read and written through the **passkeys port** (`store.passkeys.promptOf` / `answerPrompt`), not `UserRecord`: the local-mode snapshot format does not change (local mode has no passkeys; MUT-115 keeps its maps outside the snapshot too), and the records export never carries it.
- **D2 — "a time" is one offer, not one page view.** The card stays on Home across visits until the person answers. Each **Not now** ends an offer and hides the card for 30 days; the third Not now retires it for good. Counting views was rejected: three reloads would spend every offer unseen. Two devices pressing Not now inside one offer count once (row lock; a Not now while already hidden changes nothing).
- **D3 — the server decides `due`.** `/v1/me` `user.passkeyPrompt = { due, notNowCount, hiddenUntil }`; `due` = no passkey, fewer than 3 Not nows, not hidden (server clock). Clients add only their device check and their own first-run order. One rule set for both clients, so the phone half writes no counting logic.
- **D4 — first-run order: the trial step first, then the card.** While MUT-418's trial step is due (`trialWelcomeDue`, unanswered), the card waits. Once the step is answered or closed, Home shows the trial banner and, under it, the passkey card. The card is a quiet Home card, never a second modal.
- **D5 — pilot and operator-issued accounts: same rules** (three offers), reading the ticket's "under the same rules". The design's "appears once" is read as "when MUT-115 ships". If Basel wants a single offer for them, it is a per-account starting count, a small change.
- **D6 — step-up goes to the drawer.** The card runs `addPasskeyFlow()` with no password (right after a sign-in it is under 10 minutes old). If the server asks for the password (`stepUp`, an older sign-in), the card opens You › Account › Passkeys (`?passkeys=true`), where MUT-115's password step already lives. No second password form on Home.
- **D7 — outcomes.** `added`: toast "Passkey added", invalidate `PASSKEYS_KEY` and Me (the server then says `due: false`, the card goes). `cancelled`: nothing. `failed`, `limit`: inline "Couldn't add the passkey. Try again." `unreachable`: the existing offline line. `wrongPassword` cannot happen without a password; it maps like `failed`.
- **D8 — no new analytics events.** A new `passkey_prompt_*` family would bump the analytics contract and the Flutter fixture; the server's `notNowCount` and the passkeys table already answer "did it work". Recorded as TD.
- **D9 — the server says `passkeyPrompt: null` where it has no passkeys.** `buildMe` reads a `passkeys` context flag (set in the API shell from `deps.webauthn`, the `billingGate` pattern); off on a server without `WEBAUTHN_RP_ID` and in the portal's local-mode backend, which then skips the read. Clients need no server-config knowledge. (Eng review E2; replaces "no server gate".)
- **D10 — Home only.** The card lives on the Owed overview (`OverviewPage`), under `TrialBanner`, where MUT-418's banner is. A person with no profile (`/you`) sees none.
- **D11 — removing every passkey brings the card back** if offers remain and it isn't hidden. "Never once a passkey exists" reads as the present tense.

## 3. Server

- Migration `20261025130000_mut370_passkey_prompt`: `ALTER TABLE "users" ADD COLUMN "passkeyPrompt" JSONB;` (additive, nullable). `schema.prisma` `User.passkeyPrompt Json?`.
- `server/src/auth/passkey-prompt.ts` (pure, no imports beyond types): `PASSKEY_PROMPT_MAX_OFFERS = 3`, `PASSKEY_PROMPT_HIDE_DAYS = 30`, `resolvePasskeyPrompt(stored)`, `applyPasskeyNotNow(stored, at)`, `passkeyPromptView(record, passkeyCount, now)`.
- `ports.ts`: `PasskeyPromptRecord { notNowCount; hiddenUntil }`; `PasskeyRepository.promptOf(userId) → { prompt, passkeys } | null`; `answerPrompt(userId, action: 'not-now', at) → same | null` (Prisma: `SELECT … FOR UPDATE` on the user row, like `updateTrialPrompt`). Memory: a map outside the snapshot.
- `store-guard.ts`: `promptOf: 'sessionOnly'`, `answerPrompt: { write: 'identity' }`.
- `/v1/me` (`buildMe`): reads `promptOf` alongside the existing parallel reads when the `passkeys` context flag is on (`app-shell.ts` sets it from `deps.webauthn`); `user.passkeyPrompt` (additive, nullable: null = no passkeys on this server). `MeSchema` + `PasskeyPromptSchema`.
- `PATCH /v1/me/passkey-prompt` `{ action: 'not-now' }` → `PasskeyPrompt`, in `routes/passkeys.ts` (E1: with the other passkey routes, 404 where passkeys are off; session + device session; organization-independent; `PERSON_LEVEL_GATE` open; refused while closing by the MUT-333 middleware). No audit row (a preference). No Idempotency-Key (idempotent by construction).
- `PasskeysDrawer`: adding or removing a passkey also invalidates Me (E3), so the Home card goes (or, D11, returns) without a reload.
- route-security lists, `portal-routes-coverage` (remote-only), `openapi.yaml`, `schema.d.ts`, API **1.70.0-mut370**.

## 4. Portal

- `src/hosted/data/passkeyPrompt.ts` (pure): `passkeySuggestionShows(me, { supported, local, now })` — supported, not local, ACTIVE, not closing, `passkeyPrompt.due`, not hidden (the optimistic write), and not `trialWelcomeDue(me, now)` (D4). `optimisticPasskeyPrompt(current, now)`.
- `src/hosted/data/passkeyPromptQueries.ts`: `useAnswerPasskeyPrompt()` — the `useAnswerTrialPrompt` shape (cancel Me refetches, optimistic write, server answer, invalidate Me).
- `src/hosted/components/PasskeySuggestion.tsx`: the card (`section.hp-banner.hp-banner-info.hp-passkey-suggest`, labelled). Title + note + two buttons (`Button` primary "Add a passkey", link-button "Not now"). Busy state while the ceremony runs. Outcomes per D6/D7.
- `OverviewPage.tsx`: `<PasskeySuggestion />` under `<TrialBanner />`.
- i18n `hosted.passkeys.suggest.{label,title,note,add,notNow}` en/ar; CSS in `hosted.css` (wraps at 480 px like the trial banner).
- `harness.tsx` Me fixture gains `passkeyPrompt` (not due).
- `qa.config.mjs`: the stubbed `portal` app's watch excludes the new card files (they are `portal-selfservice`'s, like MUT-115's).

Copy:
- en: title "Add a passkey: the more secure way to sign in." note "Your password still works." buttons "Add a passkey", "Not now".
- ar: title "أضف مفتاح مرور: الطريقة الأكثر أمانًا لتسجيل الدخول." note "وتبقى كلمة المرور صالحة." buttons "إضافة مفتاح مرور", "ليس الآن".

## 5. Tests (TDD)

- Server unit `auth/__tests__/passkey-prompt.test.ts`: resolve tolerates null/garbage; Not now counts, hides 30 days, caps at 3, is a no-op while hidden; view: due/not due for a passkey, 3 Not nows, hidden, hide lapsed.
- Store contract `store-contract-passkeys.ts`: `promptOf` default + passkey count; `answerPrompt` persists, unknown user → null; Prisma: two concurrent Not nows count once.
- Routes (`routes-sessions.test.ts`): `/v1/me` carries `passkeyPrompt` (due for a new person; not due once a passkey exists); PATCH returns the stored view and hides; 422 on a bad action; device session works; closing account refused. route-security + portal-routes-coverage lists.
- Portal unit `data/__tests__/passkeyPrompt.test.ts`; component `components/__tests__/PasskeySuggestion.test.tsx`: renders when due; hidden when unsupported, local, not due, trial step due; Not now (optimistic + PATCH); added (toast, Me + passkeys invalidated); cancelled (nothing); stepUp opens `?passkeys=true`; failed shows the inline error; en/ar.
- Commands: `npm run test:run`, `npm --prefix server test`, `npm --prefix server run test:db` (isolated DB).

## 6. QA scenarios (release-QA, `portal-selfservice`, area `passkeys`)

| id | Steps (as the person says them) | Promise |
|---|---|---|
| `suggest-first-sign-in` | Sign up, set a password, land on Home | The card shows: "Add a passkey: the more secure way to sign in. Your password still works." with Add a passkey and Not now |
| `suggest-not-now` | Press Not now; reload; 30 days later (DB clock) it is back; the third Not now | Gone after Not now and after a reload; back after 30 days; never after the third |
| `suggest-add` | On Home press Add a passkey; the device confirms; sign out; Sign in with a passkey | "Passkey added", the card is gone, and the passkey signs in |
| `suggest-has-passkey` | Add a passkey from You › Account › Passkeys; go Home; sign out and in again | No card, then or later |
| `suggest-375-ar` | Sign in in Arabic on a 375 px phone | The card reads right to left and fits, nothing scrolls sideways |

The ordering with MUT-418's trial step (D4) needs Stripe's sandbox (portal-live); it is unit-tested here and noted as a gap rather than a new live spec.

## 7. Impact, cost, risk

- One extra indexed read per `/v1/me` (user's `passkeyPrompt` + a passkey count, one query). One PATCH per Not now. No third-party calls.
- No local-format change, no records-export change, no purge change (the column dies with the user row).
- Additive API (minor bump). Old clients ignore the field.

## 8. The phone half (built later)

Read `GET /v1/me` → `user.passkeyPrompt.due`. Show the sheet only when `due` is true, the platform can create a passkey, and after MUT-407's `/welcome` step (and the trial step, when the phone gets one). **Add a passkey** → MUT-115's add flow (`POST /v1/passkeys/creation-options` → platform registration → `POST /v1/passkeys`), then refetch `/v1/me`. **Not now** → `PATCH /v1/me/passkey-prompt {"action":"not-now"}` (returns `{due:false, notNowCount, hiddenUntil}`). Copy as §4.

## 9. Business / product impact

- Every new self-serve account is nudged to the phishing-resistant sign-in at the moment it is most likely to say yes, without forcing it (Q3).
- Last portal piece of MUT-331's signup stories before the phone phase (MUT-371, MUT-364).
- Low risk: additive field and route, dismissible card, capped at three offers.

## 10. Eng review (2026-10-25, /plan-eng-review, unattended: recommended options taken, pending Basel)

Scope challenge: scope accepted as-is (one field, one route, one card; reuses MUT-115's `addPasskeyFlow` and MUT-418's prompt pattern). Nothing to cut.

**1. Architecture**
- [P2] (confidence 8/10) `server/src/routes/me.ts:54` `buildMe(store, user, terms, billingAt, billingGate = false)` is shared by the local-mode backend (`portal-routes.ts:65`), which has no WebAuthn. Without a gate `/v1/me` would say `due: true` everywhere, and the phone would need to know the server config. **E2 accepted:** a `passkeys` context flag (the `billingGate` pattern, `app-shell.ts:46`), `passkeyPrompt: null` when off (D9 revised).
- [P3] (confidence 7/10) the route belongs with the other passkey routes (`routes/passkeys.ts`, `NOT_CONFIGURED` 404), not with trial-prompt in `sessions.ts`. **E1 accepted.**
- Guard: `promptOf` is `sessionOnly`, like `organizations.countOwnedBy` that `buildMe` already calls (store-guard.ts:46), so session, device session and the local backend all pass. Verified by reading.
- Failure: the PATCH fails offline → the optimistic hide holds for the visit, the next `/v1/me` tells the truth (MUT-418's accepted behavior). Two devices → counted once under the row lock.

**2. Code quality**
- [P2] (confidence 9/10) `src/hosted/components/PasskeysDrawer.tsx` `case 'added':` invalidates only `PASSKEYS_KEY`; with the card on Home, a passkey added in the drawer (including after D6's step-up hand-off) would leave the card showing until Me refetches. **E3 accepted:** the drawer's add and remove invalidate Me too.
- No shared-code extraction: `useAnswerPasskeyPrompt` mirrors `useAnswerTrialPrompt` (two callers, different payloads and optimistic rules); a generic "answer a prompt" hook would be an option-heavy helper. Rejected.

**3. Tests** — the plan's §5 list, plus: drawer add/remove invalidates Me; `/v1/me` says `passkeyPrompt: null` with the flag off; PATCH 404 with passkeys off; Prisma concurrent Not now counts once. Gap accepted: the trial-step ordering (D4) is unit-tested only (its live path needs the Stripe sandbox).

**4. Performance** — one extra query per `/v1/me` (`users` by PK + `passkeys` count on `@@index([userId])`), skipped where passkeys are off. One PATCH per Not now. No issues.

Outside voice: skipped (unattended run, no second model available).
Failure modes: 0 critical gaps.

## 11. Build record (2026-10-25)

- Built as planned. `buildMe` takes `passkeysAt` (`passkeysClockOf(c)`), the request clock where passkeys are on.
- Code review fixes: a Not now while the person holds a passkey spends nothing (a stale card in another tab); a refused Not now keeps the optimistic hide for the visit (no refetch on failure); after `added` the card is done at once (no second ceremony on a slow refetch); Add and Not now guard each other; the closing-account rule lives in `passkeyPromptView`; `PasskeyPromptSchema` takes its maximum from `PASSKEY_PROMPT_MAX_OFFERS`.
- Not taken from review: carrying `passkeyPrompt` on `UserRecord` to save the row read (D1 keeps it off the record so the local snapshot and the records export don't change; one indexed read per `/v1/me`).
- The D4 order is proven live after all: the `portal-selfservice` app's signups get a trial (the honest "open soon" step), so `suggest-first-sign-in` records the trial step first, then the card.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | none | Independent 2nd opinion | 0 | skipped (unattended) | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (all accepted into the plan) | 3 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** none; skipped in an unattended run.
- **VERDICT:** ENG reviewed, findings E1–E3 folded into the plan; ready to implement. D1–D11 pending Basel's confirmation.

NO UNRESOLVED DECISIONS
