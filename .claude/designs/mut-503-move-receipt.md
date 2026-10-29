# MUT-503 — Move a To-review receipt to another profile (plan)

Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog → In Progress at build → In Review after qa-reconcile.
Epic MUT-252 (In Progress). No blockers. Neighbours: MUT-389 (file onto existing, In Review — same lock helpers), MUT-429 (portal file-to-existing, Backlog), MUT-430 (portal delete, Backlog), MUT-441 (server reader, In Review, ships dark), MUT-397 (cap race), MUT-373 (co-owners, Done).
Repos: mini-crm (server + portal), mutaba3a-flutter (phone). One branch each: `feature/mut-503-move-receipt`.

## Facts from the code that shape the plan
- Profile = `Organization`; `ExpenseReceipt.organizationId` owns the row (schema.prisma:1372). No child tables; OCR state is columns.
- `storageKey = org/{orgId}/expense-receipts/{id}` (attachments/rules.ts:49). Profile purge wipes `org/{id}/` (accounts/purge-run.ts:163) → the object **must** be relocated, not just the row.
- `AttachmentStorage` has no copy (storage.ts:31). Implementers: GCS, Memory, dev Local disk, browser `src/hosted/local/attachments.ts`.
- Reader claims by id and reads `claim.record.storageKey` (reader.ts:140); `finishRead` FAILED/SKIPPED branch has no version guard (prisma.ts:2300). Deleting the old object under an in-flight read → terminal `missing` → FAILED. Grant follows the uploader (`holdsGrant`), not the profile, so a move doesn't change who may read.
- `approved` JSON survives an unlink (prisma.ts:1996) and carries the source profile's `categoryId`.
- Idempotency claim is keyed on the header profile (idempotency.ts:170) = source A. Fine: retries are sent with the same header.
- Pending cap (20/24h) counts PENDING_UPLOAD only; only READY receipts may move, so B's cap never applies. Roles don't gate expense writes; "can't write B" means: not a member (404), Malafat `writeRefusal` (403 READ_ONLY_PROFILE), or lapse (402).

## Server (mini-crm/server)
1. **Storage `copy(from, to)`** on `AttachmentStorage` + all 4 implementers. GCS: `bucket.file(from).copy(bucket.file(to))` — a server-side rewrite; destination picks up the bucket default CMEK key (verify in build; pass `kmsKeyName` only if not inherited). Never downloads bytes.
2. **Repo `expenseReceipts.moveToProfile(sourceOrgId, receiptId, targetOrgId, newKey, now)`** in ports.ts + prisma.ts + memory.ts + `STORE_ACCESS` classification. One tx: `lockToReviewReceipt(tx, A, id)` (not_found / already_filed / not_ready) → `updateMany where {id, organizationId:A, TO_REVIEW, READY, deletedAt:null}` set `organizationId:B, storageKey:newKey, approved:null, approvedAt:null, approvedByUserId:null, readLeaseUntil:null (if PENDING), version+1`. Keeps id, `receivedOn`, `suggested`, `readStatus`, uploader. Audit rows for A and B written in the same tx.
3. **Compose `moveLibraryReceipt`** in `expenses/receipts-compose.ts`: authorize B → `head(oldKey)` → `copy(oldKey, newKey)` → repo tx → after commit: `remove(oldKey)` (log on failure; purge of A sweeps it) and, if `readStatus==='PENDING'`, `reader.requested(id)` to re-enqueue. If the tx refuses, `remove(newKey)` best-effort. Row is only ever on A or on B; worst case an orphan object, never a lost receipt.
4. **Reader guard:** the worker passes the key it read to `finishRead`; every branch adds `storageKey: claimedKey` to its WHERE. Count 0 and key changed → `releaseRead` and return `moved` (the move already re-enqueued). New `ReadJobStatus 'moved'`. This is what makes "reading finishes on B, never lost" true.
5. **Target authorization helper** `targetProfileWriteGate(store, user, targetId, now, enforced)` in `auth/billing-gate.ts`, generalizing `agentWriteGate`: membership (404 `PROFILE_NOT_FOUND`), `writeRefusal(expenses)` (403), lapse (402 `SUBSCRIPTION_LAPSED`). Source A is already gated by `authenticate` + `requireScope('expenses:write')` + `gateSelectedProfile`.
6. **Route** `POST /v1/receipts/{receiptId}/move` in `routes/receipts.ts`, `SESSION_ONLY`, `idempotent(store,'receipts.move')`, body `{ profileId: uuid }`. Answers 200 `{ receipt, fromProfileId }`; 409 `RECEIPT_ALREADY_FILED` (reuse `alreadyFiled`), 409 `RECEIPT_NOT_READY`, 422 `SAME_PROFILE`, 404/403/402 as above. Schemas in `schemas.ts`; `openapi:generate`; `API_VERSION 1.91.0-mut503`.
7. **Audit:** `expense_receipt.moved_out` on A `{toProfileId}` and `expense_receipt.moved_in` on B `{fromProfileId}` — the ticket's `receipt.*` names, matched to the existing `expense_receipt.*` family (note back on ticket).
8. **No local-mode work:** receipt routes aren't mounted signed-out; the browser storage only gets a trivial `copy` to satisfy the interface.

## Portal (src/hosted)
- `api/client.ts`: `moveReceipt(profileId, id, targetId, idempotencyKey)`; `npm run hosted:types`.
- `data/receiptQueries.ts`: `useMoveReceipt` (key via `useAttemptKey`), on success `invalidateReceipts` for A **and** B, drop `receiptKey(A,id)`.
- `components/MoveReceiptDrawer.tsx` (drawer-first): `RadioCards` of `me.profiles` minus A, each disabled with a reason when `billingGateOf` isn't open or `useWritableFor` refuses (shown, not hidden, so the person understands why). Errors in the drawer banner per DESIGN.md.
- Entry points: `ReceiptReview.tsx` (secondary "Move to profile…" beside Approve, only when To review + READY + `useWriteGate` open), and a `⋯` menu on To-review `ReceiptCard`s — extract the inline menu in `ExpenseGroupDetail.tsx:471` into `components/MoreActionsMenu.tsx` and reuse (registry entry). Card stays a link; menu button sits outside the link.
- After success: leave A's review page for `nextReceiptId` (or the gallery) and show `useToast` info "Moved to {B}" with action "Open" → `/p/B/expenses/receipts/{id}`.
- i18n ar+en: `hosted.receipts.move.*` (title, action, reasons: read-only, locked, no-access; outcome; errors).

## Phone (mutaba3a-flutter/mutaba3a)
- `ReceiptsLibraryRepository.move(...)` (hand-written Dio, `Result<…, ApiError>`), via `ActionKeys.run(['receipts.move', A, id, B], …)`.
- Profile-only mode on `showTargetPicker` (`target_picker_sheet.dart`): excludes current, disables rows where `!billingGateOf(me,p).allowsWrites` or `access['expenses'] != 'read-write'`, with the italic reason. (No new sheet.)
- Entry points: viewer AppBar `actions:` "Move to profile…" when `receipt.toReview`; long-press / trailing ⋯ on To-review rows in `receipts_tab.dart`.
- After success: `controller.drop(id)` on A, invalidate B's `receiptsControllerProvider` families, drop A's `ReceiptOriginalCache` entry, SnackBar "Moved to {B}" with "Open" (sets `receiptsProfileIdProvider` to B).
- arb en+ar keys `receiptsMove*` with `@` descriptions naming MUT-503; `make gen-l10n`.

## Tests (written first)
- Server memory-store unit (`server/test/receipts-move.test.ts`): moves A→B keeping id/date/suggestion/readStatus and clearing `approved`; A's list+counts drop, B's rise; FILED → 409; PENDING_UPLOAD → 409; same profile → 422; non-member B → 404; Malafat-refused → 403; lapsed B → 402 (gate enforced); same Idempotency-Key twice → one move, one pair of audit rows; copy fails → stays on A, nothing copied; tx refuses → new object removed; old-object remove fails → still 200; storage copy/remove calls asserted on Memory storage.
- Reader unit: move during an in-flight read → old worker's finish returns `moved`, re-queued read lands on B; DONE written by old worker never overwrites after a move.
- `test:db` (Postgres): concurrent move + approve on the same receipt → exactly one wins; move + move to two targets → one wins.
- Portal Vitest: drawer lists only other profiles, disabled reasons, submit sends key, invalidates both, toast with Open.
- Flutter: repository test (headers, key reuse on 5xx), picker profile-only mode widget test, receipts_tab row action.
- Commands: `npm --prefix server test`, `server typecheck/lint/openapi:check`; root `lint`, `typecheck`, `test:run`, `build` — all through `heavy`, Node 22. Flutter `make analyze`, `make test`.

## Release-QA
- `qa/features/portal/receipts.yaml`: `move` (A→B appears on B), `move-refused` (read-only/locked B disabled with reason), `filed-no-move`; specs in `qa/specs/portal/receipts.spec.ts` with a `move` handler in `qa/support/portalApi.ts` FakeApi. Optional live `portal-selfservice` spec once dev storage has `copy`.
- Flutter `qa/features/ios/receipts.yaml`: same three ids; flows `integration_test/qa/receipts_move*_test.dart` using `qaDisposableBusinessProfile`, `uploadLibraryReceipt`, billing QA read-only account. Runs on "Mutaba3a QA" via `release-qa … --wait`.

## Knowledge files
ADR-228 (move = copy object + re-home row in one tx, keep id, clear `approved`, reader key-guard), CHANGELOG, SYSTEM_OVERVIEW (receipts), COMPONENT_REGISTRY (`MoreActionsMenu`, `MoveReceiptDrawer`), TEST_PLAN, TD if the GCS CMEK copy needs an explicit key. Flutter: brief `.claude/designs/mut-503-move-receipt.md` with QA scenarios.

## QA scenarios (release-qa)
Portal (`qa/features/portal/receipts.yaml`):
- **move** — "On Receipts › To review, open a card's ⋯, choose Move to profile…, pick another profile and press Move to <name>." → the card leaves this profile's To review and the count drops; a toast says "Moved to <name>" with Open; Open shows the receipt on the other profile.
- **move-refused** — "Open Move on a receipt when another profile is read-only." → that profile is listed but can't be chosen, with its reason; when every other profile is locked, a note says no other profile can take it.
- **filed-no-move** — "Open a Filed receipt, and look at a Filed card." → no Move action on either.
- **move-review** — "On a receipt's review page, press Move to profile… beside the title and move it." → the page goes on to the next receipt to review, and the toast names the other profile.

Phone (`qa/features/ios/receipts.yaml`, mutaba3a-flutter):
- **move** — "Long-press a To-review receipt, choose Move to profile…, pick another profile, press Move to <name>." → the row leaves; a SnackBar says where it went with Open.
- **move-refused** — "Open Move when another profile is read-only." → that profile is disabled with its reason.
- **filed-no-move** — "Open a Filed receipt's viewer." → no ⋯ Move action.

---
# Eng review (plan-eng-review, 2026-10-29) — target: this file

## Scope Challenge
Complexity: ~22 changed files across 2 repos, 3 new units (`MoveReceiptDrawer`, `MoreActionsMenu`, compose `moveLibraryReceipt`) → complexity gate trips. One Story across server/portal/phone was Basel's call on 2026-10-29 (memory: receipt-scanning-epic-mut-252). Two branches (mini-crm, flutter); phone depends on the server route being merged.

REALITY: premise-table pass 11 premises, unverified=1 (GCS copy inherits bucket CMEK: main.tf:1069 sets default_kms_key_name; copy behaviour itself unverified until build) server/infrastructure/terraform/main.tf:1069
REALITY: already-done pass no MUT-503 commits on origin/main or any branch (git log --all --grep MUT-503) -
REALITY: surface-check pass routes/helpers named exist: routes/receipts.ts:312 /file, prisma.ts:3223 lockToReviewReceipt, billing-gate.ts:56 agentWriteGate, storage.ts:31 interface server/src/routes/receipts.ts:312
REALITY: binding-decisions pass ADR-167 (receipt belongs to its profile), ADR-181 (lapse at the door), ADR-220 (server reads); MUT-116 inbox stays closed .claude/DECISIONS.md
REALITY: numbers pass 20 pending/24h [measured: receipts-compose.ts:20]; file counts [estimated] server/src/expenses/receipts-compose.ts:20
REALITY: deferred-asks finding ticket's "B's pending cap" AC is vacuous (only READY moves; cap counts PENDING_UPLOAD); ticket's 403 for read-only maps to 402 (lapse) or 403 (Malafat writeRefusal) — note on ticket server/src/expenses/receipts-compose.ts:93
REALITY: pr-count pass 2 branches (mini-crm, flutter), phone lands after server -

## Findings
1. [CRITICAL] (confidence: 9/10) server/src/receipts/reading/reader.ts:140 + prisma.ts:2302 — the worker reads `claim.record.storageKey` and the FAILED/SKIPPED `finishRead` branch is `where: live` with no version guard. A move that deletes the old object under an in-flight read ends FAILED `missing` (terminal) and the reading is lost; breaks AC "never lost". → R1.
2. [CRITICAL] (confidence: 9/10) server/src/accounts/purge-run.ts:163 — purge removes `org/{id}/`; a row moved without relocating its object loses its file when A is deleted. Plan already relocates (copy to `org/B/...`). Accepted as common work.
3. [INFORMATIONAL] (confidence: 8/10) server/src/repositories/prisma.ts:1997 — unlink back to TO_REVIEW keeps `approved`/`approvedAt`/`approvedByUserId`; `approved.categoryId` is A's category, meaningless on B. → R2.
4. [INFORMATIONAL] (confidence: 8/10) ticket audit names `receipt.moved_out/in` vs codebase family `expense_receipt.*` (receipts-compose.ts:57 receiptAudit). → R3.
5. [INFORMATIONAL] (confidence: 8/10) src/hosted/pages/views/ExpenseGroupDetail.tsx:472 — the only `⋯` menu is inline; the card menu needs a menu. → R4.
6. [INFORMATIONAL] (confidence: 7/10) idempotency.ts:170 — key claimed on header profile A; a retry is replayed only if sent with the same header. Clients send A; the phone must not switch `receiptsProfileIdProvider` before the call settles. Common work (test).
7. [INFORMATIONAL] (confidence: 7/10) Concurrency: copy runs before the row lock; two concurrent moves both copy, one tx wins, loser removes its copy. Covered by plan step 3 + test:db.

## Decision ledger
### R1: in-flight read during a move
State: approved
Actual answer: D6 = A (reopened after outside voice O2): keep the lease on move; DONE path unchanged (lands by id, version re-merge); only FAILED/SKIPPED saves guard on storageKey; `missing` with a changed storageKey = retry (releaseRead), not terminal; vendor lookup re-reads the row's organizationId.
Accepted scope: as stated
History: D1 = A (clear lease + re-enqueue + guard every save). Reopened: double OCR, 3-try exhaustion, discarded DONE (outside voice O2, verified reader.ts:11-18).
### R2: stale `approved` on move
Options: A) clear approved/approvedAt/approvedByUserId on move (recommended) · B) keep as-is.
State: approved
Actual answer: A (D2): clear approved/approvedAt/approvedByUserId on move
Accepted scope: as option A
### R3: audit action names
Options: A) `expense_receipt.moved_out` / `expense_receipt.moved_in` (recommended) · B) ticket's `receipt.moved_out` / `receipt.moved_in`.
State: approved
Actual answer: A (D3): expense_receipt.moved_out / expense_receipt.moved_in
Accepted scope: as option A
### R4: card menu
Options: A) extract `MoreActionsMenu` from ExpenseGroupDetail and use it on cards (recommended) · B) inline menu on ReceiptCard · C) review page only, no card menu (cuts an AC item).
State: approved
Actual answer: A (D4): extract MoreActionsMenu, use on group page + To-review cards
Accepted scope: as option A

### R5: copy key per move (outside voice O1)
State: approved
Actual answer: D5 = A: copy to `org/B/expense-receipts/{id}-{nonce}`; cleanup removes a key only after re-reading the row and confirming it doesn't point there; test:db concurrent moves keep the file.
### R6: lapsed source profile
State: approved
Actual answer: D7 = A: gate A as today (ADR-181); a lapsed A refuses the move with 402.
### R7: retry after an unclear failure (outside voice O4)
State: approved
Actual answer: D8 = A: post-commit steps never throw (log only); portal and phone treat 404 / 409 OPERATION_IN_PROGRESS on a retry as refetch A+B and show the outcome.
### Corrections (no behaviour choice)
- O3: the 403 path can't fire: `expenses` is session read-write and not in PROFILE_DEPENDENT_DOMAINS (writability.ts:49,102). Target gate = membership (404) + lapse (402). Drop writeRefusal, the 403 test, and the portal/phone "read-only access" reason. Ticket note: read-only 403 → 402.
- O5: audit after commit via `receiptAudit` (two calls, organizationId A then B), matching routes/receipts.ts:71; not inside the repo tx.
- O8: `head(oldKey)` null → 409 `RECEIPT_FILE_MISSING`, receipt untouched.
- O9 (scope) noted: if the schedule slips, drop the card menus first (R4 stays approved).

Approval readiness: PASS (R1–R7; answers D2–D8, R1 via D6)

## Revised server flow (authoritative, supersedes steps 2–5 above)
```
POST /v1/receipts/{id}/move  {profileId:B}   header X-Mutaba3a-Profile: A, Idempotency-Key
  authenticate(A) → requireScope(expenses:write) → gateSelectedProfile(A) [402]
  idempotent('receipts.move')  (claim keyed on A)
  B == A ─────────────────────────────→ 422 SAME_PROFILE
  memberships.find(user,B) null ──────→ 404 PROFILE_NOT_FOUND
  agentWriteGate(B) ──────────────────→ 402 SUBSCRIPTION_LAPSED
  get(A,id): none→404 · FILED→409 RECEIPT_ALREADY_FILED · PENDING_UPLOAD→409 RECEIPT_NOT_READY
  head(oldKey) null ──────────────────→ 409 RECEIPT_FILE_MISSING
  newKey = org/B/expense-receipts/{id}-{nonce}
  storage.copy(oldKey,newKey)  (server-side rewrite, bucket CMEK)
  tx: lockToReviewReceipt(A,id) → update {organizationId:B, storageKey:newKey,
        approved:null, approvedAt:null, approvedByUserId:null, version+1}   (lease untouched)
      refused → after tx: remove(newKey) iff row.storageKey != newKey; map 404/409
  after commit (never throws): receiptAudit(A, moved_out) · receiptAudit(B, moved_in)
      · remove(oldKey) iff row.storageKey != oldKey · if readStatus PENDING and no live lease → reader.requested(id)
  200 { receipt, fromProfileId:A }

reader (in-flight claim on oldKey):
  read ok  → finishRead DONE by id+version → stale → re-merge onto moved row (unchanged)
  missing  → row.storageKey != claimedKey ? releaseRead (retry on new key) : FAILED
  FAILED/SKIPPED write guards storageKey = claimedKey
  vendor lookup uses current row.organizationId
```

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| copy | GCS error | 5xx, key released, row on A | error, retry works |
| tx | concurrent move/approve wins | loser removes its own nonce copy | 404/409 in drawer banner |
| post-commit remove(oldKey) | GCS error | logged; orphan swept by A purge / bucket soft-delete | success |
| post-commit crash | key stays claimed | retry → 409 in progress → client refetches A+B | outcome, not error (R7) |
| read in flight | old object gone | `missing`+key changed → retry on new key | reading arrives on B |
No critical gaps (every path has a test and a visible outcome).

## Test plan (required)
Server memory-store (`server/test/receipts-move.test.ts`): A→B keeps id/receivedOn/suggested/readStatus, clears approved, new nonce key, old key removed; counts on A/B; 422 same; 404 non-member; 402 lapsed B; 402 lapsed A (D7); 409 filed / not ready / file missing; same Idempotency-Key twice → one move, one audit pair; copy fails → untouched on A, nothing removed; tx refused → only own nonce copy removed; post-commit remove fails → still 200.
Reader (`server/test/receipt-reading.test.ts` extend): move during read → DONE re-merges on B; `missing` with changed key → released, not FAILED; move during 3rd attempt → not exhausted by the move; vendor from B.
test:db: two concurrent moves A→B → one wins, object at row.storageKey exists; move vs approve → one wins.
Portal Vitest: MoveReceiptDrawer lists other profiles, locked/read-only (lapse) disabled with reason, sends key, invalidates A+B, toast "Open"; retry 404/409 → refetch path; MoreActionsMenu keyboard/Escape/focus (+ ExpenseGroupDetail still works).
Flutter: repository move (headers, ActionKeys reuse on 5xx, 404/409 retry → refetch), picker profile-only mode, viewer action + row action.
Release-QA: portal `move`, `move-refused`, `filed-no-move`; ios same three ids.

## Worktree parallelization
| Step | Modules | Depends on |
|---|---|---|
| S1 storage copy + repo + reader guard + route | server/ | — |
| S2 portal drawer + menu + QA | src/hosted, qa/ | S1 (OpenAPI types) |
| S3 phone action + picker + QA | flutter lib/, integration_test | S1 deployed to local :8787 |
Lane A: S1 → S2 (mini-crm, one worktree). Lane B: S3 (flutter worktree) after S1 merges. Sequential in mini-crm; flutter in parallel with S2.

## Implementation Tasks
- [ ] **T1 (P1, human ~4h / CC ~30min)** — server — storage `copy` on 4 implementers + nonce key
  - Surfaced by: O1/R5 · Files: server/src/attachments/{storage,local-storage,rules}.ts, src/hosted/local/attachments.ts · Verify: `npm --prefix server test`
- [ ] **T2 (P1, human ~6h / CC ~45min)** — server — `moveToProfile` repo (ports/prisma/memory/store-guard) + compose + route + OpenAPI
  - Surfaced by: plan + R2/R6/R7/O3/O5/O8 · Files: server/src/repositories/*, expenses/receipts-compose.ts, routes/receipts.ts, schemas.ts, openapi/openapi.yaml · Verify: server test, typecheck, lint, openapi:check, test:db
- [ ] **T3 (P1, human ~3h / CC ~20min)** — server — reader `missing`-after-move retry, FAILED/SKIPPED key guard, vendor from current row
  - Surfaced by: R1/D6 · Files: server/src/receipts/reading/reader.ts, repositories/prisma.ts (finishRead) · Verify: receipt-reading tests
- [ ] **T4 (P1, human ~5h / CC ~40min)** — portal — client + useMoveReceipt + MoveReceiptDrawer + review-page action + MoreActionsMenu extract + card menu + i18n
  - Surfaced by: plan + R4/R7 · Verify: `heavy … npm run test:run`, lint, typecheck, build
- [ ] **T5 (P1, human ~5h / CC ~40min)** — phone — repo.move, picker profile-only, viewer + row actions, arb keys
  - Surfaced by: plan + R7 · Verify: make analyze, make test
- [ ] **T6 (P1, human ~4h / CC ~30min)** — QA — portal FakeApi move + 3 specs; ios 3 flows · Verify: release-qa run/release --only …, release-qa lint
- [ ] **T7 (P2)** — docs — ADR-228, CHANGELOG, SYSTEM_OVERVIEW, COMPONENT_REGISTRY, TEST_PLAN; Jira note (audit names, 403→402, cap AC vacuous)

## NOT in scope
Bulk move; moving Filed receipts; profile-less inbox (MUT-116); changing default upload profile; moving out of a lapsed profile (D7); signed-out local mode (no library there).

## What already exists
lockToReviewReceipt / markReceiptFiled pattern (prisma.ts:3223), idempotent() + IdempotencyHeaderSchema, agentWriteGate (billing-gate.ts:56), receiptAudit, invalidateReceipts, useAttemptKey, RadioCards, useToast action, ExpenseGroupDetail ⋯ popover (extracted), Flutter ActionKeys, showTargetPicker _ProfileStep, billingGateOf, ReceiptsController.drop.

## Suppressed findings
none

# Design review (plan-design-review + apple-design lens, 2026-10-29) — drawer and card menu

Mockup (interactive, ar/en, light/dark, portal desktop + 375px + phone): /Users/basel/.gstack/projects/vAWK3-mutaba3a/designs/mut-503-move-receipt-20261029/move-receipt.html
Step 0: 4/10 initial. DESIGN.md present (portal + phone). Focus: all 7 passes (D1).

## Design decision ledger
- DR1 (D2, A): "Move to profile…" is a secondary button at the inline end of the "Review receipt" heading row, away from Approve.
- DR2 (D3, A): no other profile at all → no Move action anywhere. Others exist but are all locked or read-only → the action shows, and the drawer lists them disabled with reasons under a `.hp-banner-warning` "No other profile can take it" + Billing link.
- DR3 (D4, A): choose, then confirm. The radio rows are followed by a footer primary "Move to <name>", disabled until a choice is made (busy while it saves, label kept). The phone sheet is the same, with a full-width 52pt FilledButton (a form-style choice, not a tap-and-done picker).
- DR4 (D5, A): the card fades and scales to 0.92 over 250ms `--ease-spring` (a 150ms fade under reduced motion), then the grid closes. Focus goes to the next card's link, or the page h1 if it was the last. `useToast` info "Moved to <name> · Open", polite. The review page goes to `nextReceiptId`, as Approve does. Phone: the row leaves the same way, then an action SnackBar with Open (`actionSnackBarPersists`).
- DR5 (D6, A): the card ⋯ is a 32px glass chip in a 44px hit area at the thumbnail's top end (chrome glass token, 1px soft shadow), always visible, To-review cards only, a sibling of the card link, mirrors in RTL. The popover is `.hp-popover` growing from the trigger's end (`hp-grow-from-end`).
- DR6 (user "go ahead with all recommendations"): the list uses `.hp-profile-row` rows inside a `RowGroup`-style box with `role="radiogroup"` / `role="radio"`. Not `RadioCards`, which can disable only one option. Rows show the avatar, the name (one line, ellipsis, `dir="auto"`) and a secondary line (Personal / Business / "Business · shared with X" / the disabled reason). The current profile is not listed. The phone reuses `_ProfileStep` rows with role dots and an italic reason.
- DR7 (same): accessibility.
  - The ⋯ has `aria-haspopup="menu"` and `aria-expanded`. The menu supports ↑/↓ and Home/End, and Escape returns focus to the ⋯.
  - The drawer focuses the first eligible row.
  - Disabled rows are `aria-disabled` but stay focusable, so their reason is read.
  - The outcome toast is announced. Targets are ≥44px.
  - A long name takes one line with an ellipsis, and the full name stays in the accessible name.
  - Phone: VoiceOver gets "Move to profile…" as a custom action on To-review rows (as the Recent lift does).
- DR8 (same): phone entry points are the To-review row long-press lift (reusing the `recent_lift.dart` pattern: 1.03× lift, blurred list, menu of Open / Move to profile…) and a ⋯ in the viewer AppBar. No trailing ⋯ on rows, matching Recent.
- DR9 (same): a receipt still being read shows a `.hp-banner-info` note in the drawer and sheet: "Still being read. The reading finishes on the profile you choose." The card's existing "Reading…" line stays.

## Interaction states
| Feature | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| Card ⋯ menu | n/a | hidden when no other profile (DR2) | n/a | opens menu | only on To-review cards |
| Move drawer/sheet | primary busy, label kept | all locked → warning note + disabled rows | `role="alert"` banner at the top of the body (402/404/409 copy), receipt stays | closes, card leaves, toast | reading note (DR9) |
| Review page Move | same drawer | hidden when solo | same | next receipt + toast | — |
| Retry after unclear failure | — | — | R7: refetch A+B, show outcome | — | — |

## Journey
| Step | User does | Feels | Plan specifies |
|---|---|---|---|
| 1 | spots a receipt on the wrong profile | mild annoyance | ⋯ visible on the card (DR5) / button by the title (DR1) |
| 2 | opens Move, sees their profiles | oriented | rows with type/shared cue, reasons for locked (DR6, DR2) |
| 3 | picks, reads "Move to Noor Design Studio" | sure | named primary (DR3) |
| 4 | sees the card leave and the toast | done, in control | motion + focus + Open (DR4) |

## Design Review Completion Summary
```
| System Audit         | DESIGN.md present (portal + phone); UI scope: portal drawer, card ⋯, review button, phone lift + sheet |
| Step 0               | 4/10; focus: all 7 passes |
| Pass 1  (Info Arch)  | 5/10 → 9/10 (DR1) |
| Pass 2  (States)     | 3/10 → 9/10 (DR2, DR9, state table) |
| Pass 3  (Journey)    | 4/10 → 9/10 (DR3, DR4) |
| Pass 4  (AI Slop)    | 7/10 → 9/10 (DR5); Operate mode, no hard rejections; cards are the interaction |
| Pass 5  (Design Sys) | 5/10 → 9/10 (DR6: hp-profile-row, hp-popover, banners, useToast) |
| Pass 6  (Responsive) | 5/10 → 9/10 (DR7; 375px drawer fills screen, 44px targets) |
| Pass 7  (Decisions)  | 9 resolved, 0 deferred |
| Approved Mockups     | 1 interactive HTML (hand-built; gstack designer has no OpenAI key) |
| Decisions made       | 9 |
| Overall design score | 3/10 → 9/10 |
```
Remaining below 10: the glass chip's contrast over very dark photos must be checked on real receipts in QA.

## Approved Mockups
| Screen | Path | Direction | Notes |
|---|---|---|---|
| Portal gallery, review, 375px, phone list/sheet/viewer | /Users/basel/.gstack/projects/vAWK3-mutaba3a/designs/mut-503-move-receipt-20261029/move-receipt.html | recommended toggles: Choose → Move, Over thumbnail | toggles show the rejected alternatives |

## Design implementation tasks
- [ ] **DT1 (P1)** portal: extract `MoreActionsMenu` (keyboard, Escape, focus return) + glass ⋯ on To-review `ReceiptCard` (sibling of the link) — DR5/DR7
- [ ] **DT2 (P1)** portal: `MoveReceiptDrawer` on `.hp-profile-row` radiogroup, named primary, banners (info/warning/error), URL key `?moveReceipt=<id>` mounted in `ProfileDrawers` (drawer-first) — DR2/DR3/DR6/DR9
- [ ] **DT3 (P1)** portal: review-page heading button; card leave motion + focus-next + toast — DR1/DR4
- [ ] **DT4 (P1)** phone: To-review lift menu (recent_lift pattern) + viewer ⋯ + move sheet with 52pt named button, VoiceOver custom action, SnackBar Open — DR3/DR4/DR7/DR8
- [ ] **DT5 (P2)** QA specs assert: no action when solo, disabled reasons, focus after move, `prefers-reduced-motion` fade

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 9 findings: 2 accepted as decisions (D5, D6), 1 product call (D7), 1 hardening (D8), 4 folded as corrections, 1 scope note |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 7 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 3/10 → 9/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex not installed; native Plan subagent completed within 5 min (in-host, not outside coverage).
- **VERDICT:** Eng review complete, all findings resolved into the plan (issues_open = mapped work). Design review CLEAR (drawer, card menu, review button, phone lift/sheet).

NO UNRESOLVED DECISIONS
