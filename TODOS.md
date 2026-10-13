# TODOS

> Items 1 (MUT-46) and 3 (MUT-55) were retired with device sync on 2026-10-12 (MUT-73, ADR-053): both were sync bugs, and sync was deleted rather than fixed. The other items keep their numbers because they are cited elsewhere.

## 2. Documented data layer does not match the real one — ticketed as MUT-47

**What:** Two documented claims that nothing checks: CLAUDE.md's mandatory Phase 4 verification names `npm run test:integration`, which has never existed; and `IRepositoryProvider` covers 20 slots while the db layer exports 25 repository objects (26 until MUT-58 deleted `moneyEventRepo`).

**Why:** `package.json` has no `test:integration` script (MUT-35 adds `typecheck`, closing the other half). `planRepo`, `planAssumptionRepo`, `planScenarioRepo` (`src/db/planRepository.ts:33,191,301`), `scheduleGenerator` and `retainerMatching` (`src/db/retainerRepository.ts:470,620`) have no declared interface and no provider slot, so "every repository object is conformance-checked" stays false after MUT-35 ships.

**Pros of fixing:** Keeps the documented architecture honest, which is the entire thesis of MUT-35 applied one layer up.

**Cons / cost / risk:** Neither item causes a runtime failure. `scheduleGenerator` and `retainerMatching` are not repositories, so they need a design call rather than a mechanical slot.

**Context:** Found 2026-10-10 during the MUT-35 eng review. Either give the five objects contracts and slots, or write an explicit note in `interfaces.ts` saying they sit outside the seam and why.

**Depends on / blocked by:** Nothing. Cheap; do it next time CLAUDE.md or `interfaces.ts` is open.

## 4. A failed refetch after a successful write is completely silent

**What:** When a mutation succeeds but the refetch it triggers fails, the UI shows two numbers that disagree and explains neither. After recording a payment, the row keeps its old unpaid status while the drawer's own payment history shows the new record. The user's reasonable conclusion is that the save failed, so they record it again.

**Why:** `withErrorToast` (`src/hooks/useMutationWithFeedback.ts:63-77`) wraps `onError` for **mutations** only. No page renders `isError` or `error` from a `useQuery`, and the global client (`src/main.tsx:56`) sets no query-level error handler. Invalidation is fire-and-forget, so a rejected refetch surfaces nowhere.

**Pros of fixing:** Removes the one failure on the money path a user cannot diagnose. A single query-error surface (a toast via the QueryClient's `QueryCache onError`, or an inline banner on the list pages) covers every list in the app at once.

**Cons / cost / risk:** App-wide behaviour change; a noisy implementation could toast on every transient failure. Needs a decision about which query failures are worth interrupting the user for.

**Context:** Found 2026-10-10 during the MUT-6 eng review. Pre-existing and app-wide, not caused by MUT-6 — but MUT-6 moves the payment flow onto the most-clicked button in the product, which is where a silent failure costs the most. Start at `src/main.tsx:56` with `QueryCache({ onError })`.

**Depends on / blocked by:** Nothing.

## 5. "Mark paid" and "Record payment" become two-click duplicates that disagree about the date

**What:** Once MUT-6 prefills the payment drawer with the full remaining balance, settling in full takes two clicks through the new button — and `Mark paid` in the kebab, sitting in the same row, also takes two clicks to the same end state. The two differ only in something invisible: one lets you backdate, the other stamps today.

**Why:** `transactionRepo.markPaid` (`src/db/repository.ts:368-392`) passes `opts?.paidAt ?? nowISO()`, and `useMarkIncomePaid` / `useMarkTransactionPaid` (`src/hooks/useQueries.ts:157`) never pass `paidAt` — the MUT-18 bug. The drawer's form takes a date input and stores what the user chose. Users will take the faster-looking kebab item and silently stamp today's date on a payment that arrived last month.

**Pros of fixing:** Removes a UX trap where the quicker-looking control is the one that records wrong data. Likely resolves to deleting a redundant control rather than adding anything.

**Cons / cost / risk:** It is a product judgment about what `Mark paid` is for, not a mechanical fix. If MUT-18 lands first and `markPaid` learns to backdate, the two still overlap but harmlessly, which changes the answer.

**Context:** Found 2026-10-10 during the MUT-6 eng review; created by MUT-6's prefill rather than pre-existing. Decide after MUT-18 ships, since fixing the date may change whether the control is worth keeping.

**Depends on / blocked by:** MUT-18 (`markPaid` hardcodes `paidAt`). Decide after it lands.

## 6. Two more private copies of the bidi `isolate` helper

**What:** `src/components/expenses/RecurringAttentionList.tsx:25` and `src/components/drawers/RecurringMarkPaidDrawer.tsx:45` each define their own `isolate` (U+2068 FSI … U+2069 PDI), identical to the one `src/lib/utils.ts` now exports.

**Why:** MUT-81's eng review found four private copies total, two of which (`OwedNowSummary.tsx`, `PartialPaymentDrawer.tsx`) used a different, wrong codepoint (U+2066 LRI) and were migrated as part of that ticket. These two were already correct (same FSI codepoint as the shared helper), so the review scoped the migration narrower (D4: "Extract + migrate the two MUT-81 opens") rather than touching files outside that ticket's blast radius.

**Pros of fixing:** One definition instead of three; the recurring-expenses area stops carrying logic that exists elsewhere in the codebase.

**Cons / cost / risk:** None functional — both copies are already correct. Purely a dedup.

**Context:** Found 2026-10-12 during MUT-81's eng review (`/plan-eng-review`), decision D4.

**Depends on / blocked by:** Nothing. Next time either file is open for an unrelated change.

## 7. Contingency fee proposals: propose upfront + rate, approval creates the agreement — ticketed as MUT-107 (UI: MAL-1094)

**What:** Let a fee proposal carry contingency terms (upfront, commission rate, upfront treatment) and have approval create a CONTINGENCY agreement in the same transaction. Design already reviewed: MUT-100 plan §11 (`.claude/designs/mut-100-contingency-agreements.md`), eng decisions D9 (Proposed counts the upfront only) and D10 (approve `schedule` optional, required only when the upfront > 0, 422 SCHEDULE_REQUIRED).

**Why:** Since M8 a client's approval is how a fee agreement is born (MUT-40/MAL-943); without this, contingency deals are the one fee type created directly with no client-approval record.

**Pros of fixing:** One negotiation flow for every fee type; the approval record exists for contingency deals too.

**Cons / cost / risk:** Touches the proposal schema, the approve route, `CurrencySummary.proposed`, and needs the Malafat proposal dialogs (MAL-1094) so the API is not shipped unused.

**Context:** Deferred from MUT-100 by the CEO review on 2026-10-12 because MAL-1077, the only consumer, excludes it. Start at `server/src/routes/fee-proposals.ts` approve; `composePreview` derives the agreement type from the body's `contingency`, so approval builds the preview body with it.

**Depends on / blocked by:** MUT-100 (the CONTINGENCY type) and the paired Malafat proposal-UI ticket MAL-1094.

## 8. Audit event ordering can tie-break on a random id when two events land in the same millisecond

**What:** `AuditRepository.append` stamps `createdAt` with real wall-clock time in both stores (`new Date()` in-memory, `CURRENT_TIMESTAMP` in Postgres) rather than the request's deterministic clock; listing then sorts by `(createdAt, id)` (`paginate`'s `compareByCreatedAtThenId`, `server/src/repositories/memory.ts:1460`), and `id` is a random UUID. Two audit events appended within the same millisecond — plausible any time a single request handler appends more than one (e.g. `agreement.created` immediately followed by `installment.posted`, or `fee_proposal.created` then `fee_proposal.approved` in a fast replay) — can come back in the wrong order.

**Why it surfaced now:** MUT-107 added two more audit-heavy test files; running the full suite started intermittently failing `routes-m6.test.ts`'s audit-ordering assertion and, once, one of MUT-107's own (`fee_proposal.created`/`.approved` swapped). Both pass every time in isolation. Higher parallel CPU load makes same-millisecond timestamps more likely, which is what exposed a bug that was already there — not something introduced by MUT-107's logic.

**Pros of fixing:** Removes a source of flaky tests and a real (if narrow) chance of audit events displaying out of order in Malafat for genuinely fast back-to-back writes.

**Cons / cost / risk:** Touches `AuditRepository.append` in both stores — needs a design call on what the deterministic tiebreak should be (a monotonic sequence column? thread the request's `now` + an in-request counter?) rather than a quick patch.

**Context:** Found during MUT-107's own verification pass (2026-10-13), not part of its acceptance criteria — contingency fee proposals don't touch audit ordering. Logged here rather than fixed inline to avoid unrelated scope creep on that ticket.

**Depends on / blocked by:** Nothing; can be picked up any time.

## 9. The desktop app keeps a file-write permission nothing uses once invoice PDFs are gone

**What:** Remove the Tauri `fs` plugin and its capabilities: `tauri-plugin-fs` in `src-tauri/Cargo.toml:28`, `.plugin(tauri_plugin_fs::init())` in `src-tauri/src/lib.rs:12`, `@tauri-apps/plugin-fs` in `package.json`, and the `fs:default`, `fs:allow-mkdir` and `fs:allow-write` (`$DOCUMENT/Mutaba3a/**`) entries in `src-tauri/capabilities/default.json`.

**Why:** Its only JS consumer was `src/services/pdfArchival.ts`, which saved exported invoice PDFs to `Documents/Mutaba3a/`. MUT-145 deletes that service along with document generation. After that, the permission is unused privilege.

**Pros of fixing:** Least privilege. The desktop app can no longer write to the user's Documents folder, and one native plugin leaves the build.

**Cons / cost / risk:** It touches Rust config and the Tauri capability schema, so it needs a desktop build (`make` desktop target) to verify. The MUT-145 gate is JS-only, so this was kept out of that ticket on purpose.

**Context:** Decided in MUT-145's eng review (2026-10-13, D10). Start by grepping `plugin-fs` across `src` to confirm no consumer appeared since. Then remove the four pieces above and build the desktop app.

**Depends on / blocked by:** MUT-145 merged (it deletes `pdfArchival.ts`).
