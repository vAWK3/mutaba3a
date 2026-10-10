# TODOS

## 1. Transaction mutations bypass the sync op-log

**What:** Creating, editing, archiving, unarchiving and soft-deleting a transaction emits no sync operation, so those changes never reach another device. Expenses never sync at all.

**Why:** `src/hooks/useQueries.ts` and `src/hooks/useIncomeQueries.ts` call `transactionRepo.{create,update,archive,unarchive,softDelete}` on the raw repository; only `markPaid` and `recordPartialPayment` go through `syncedTransactionRepo`. Bundles are built from the op-log (`src/sync/transport/bundle-encoder.ts` -> `getLocalOpsSince`), so an un-captured mutation is invisible to sync. Separately, `EntityType` in `src/sync/core/ops-types.ts:84` has no `expense` member and `src/sync/` contains no expense reference.

**Pros of fixing:** Closes a silent data-loss path in a feature ADR-013 describes as shipped. The machinery already exists and is already imported — the call sites simply route around it.

**Cons / cost / risk:** Touches sync correctness. No existing test asserts op capture on create/update/delete, so the fix needs new regression tests before it can be trusted. Expense sync is a larger question, not a slot addition.

**Context:** Found 2026-10-10 while mapping MUT-35's blast radius. Pre-existing and unrelated to MUT-35, which deliberately preserves the current behaviour. Start at the two hook files above and `src/sync/core/synced-repository.ts`. Decide the expense question alongside MUT-42, which gives expenses a server-side home anyway.

**Depends on / blocked by:** Nothing. Independent of the MUT-34 epic. Should become its own MUT ticket.

## 2. Documented data layer does not match the real one

**What:** Two documented claims that nothing checks: CLAUDE.md's mandatory Phase 4 verification names `npm run test:integration`, which has never existed; and `IRepositoryProvider` covers 20 slots while the db layer exports roughly 26 repository objects.

**Why:** `package.json` has no `test:integration` script (MUT-35 adds `typecheck`, closing the other half). `planRepo`, `planAssumptionRepo`, `planScenarioRepo` (`src/db/planRepository.ts:33,191,301`), `scheduleGenerator` and `retainerMatching` (`src/db/retainerRepository.ts:470,620`) have no declared interface and no provider slot, so "every repository object is conformance-checked" stays false after MUT-35 ships.

**Pros of fixing:** Keeps the documented architecture honest, which is the entire thesis of MUT-35 applied one layer up.

**Cons / cost / risk:** Neither item causes a runtime failure. `scheduleGenerator` and `retainerMatching` are not repositories, so they need a design call rather than a mechanical slot.

**Context:** Found 2026-10-10 during the MUT-35 eng review. Either give the five objects contracts and slots, or write an explicit note in `interfaces.ts` saying they sit outside the seam and why.

**Depends on / blocked by:** Nothing. Cheap; do it next time CLAUDE.md or `interfaces.ts` is open.
