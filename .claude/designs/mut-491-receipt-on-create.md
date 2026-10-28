# MUT-491 — Portal: attach a receipt while adding an expense (optional)

Status: plan, 2026-10-28. Parent epic MUT-252. Relates MUT-260, MUT-429. No blockers.
On the build branch, copy this to `.claude/designs/mut-491-receipt-on-create.md` (the design brief) and the test
section to `.claude/designs/mut-491-receipt-on-create-tests.md`.

## Problem

`ExpenseDrawer` renders `ReceiptUploader` only when `mode === 'edit' && existingExpense`
(`src/hosted/components/ExpenseDrawer.tsx:193`). The expense receipt routes
(`POST /v1/expenses/{id}/receipts` → PUT signed URL → `POST …/complete`) need an expense id, so a new expense has
nothing to attach to. People save, reopen, then upload, or skip the receipt.

## What exists (reuse, don't rebuild)

| Piece | Where | Use |
|---|---|---|
| File rules | `data/receiptFileRules.ts` `checkReceiptFile`, `RECEIPT_MIME_TYPES` | unchanged |
| Upload one file to an expense | `data/expenseQueries.ts` `useAddReceipt` (start → `putToSignedUrl` → complete) | extract its body into a plain function |
| Cleanup-on-failure shape | `data/receiptQueries.ts` `uploadLibraryReceipt` (delete on PUT failure; on complete only for 4xx) | mirror for expense receipts |
| Sequential multi-file, stop on 429 | `data/receiptQueries.ts` `useUploadReceipts` | same loop rule |
| Uploader UI + toasts + i18n | `components/ReceiptUploader.tsx`, `hosted.expenses.drawer.receipts.*` | extend with a queued mode |
| Local mode | `putToSignedUrl` handles `local-blob:`; expense receipt routes run in `src/hosted/local/` | nothing new |
| Server | 10 per expense (`MAX_RECEIPTS_PER_EXPENSE`), 30 starts/min per person (`RECEIPT_UPLOAD_POLICY`) | **no server change, no OpenAPI change** |

## Decisions

- **D1 Queue in the browser, upload after the expense exists.** Files are `File` objects in drawer state until Save. No
  To-review detour (that would leave orphans on Cancel and needs the library, which is off in local mode and behind
  `RECEIPTS_LIBRARY`). Record as the next free ADR at build time (ADR-220 is reserved by MUT-441).
- **D2 One shared upload function with cleanup.** New `uploadExpenseReceipt(profileId, expenseId, file)` in
  `expenseQueries.ts`: start → PUT → complete; on PUT failure delete the PENDING row; on complete failure delete only
  for a 4xx (a lost answer or a 5xx may have completed it). `useAddReceipt` calls it too. This also fixes a latent
  leak: today a failed PUT in edit mode leaves a PENDING row, and the server's start check counts every row, so
  orphans eat the 10-receipt room while the UI (READY only) says there is space.
- **D3 Several files, sequential, stop on 429.** `attachExpenseReceipts(profileId, expenseId, files)` returns
  `UploadOutcome[]` (the type from `receiptQueries.ts`), one file at a time, and marks the rest refused after a 429.
- **D4 `ReceiptUploader` gets a queued mode, not a second component** (>70% overlap: label, Add button, hidden input,
  file rules, toasts, cap). Props become a union:
  `{ expenseId, receipts }` (live, today) | `{ queued: File[], onQueue(files), onUnqueue(index) }` (create).
  Queued rows show the filename (`<bdi>`) and **Remove** (`common.remove`), no Download. The input takes `multiple`
  in queued mode only; live mode is unchanged. Cap: queued length ≤ 10 (export `MAX_READY_RECEIPTS`); picking past it
  queues up to the cap and shows `atCap`.
- **D5 Save flow in create mode.** Create the expense exactly as today (same idempotency key, `attempt.succeeded()`,
  `expense_recorded`). Then, if files are queued: the Save button reads "Attaching receipts…" and stays disabled,
  `attachExpenseReceipts` runs, then invalidate `expenseKey(profileId, id)` and the list.
  - All attached → `markSaved(id)`, close (today's path).
  - Any failed → `markSaved(id)`, a toast names the files ("The expense is saved. These receipts weren't attached:
    {names}. Add them again here."), and the drawer turns into the edit drawer for the new expense via a new
    `onCreated?: (expenseId) => void` prop. `ExpensesList` passes one that sets `?expense=<id>` and clears
    `newExpense`. The edit drawer's live `ReceiptUploader` shows what did attach and offers Add receipt to retry.
    The expense is never created twice: the retry path is edit mode, which never POSTs `/v1/expenses`.
  - Closing the drawer while receipts upload: the uploads keep running (the promise is not tied to render); a
    failure still toasts. No reopen in that case. Acceptable for v1, stated in the brief.
- **D6 Read-only** (lapse gate): queued mode renders nothing when `readOnly`, as live mode renders no Add.
- **D7 Out:** reading/prefilling from the receipt (MUT-441/301/304), phone parity, choosing a To-review receipt
  (MUT-429), changing analytics (`expense_recorded` keeps currency only, MUT-155).

## Files

| File | Change |
|---|---|
| `src/hosted/data/expenseQueries.ts` | add `uploadExpenseReceipt`, `attachExpenseReceipts`; `useAddReceipt` uses the first |
| `src/hosted/components/ReceiptUploader.tsx` | union props, queued mode, `multiple`, export `MAX_READY_RECEIPTS`; doc comment no longer "only once an expense exists" |
| `src/hosted/components/ExpenseDrawer.tsx` | `queued` state (create only), render queued uploader in create, attach after create, `onCreated` prop |
| `src/hosted/pages/views/ExpensesList.tsx` | pass `onCreated` → `setFilters({ ...filters, expense: id, newExpense: undefined })` |
| `src/hosted/i18n/en.json`, `ar.json` | `receipts.attaching`, `receipts.someFailed` (ICU plural on count, `{names}`); ar + en only |
| `qa/features/portal/expenses.yaml` | feature `create-with-receipt` |
| `qa/specs/portal/expenses.spec.ts` | spec `@portal.expenses.create-with-receipt` |
| `.claude/*` | CHANGELOG, COMPONENT_REGISTRY (ReceiptUploader no longer edit-only; new functions), DECISIONS (D1), TEST_PLAN, TECH_DEBT if the close-mid-upload gap is logged |

## Tests (TDD: written first)

Unit (`npx vitest run <file> --maxWorkers=3`, Node 22):
1. `data/__tests__/expenseQueries.test.ts` (new): `uploadExpenseReceipt` — happy path calls start, PUT, complete;
   PUT failure → `deleteReceipt` called, error rethrown; complete 4xx → delete; complete 5xx / network → no delete.
2. same file: `attachExpenseReceipts` — runs in order; one failure doesn't stop the next; a 429 marks the rest
   refused without calling start.
3. `components/__tests__/ReceiptUploader.test.tsx`: queued mode — bad type toasts and doesn't queue; two files in
   one pick queue both; Remove unqueues; 11th file not queued + atCap; readOnly renders nothing; live mode unchanged
   (existing tests stay green).
4. `components/__tests__/ExpenseDrawer.test.tsx`: create with no files → one POST, close (existing); create with two
   files → POST expense then two start/PUT/complete against the new id, close, markSaved; one upload fails →
   expense POSTed once, toast names the file, `onCreated(id)` called, drawer not closed; edit mode shows no queued
   control.
5. `pages/__tests__/ExpensesList.test.tsx`: `onCreated` moves the URL to `?expense=<id>`.
6. `local/__tests__/receipts.test.ts`: signed out, create an expense then attach a file through the same calls → the
   expense lists one READY receipt.

QA (`release-qa run --attach --only create-with-receipt`, vite started):
- `create-with-receipt` (tier secondary; paths: `ExpenseDrawer.tsx`, `ReceiptUploader.tsx`, `expenseQueries.ts`):
  Record expense → pick a text file (refused, nothing sent) → pick a PDF and a JPEG → remove the JPEG → Save →
  expect POST /v1/expenses then one start/PUT/complete on the new id, the row listed with "Saved", and reopening it
  shows the PDF under Receipts.

Final: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` through the heavy queue. No server
change, so server CI isn't needed (confirm `git diff --stat server/` is empty).

## Cost / scale

No new endpoints or queries. Per saved expense with n receipts: 1 + 3n requests, the same as attaching in edit mode
today, minus the extra GET that reopening costs. n ≤ 10, inside the 30/min budget.

## Acceptance criteria → proof

| AC | Proof |
|---|---|
| Optional field; saving without it unchanged | test 4 (no files), existing `create` QA |
| Bad files refused before upload, existing toasts | test 3, QA step 2 |
| After Save, receipts READY and downloadable | test 4, QA last step |
| Partial failure keeps expense, names file, retry in edit, no double create | tests 1, 2, 4, 5 |
| No 11th file | test 3 |
| Read-only hides it | test 3 |
| Arabic first, RTL, ar + en | i18n keys in both files, `<bdi>` filenames |
| Release-QA feature + passing spec | `create-with-receipt` |

---

# Eng review (/plan-eng-review, 2026-10-28)

Target: this plan (`~/.gstack/projects/vAWK3-mutaba3a/mut-491-plan.md`), reviewed against mini-crm main 57670968.
The plan above is kept unchanged; accepted changes are recorded below and in "Amendments".

## Scope Challenge findings

1. [INFORMATIONAL] (confidence: 9/10) plan D2: the "latent leak" rationale is wrong. `listByExpense` counts READY only
   (`server/src/repositories/prisma.ts:2176` `where: { organizationId, expenseId, status: 'READY', deletedAt: null }`),
   so an orphan PENDING row doesn't take a place among the 10. It does count toward the org-wide pending cap
   (`prisma.ts:2224` `countPendingSince … status: 'PENDING_UPLOAD'`) that gates To-review uploads (20 per 24 h).
   Cleanup stays justified on that ground. Factual correction, no question.
2. [INFORMATIONAL] (confidence: 9/10) plan i18n row: the portal has no ICU parser. Plurals are CLDR form objects read
   with `useTp` (`src/lib/i18n/plural.ts:6` "Plurals without an ICU parser (ADR-019…)"). Correction.
3. [INFORMATIONAL] (confidence: 9/10) plan D4: there is no `common.remove` key in `src/hosted/i18n/en.json`; add
   `hosted.expenses.drawer.receipts.remove`. Correction.
4. [INFORMATIONAL] (confidence: 8/10) plan D3: the session expense receipt start has no upload limiter
   (`server/src/app.ts:436` passes `uploadLimiter` to the receipts library routes only; `routes/expenses.ts:286`
   calls `startExpenseReceipt(receiptDeps, …)`), so "stop on 429" cannot fire on this path today. Correction: keep
   one failure per file; no 429 special case unless shared with the library loop (R1).
5. Complexity: 8 product files (expenseQueries, ReceiptUploader, ExpenseDrawer, ExpensesList, en.json, ar.json,
   expenses.yaml, expenses.spec.ts), 0 new classes/services. Gate trips at 8 files: structure question D2.

## Decision ledger

### R1: one upload-with-cleanup function for library and expense receipts
Finding: Code quality, INFORMATIONAL, 8/10, `src/hosted/data/receiptQueries.ts:112-133` (`uploadLibraryReceipt`) and
proposed `uploadExpenseReceipt` (plan D2), reviewer: main.
Plan baseline: plan D2, a second function mirroring `uploadLibraryReceipt` (copy of the cleanup rule).
Runtime evidence: `uploadLibraryReceipt` deletes the PENDING row on PUT failure and on complete only for a 4xx
(`receiptQueries.ts:118-131`); `useAddReceipt` (`expenseQueries.ts:160-176`) has no cleanup.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 cleanup rule location | one copy (library only) | one shared `uploadReceiptFile({ start, complete, remove }, file)` in receiptQueries.ts, both callers use it | two copies (plan D2) |
| R2 gallery refresh | pending | pending | pending |
Question D3: Share the upload-and-clean-up steps between the Receipts tab and the expense drawer?
Header: Upload helper
Options:
A) Share one helper (recommended)
One small function holds start → PUT → complete and the "delete only when the server said no" rule; uploadLibraryReceipt and the drawer both call it. ~25 lines moved, ~20 saved; existing receiptQueries tests cover it plus new expense cases. Human ~1h / CC ~10 min.
B) Two copies, as planned
uploadExpenseReceipt repeats the rule next to useAddReceipt. Simpler diff, but the subtle 4xx-only rule lives in two places and can drift.
State: approved
Actual answer: A) Share one helper (D3, 2026-10-28)
Accepted scope: `uploadReceiptFile({ start, complete, remove }, file)` in `src/hosted/data/receiptQueries.ts` holding start → PUT → complete with cleanup (delete on PUT failure; on complete only for a 4xx); `uploadLibraryReceipt` and the expense path (`uploadExpenseReceipt` in expenseQueries.ts, used by `useAddReceipt` and the create flow) both call it; tests: existing library cases stay green, new expense cases.
History: none

### R2: refresh the Receipts gallery after a drawer attach (create and edit)
Finding: Architecture, INFORMATIONAL, 8/10, `src/hosted/data/expenseQueries.ts:172-174` (`onSuccess` invalidates
`expenseKey` only) vs `src/hosted/data/filters.ts:205` (`RECEIPT_STATUSES = ['to_review', 'filed', 'all']`), reviewer: main.
Plan baseline: plan D5 invalidates `expenseKey` and the expense list.
Runtime evidence: the gallery's Filed and All tabs list filed receipts; nothing invalidates them after a drawer attach
(existing edit-mode gap too). The expense list shows no receipt column, so invalidating it is unneeded.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 gallery refresh | none (edit), plan: list only (create) | `invalidateReceipts` after every drawer attach, both modes; drop the list invalidation | as planned |
| R1 cleanup rule location | pending | pending | pending |
Question D4: Should receipts attached in the drawer show up at once in the Receipts tab's Filed list?
Header: Gallery refresh
Options:
A) Refresh it (recommended)
After each attach, both create and edit, refresh the Receipts tab's lists and counts (one existing helper call). Fixes today's edit-mode staleness too. Human ~15 min / CC ~2 min.
B) Leave as planned
Only the expense refreshes; the Filed tab catches up on its next refetch.
State: approved
Actual answer: A) Refresh it (D4, 2026-10-28)
Accepted scope: after every drawer attach (create and edit) call `invalidateReceipts(queryClient, profileId)` next to the `expenseKey` invalidation; drop the plan's expense-list invalidation; a test asserts the receipts lists are invalidated.
History: none

Scope record: feature answers: none proposed (D1 skipped /office-hours, 2026-10-28); structure: A) Original arrangement (D2, 2026-10-28); accepted scope: the plan's 8 product files; pending remedies: none (R1, R2 approved). Scope Challenge result: scope accepted as-is.

## Section 1: Architecture

```
ExpenseDrawer (create)                      expenseQueries / receiptQueries                server (or local app)
──────────────────────                      ───────────────────────────────                ─────────────────────
pick files ─▶ checkReceiptFile ─▶ queued[] (≤10, in state)
Save ─▶ createMutation (Idempotency-Key) ──────────────────────────────────────────────────▶ POST /v1/expenses
        │ error ─▶ applyExpenseApiError, queued[] kept, same key on retry
        ▼ created.id
   attaching=true ─▶ for each file: uploadExpenseReceipt ─▶ uploadReceiptFile(R1) ─────────▶ POST …/receipts
                                                        PUT signed URL / local-blob ──────▶ bucket | IndexedDB
                                                        complete ─────────────────────────▶ POST …/complete
                                                        fail: PUT → remove; complete 4xx → remove
   invalidate expenseKey + invalidateReceipts (R2)
   all ok ─▶ markSaved, onClose
   any failed ─▶ markSaved, toast(names) ─▶ [mounted?] onCreated(id) ─▶ ExpensesList ?expense=id ─▶ edit drawer
```

1. [INFORMATIONAL] (confidence: 8/10) plan D5 + `src/hosted/pages/views/ExpensesList.tsx:111`
   (`const closeDrawer = () => setFilters({ ...filters, expense: undefined, newExpense: undefined });`): if the person
   closes the drawer while receipts upload and one then fails, `onCreated(id)` would set `?expense=<id>` and reopen a
   drawer they closed. D5 already says "No reopen in that case", so the guard is required implementation: call
   `onCreated` only while the drawer is mounted (a ref set false on unmount), and test it. No question.

Production failure per new path: storage off or a 503 on start → every file fails → toast names them, edit drawer
opens, expense kept (visible, recoverable). A lost complete answer → no delete; the edit drawer shows it READY if it
completed, otherwise the PENDING row ages out of the 24-hour window. No silent failure.

Dispositions: 1 accepted (required by approved D5).

## Section 2: Code quality

1. [INFORMATIONAL] (confidence: 8/10) `src/hosted/components/ExpenseDrawer.tsx:135`
   (`const isSubmitting = createMutation.isPending || updateMutation.isPending;`): the attach phase isn't covered, so
   Save would re-enable between the create and the uploads. Add an `attaching` state to `isSubmitting` (label
   "Attaching receipts…"). Required for plan D5. No question.
2. [INFORMATIONAL] (confidence: 8/10) `src/hosted/components/ReceiptUploader.tsx:38`
   (`if (readOnly && readyCount === 0) return null;`): queued mode has no READY receipts, so key the read-only
   early return on mode (queued + readOnly → null). Required for plan D6. No question.
3. [INFORMATIONAL] (confidence: 7/10) plan D4 `multiple`: picking several bad files would raise one toast each.
   Toast the first problem and queue the good files. Implementation detail inside D4. No question.
4. Shared code: R1 approved (one cleanup rule). The sequential loop in `useUploadReceipts`
   (`receiptQueries.ts:149-180`) was considered for sharing with `attachExpenseReceipts` and rejected: it carries
   per-file pending UI state and the library's 429 stop, which the expense path doesn't need (finding 4 above);
   savings under 10 lines.

Dispositions: 1–3 accepted as required implementation; 4 extraction rejected by the reviewer (no change proposed).

## Section 3: Tests

Framework: Vitest + Testing Library (unit, `npx vitest run <file> --maxWorkers=3` under Node 22), Playwright release-QA.

```
CODE PATHS                                                   USER FLOWS
[+] receiptQueries.uploadReceiptFile (R1)                    [+] Record expense with receipts
  ├── [★★★ TESTED] library: PUT fail / complete 4xx / 5xx      ├── [GAP] [→E2E] pick text file → refused, nothing sent
  │               — receiptQueries.test.ts (keep green)        ├── [GAP] [→E2E] pick PDF + JPEG, remove JPEG, Save
  └── [GAP] expense path: same four cases                      └── [GAP] reopen shows the PDF under Receipts
[+] expenseQueries.attachExpenseReceipts                     [+] Partial failure
  ├── [GAP] in order; one failure doesn't stop the next        ├── [GAP] toast names the file, edit drawer at ?expense=id
  └── [GAP] invalidates expenseKey + receipts lists (R2)       └── [GAP] expense POSTed once
[+] ReceiptUploader queued mode                              [+] Close mid-upload
  ├── [GAP] bad type toasts, not queued                        └── [GAP] no reopen after unmount (Arch 1)
  ├── [GAP] two files in one pick; Remove; 11th refused        [+] Read-only profile
  ├── [GAP] readOnly → nothing                                 └── [GAP] no queued control
  └── [★★ TESTED] live mode unchanged — ReceiptUploader.test.tsx
[+] ExpenseDrawer create
  ├── [★★ TESTED] no files → one POST, close — ExpenseDrawer.test.tsx
  ├── [GAP] files → create then uploads on new id, close
  ├── [GAP] Save disabled while attaching (CQ 1)
  └── [GAP] failure → onCreated(id); edit view refills from the new expense
[+] ExpensesList onCreated → ?expense=id                     [GAP]
[+] local mode: create + attach over IndexedDB               [GAP] local/__tests__/receipts.test.ts

COVERAGE: 3/19 paths tested (16%) | GAPS: 16 (3 E2E), all in the plan's test list or added below
```

Added to the plan's test list (required proof of approved behavior, no question):
- `data/__tests__/receiptQueries.test.ts`: expense-path rows on the shared helper's table (PUT fail → remove;
  complete 4xx → remove; complete 5xx → no remove). Value: protects=the 4xx-only cleanup rule on both callers;
  fails_when=the rule changes for one caller; why_new=library cases only today; seam=none; no_claim=storage acceptance (mocked fetch).
- `components/__tests__/ExpenseDrawer.test.tsx`: unmount during attach then a failure → `onCreated` not called.
  Value: protects=no reopen after close; fails_when=the mounted guard is removed; why_new=new path; seam=none; no_claim=none beyond protects.
- same file: Save disabled while attaching; after failure the edit view shows the saved values and the live uploader.
- `data/__tests__/expenseQueries.test.ts`: `invalidateReceipts` called after an attach (R2).

Regression: `useAddReceipt` moves onto the shared helper. Existing behavior to preserve: edit-mode attach still does
start → PUT → complete and lists the file (`ReceiptUploader.test.tsx`, QA `edit-receipts`). Intended difference:
failed uploads now delete their PENDING row, and the gallery refreshes. Covered by existing tests plus the rows above.

Tests made obsolete: none.

Dispositions: all gaps accepted as required proof.

## Section 4: Performance

No issues found. Per saved expense with n ≤ 10 receipts: 1 + 3n requests (+1 delete per failed PUT), the same as
attaching in edit mode today [estimated from the route sequence]. Files stay as `File` handles in memory until Save,
≤ 10 × 10 MB, which is the browser's own reference to the file and not a copy. No queries in loops server side.

## Outside voice

Codex CLI is not installed (CODEX_MODE: not_installed), so a native Plan subagent ran as the fallback. It finished in
274 s, inside the five-minute timer. The full report is in the session transcript (findings 1–15). Its main points:
- High: late `onClose`/`markSaved` after an unmount; a second Save can double-create.
- Medium: edits lost while attaching; plain-function uploads skip the lapse handler; failure toast stacked on the Saved
  notice; filenames scrambled in Arabic toasts; a lost complete may have landed; the union-prop uploader is a hooks
  trap; the create→edit flip is untested end to end; a simpler flip-to-edit-after-create alternative.
- Low: test 6 duplicates an existing test; queued `atCap` copy; a read-only create test covers an impossible state;
  R1's location makes an import cycle; cleanup writes audit rows.

Cross-model tension: verified by the main reviewer against code:
- `router.tsx:75` `navigate({ to: '.', … })` (1)
- `queryClient.ts:40` `mutationCache: new MutationCache({ onError: rereadMe })` (4)
- `receiptQueries.ts:6` `import { invalidateExpenses, putToSignedUrl } from './expenseQueries';` (14)
- `CloseAccountDrawer.tsx:26-27` FSI isolates + `Intl.ListFormat` (6)
- `local/__tests__/receipts.test.ts` (11)

Accepted as required implementation of approved behavior (no question): 1 (every post-attach side effect behind the
mounted guard; closed-drawer toast wording), 2 (one `saving` ref + state over create and attach, checked at the top of
`onSubmit`), 4 (attach runs inside a `useMutation` so `rereadMe` fires), 6 (FSI-isolated names via `Intl.ListFormat`,
at most 3 then "+N"), 7 (after the refetch, a failed file whose name is now READY is not reported), 9 (ExpensesList-level
test with the real drawer and a failing PUT; QA step failing one PUT with `page.route`), 11 (replace test 6 with
local-mode DELETE of a PENDING row whose blob was never written), 12 (queued copy "At most 10 receipts per expense"
naming dropped files), 13 (drop the impossible read-only create test), 14 (R1 helper lives in new
`src/hosted/data/receiptUpload.ts`; behavior as approved in D3), 15 (brief notes cleanup writes
`expense_receipt.deleted` with no `added`).
Depends on R3: 3 (edits during attach) and 5 (toast over Saved notice).

### R3: Save flow when receipts are queued
Finding: Outside voice 10 (with 1, 2, 3, 5), Medium, 8/10, plan D5; `ExpenseDrawer.tsx:105,135,177`; reviewer: Claude subagent.
Plan baseline: plan D5: attach in the create drawer, "Attaching receipts…", close on success, toast + flip to edit on failure.
Runtime evidence: `ExpensesList.tsx:163-173` renders one unkeyed drawer whose mode follows `?expense=`; edit mode
already shows the live uploader with per-file state.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R3 save flow | plan D5 | after create, flip to edit at once (`onCreated(id)` → `?expense=id`); queued files upload in the edit drawer's uploader, shown as they land; all landed → close + Saved; any failed → stay open with the failure inline (no toast) | plan D5 kept, plus guards (1,2), read-only form while attaching (3), `markSaved` deferred to close (5) |
| R4 uploader structure | pending | pending | pending |
Question D5: (see AskUserQuestion D5)
Header: Save flow
Options:
A) Apply: flip to edit
B) Keep D5 with guards
C) Investigate first
D) Defer this change
State: approved
Actual answer: A) Apply: flip to edit (D5, 2026-10-28)
Accepted scope: after create, the drawer becomes the new expense's edit drawer (onCreated(id) → ?expense=id, expense cache seeded); queued files upload in its receipts list, shown as they land; all landed and the form not dirty → close with Saved; any failed → stay open, failure inline on that file with Retry/Remove, no toast. Replaces plan D5's attach-in-create and failure toast.
History: none

### R4: Uploader component structure
Finding: Outside voice 8, Medium, 7/10, plan D4; `ReceiptUploader.tsx:32-33` (`useAddReceipt(profileId, expenseId)` unconditional); reviewer: Claude subagent.
Plan baseline: plan D4: one `ReceiptUploader` with union props.
Runtime evidence: the hooks take `expenseId` and run unconditionally; a union would call them with `''` in queued mode.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R4 structure | union props | shared `ReceiptPickButton` (hidden input, `multiple`, file check, toasts) + separate `QueuedReceipts` list; live `ReceiptUploader` uses the button | union props as planned |
| R3 save flow | pending | pending | pending |
Question D6: (see AskUserQuestion D6)
Header: Uploader shape
Options:
A) Apply: two components
B) Keep union props
C) Investigate first
D) Defer this change
State: approved
Actual answer: A) Apply: two components (D6, 2026-10-28)
Accepted scope: shared ReceiptPickButton (hidden input, multiple, checkReceiptFile, first-problem toast) used by the live ReceiptUploader and a new QueuedReceipts list for unsaved files; no union props. Replaces plan D4's union.
History: none

## Amendments (the plan as approved; these override D2–D6 and the Files/Tests tables above)

**Save flow (R3).**
```
create drawer: pick ─▶ ReceiptPickButton ─▶ QueuedReceipts (File[] in drawer state, ≤10, Remove)
Save ─▶ saving ref ─▶ POST /v1/expenses (Idempotency-Key) ─▶ setQueryData(expenseKey, created) ─▶ onCreated(id)
        └ error: today's field/toast mapping, queue kept, same key
?expense=id ─▶ same drawer instance, edit mode ─▶ ReceiptUploader(incoming=queued) uploads one at a time
        each: uploadExpenseReceipt ─▶ uploadReceiptFile (data/receiptUpload.ts, R1) inside useAddReceipt's mutation
        rows: Uploading… ─▶ listed READY | failed (Retry, Remove)   [a "failed" whose name is now READY is shown READY]
        after each: invalidate expenseKey + invalidateReceipts (R2)
all settled, none failed, form not dirty, still mounted ─▶ markSaved(id) + onClose()
otherwise stay open; closing later marks Saved for the created id
```
- `onCreated` is required on `ExpenseDrawer` in create mode; `ExpensesList` sets `?expense=<id>` and clears `newExpense`.
- One `saving` ref + state spans create until the flip, checked at the top of `onSubmit` (outside voice 2).
- Every post-upload side effect (`markSaved`, `onClose`) runs only while mounted (outside voice 1); closing mid-upload
  lets uploads finish with no navigation or flash.
- `markSaved` for a new expense happens when its drawer closes, never while it is open, so "Saved · Show" can't close
  the drawer mid-upload (outside voice 5).
- Uploads go through `useAddReceipt`'s mutation, so `rereadMe` sees lapse/closing refusals (outside voice 4).
- No failure toast; failed rows sit inline with `<bdi>` filenames, so no isolate-in-toast problem (outside voice 6 moot).

**Components (R4).** `ReceiptPickButton` (new, `src/hosted/components/ReceiptPickButton.tsx`), `QueuedReceipts` (new,
same folder or inside `ReceiptPickButton.tsx`), `ReceiptUploader` gains `incoming?: File[]` and `onIncomingSettled?`,
uses the button. Queued cap copy: new key `receipts.queuedAtCap` ("At most 10 receipts per expense."), naming dropped files.

**Data (R1, R2).** `src/hosted/data/receiptUpload.ts` (new): `uploadReceiptFile({ start, complete, remove }, file)`.
`uploadLibraryReceipt` and `uploadExpenseReceipt` call it. Placed outside receiptQueries.ts because that file already
imports expenseQueries (`receiptQueries.ts:6`), which would make a cycle. Cleanup writes `expense_receipt.deleted`
for a receipt that never had `added`; accepted, noted in the brief.

**Files (10 product files).** expenseQueries.ts, receiptQueries.ts, receiptUpload.ts (new), ReceiptPickButton.tsx (new),
ReceiptUploader.tsx, ExpenseDrawer.tsx, ExpensesList.tsx, en.json, ar.json, qa expenses.yaml + expenses.spec.ts.
No server or OpenAPI change.

**Tests.**
1. `data/__tests__/receiptUpload.test.ts`: helper table: happy; PUT fail → remove; complete 4xx → remove; 5xx/network → no remove (library and expense steps).
2. `components/__tests__/ReceiptPickButton.test.tsx`: bad type toasts first problem only; two files in one pick; queued Remove; 11th refused with queuedAtCap naming it.
3. `components/__tests__/ReceiptUploader.test.tsx`: live mode unchanged (existing); `incoming` files upload one at a time; a failed row offers Retry and Remove; a failed name that is READY after refetch shows READY; `onIncomingSettled` reports failures; `invalidateReceipts` called.
4. `components/__tests__/ExpenseDrawer.test.tsx`: no files → today's create; with files → POST once, `onCreated(id)`; second Save during create → no second POST; unmount mid-upload → no `onClose`/markSaved.
5. `pages/__tests__/ExpensesList.test.tsx`: real drawer, two files, one PUT fails → URL `?expense=<id>`, the good file READY, the failed one inline, one POST /v1/expenses; all succeed → drawer closes, row flashes Saved.
6. `local/__tests__/receipts.test.ts`: DELETE of a PENDING row whose blob was never written succeeds.
7. QA `create-with-receipt` (paths: ExpenseDrawer.tsx, ReceiptUploader.tsx, ReceiptPickButton.tsx, receiptUpload.ts): text file refused; PDF + JPEG, remove JPEG, Save → closes, row Saved, reopen shows the PDF; then a second expense with one PUT failed by `page.route` → stays open at `?expense=`, failure inline, Retry lands it.

Approval readiness: PASS. R1 (D3 A), R2 (D4 A), R3 (D5 A), R4 (D6 A) each cite their answer; structure D2 A;
required-implementation items cite approved D5/R3 or the ticket's ACs.

## Reality rows

REALITY: premise-table finding 4 plan premises corrected (READY-only cap, no ICU, no common.remove, no 429 on the session route); unverified=0 server/src/repositories/prisma.ts:2176
REALITY: already-done pass no MUT-491 commit or branch (git log --all --grep MUT-491 empty) src/hosted/components/ExpenseDrawer.tsx:193
REALITY: surface-check pass start/complete/delete routes exist server/src/routes/expenses.ts:286
REALITY: binding-decisions pass MUT-260 D9 one-at-a-time uploads kept; no overruled default reintroduced src/hosted/data/receiptQueries.ts:146
REALITY: numbers pass 10 per expense [measured] server/src/expenses/compose.ts:17; 30/min [measured] server/src/routes/receipts.ts:39; 10 MB [measured] src/hosted/data/receiptFileRules.ts:7
REALITY: deferred-asks pass every MUT-491 AC mapped; read-only holds because create never opens read-only src/hosted/pages/views/ExpensesList.tsx:122
REALITY: pr-count pass one local branch, default one PR (no ship-policy file) 576709680dd0d9f531c2c9d9db357be245411601

## NOT in scope
- Reading or prefilling fields from the receipt: MUT-441 / MUT-301 / MUT-304 own it.
- Phone add-expense parity: a separate product call (Flutter repo), not asked for.
- Choosing an existing To-review receipt from the drawer: MUT-429.
- Several files per pick in edit mode beyond what ReceiptPickButton gives for free: not asked for; the button allows it, tests cover create.
- Analytics on receipt attach: MUT-155's contract stays currency-only.

## What already exists
- Reused: `checkReceiptFile`/`RECEIPT_MIME_TYPES`, `putToSignedUrl` (local-blob aware), the expense receipt routes, `useAddReceipt`'s mutation, `invalidateReceipts`, `useSavedFlashStore`, the drawer's URL-driven mode.
- Extracted (R1): `uploadReceiptFile` from `uploadLibraryReceipt` (receiptQueries.ts:112-133), so one cleanup rule serves both. Estimated ~20 implementation lines saved, more with tests.
- Rejected: sharing the `useUploadReceipts` loop (per-file pending UI and 429 stop the expense path doesn't need).

## Failure modes
| Path | Realistic failure | Handling | Test | User sees |
|---|---|---|---|---|
| create | network loss after POST | same Idempotency-Key on retry, queue kept | existing + test 4 | field/toast error, Save again |
| upload start | storage off (503) | row failed inline, Retry/Remove | tests 3, 5 | failure on that file |
| PUT | bucket refuses | PENDING row removed | test 1 | failure on that file |
| complete | 5xx, actually landed | no remove; READY name wins | tests 1, 3 | file listed READY |
| close mid-upload | uploads finish | no side effects after unmount | test 4 | nothing unexpected |
| lapse mid-upload | 402 | `rereadMe` via mutation cache | covered by mutation path | portal turns read-only |
No silent failure without a test or handling: 0 critical gaps.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module: src/hosted expense/receipt code).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~10min)** — data — Extract `uploadReceiptFile` into `data/receiptUpload.ts`; library and expense paths use it; invalidate receipts after attach
  - Surfaced by: R1, R2, outside voice 14
  - Files: src/hosted/data/receiptUpload.ts, receiptQueries.ts, expenseQueries.ts
  - Verify: `npx vitest run src/hosted/data --maxWorkers=3`
- [ ] **T2 (P1, human: ~1h / CC: ~10min)** — components — `ReceiptPickButton` + `QueuedReceipts`; live uploader uses the button and takes `incoming` files with inline failed rows
  - Surfaced by: R4, outside voice 7, 12
  - Files: src/hosted/components/ReceiptPickButton.tsx, ReceiptUploader.tsx, i18n en/ar
  - Verify: `npx vitest run src/hosted/components/__tests__/Receipt* --maxWorkers=3`
- [ ] **T3 (P1, human: ~2h / CC: ~15min)** — drawer — create→edit flip with saving ref, seeded cache, mounted guard, close-time markSaved
  - Surfaced by: R3, Arch 1, CQ 1, outside voice 1, 2, 4, 5
  - Files: src/hosted/components/ExpenseDrawer.tsx, src/hosted/pages/views/ExpensesList.tsx
  - Verify: `npx vitest run src/hosted/components/__tests__/ExpenseDrawer.test.tsx src/hosted/pages/__tests__/ExpensesList.test.tsx --maxWorkers=3`
- [ ] **T4 (P1, human: ~1h / CC: ~10min)** — QA — `create-with-receipt` feature + spec with a failed PUT step; local-mode PENDING delete test
  - Surfaced by: Test review, outside voice 9, 11
  - Files: qa/features/portal/expenses.yaml, qa/specs/portal/expenses.spec.ts, src/hosted/local/__tests__/receipts.test.ts
  - Verify: `release-qa run --attach --only create-with-receipt`; `release-qa lint`
- [ ] **T5 (P2, human: ~30min / CC: ~5min)** — docs — design brief + tests brief copied into .claude/designs, ADR (next free; 220 reserved by MUT-441), CHANGELOG, COMPONENT_REGISTRY, TEST_PLAN
  - Surfaced by: CLAUDE.md knowledge protocol
  - Files: .claude/*
  - Verify: review the diff

## Unresolved decisions
None.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 0 unverified premises
- Architecture Review: 1 issue found
- Code Quality Review: 3 issues found
- Test Review: diagram produced, 16 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex not installed; native Claude Plan subagent completed (in-host, 15 findings, 2 decisions D5/D6)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D3 and D4 scored, both picked 10/10; D5 and D6 differ in kind)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 15 findings, 2 decisions |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open (all resolved into tasks) | 20 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review, unavailable (CLI not installed); native in-host fallback completed with 15 findings.
- **VERDICT:** ENG REVIEW done with every finding mapped to tasks; status issues_open by rule (issues counted), no unresolved decisions. Ready to implement.

NO UNRESOLVED DECISIONS
