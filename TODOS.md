# TODOS

## 1. Transaction mutations bypass the sync op-log — ticketed as MUT-46

**What:** Creating, editing, archiving, unarchiving and soft-deleting a transaction emits no sync operation, so those changes never reach another device. Expenses never sync at all.

**Why:** `src/hooks/useQueries.ts` and `src/hooks/useIncomeQueries.ts` call `transactionRepo.{create,update,archive,unarchive,softDelete}` on the raw repository; only `markPaid` and `recordPartialPayment` go through `syncedTransactionRepo`. Bundles are built from the op-log (`src/sync/transport/bundle-encoder.ts` -> `getLocalOpsSince`), so an un-captured mutation is invisible to sync. Separately, `EntityType` in `src/sync/core/ops-types.ts:84` has no `expense` member and `src/sync/` contains no expense reference.

**Pros of fixing:** Closes a silent data-loss path in a feature ADR-013 describes as shipped. The machinery already exists and is already imported — the call sites simply route around it.

**Cons / cost / risk:** Touches sync correctness. No existing test asserts op capture on create/update/delete, so the fix needs new regression tests before it can be trusted. Expense sync is a larger question, not a slot addition.

**Context:** Found 2026-10-10 while mapping MUT-35's blast radius. Pre-existing and unrelated to MUT-35, which deliberately preserves the current behaviour. Start at the two hook files above and `src/sync/core/synced-repository.ts`. Decide the expense question alongside MUT-42, which gives expenses a server-side home anyway.

**Depends on / blocked by:** Nothing. Independent of the MUT-34 epic. Should become its own MUT ticket.

## 2. Documented data layer does not match the real one — ticketed as MUT-47

**What:** Two documented claims that nothing checks: CLAUDE.md's mandatory Phase 4 verification names `npm run test:integration`, which has never existed; and `IRepositoryProvider` covers 20 slots while the db layer exports roughly 26 repository objects.

**Why:** `package.json` has no `test:integration` script (MUT-35 adds `typecheck`, closing the other half). `planRepo`, `planAssumptionRepo`, `planScenarioRepo` (`src/db/planRepository.ts:33,191,301`), `scheduleGenerator` and `retainerMatching` (`src/db/retainerRepository.ts:470,620`) have no declared interface and no provider slot, so "every repository object is conformance-checked" stays false after MUT-35 ships.

**Pros of fixing:** Keeps the documented architecture honest, which is the entire thesis of MUT-35 applied one layer up.

**Cons / cost / risk:** Neither item causes a runtime failure. `scheduleGenerator` and `retainerMatching` are not repositories, so they need a design call rather than a mechanical slot.

**Context:** Found 2026-10-10 during the MUT-35 eng review. Either give the five objects contracts and slots, or write an explicit note in `interfaces.ts` saying they sit outside the seam and why.

**Depends on / blocked by:** Nothing. Cheap; do it next time CLAUDE.md or `interfaces.ts` is open.

## 3. Payment records are captured for sync but can never be applied — ticketed as MUT-55

**What:** Recording a payment emits a sync operation that the receiving device cannot apply. Payments never travel between devices. A user who records a payment on the laptop opens the phone and the receivable still reads unpaid, with no error anywhere.

**Why:** `src/sync/core/synced-repository.ts:401,413,418` calls `captureCreateOp('paymentRecord', …)`, `captureUpdateOps` and `captureDeleteOp`, and `src/sync/core/ops-types.ts:84` declares `'paymentRecord'` in `EntityType`. But `src/sync/core/ops-engine.ts` contains zero occurrences of `paymentRecord`: the create switch at `:410-431` has no case and no default, so creates silently no-op, and `getTableForEntityType` at `:532-549` ends `default: throw new Error(\`Unknown entity type: ${entityType}\`)`, so update and delete ops throw on apply.

**Pros of fixing:** Closes a silent cross-device data-loss path in the feature ADR-013 describes as shipped. The fix mirrors the existing `transaction` case in both switches.

**Cons / cost / risk:** Touches sync correctness, and no test in the repo exercises `applyOp` replay for any entity, so the fix needs new regression tests before it can be trusted. Soft-delete semantics need a decision: `paymentRecordRepo.delete` sets `deletedAt` rather than removing the row, so the delete op must replay as a field update.

**Context:** Found 2026-10-10 during the MUT-6 eng review. Pre-existing and independent of MUT-6, but MUT-6 promotes this exact path from a hidden kebab item to the product's most-clicked button, which is what raises the priority. Same class as item 1 above and worth doing in the same pass. Start at `ops-engine.ts:410` and `:532`.

**Depends on / blocked by:** Nothing. Overlaps item 1 (MUT-46) — decide them together.

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
