

### Carry-over — `src/lib/carryOver/`, `src/hosted/local/carryOver/`, `src/hosted/pages/carry-over/`, `src/pages/carryOver/` (MUT-291, ADR-181)
- `startCarryOverSend` / `awaitCarryOverPayload` (`protocol.ts`): the cross-origin hand-off between an old page and the new address; `carryOverBuild()` (`build.ts`) the baked origins; `leaveTo` (`leave.ts`) a same-tab hand-off to another origin.
- `parseFreeAppBackup` / `mapFreeAppBackup` / `replayCarryOver` / `prepareFromBackup`: the old web app's backup as checked local-mode records, ready for `applyRestore`; `snapshotTotals` / `freeAppTotals` / `compareTotals` the per-profile, per-currency check.
- `CarryOverDetails`: the summary (counts, totals, changed, not carried, JOD); also inside Your data › Restore. `ReceivePage`, `CarryOverPage`.
- `CarryOverGate` / `CarriedBanner`: the free web app's screen in front of its router.
- `MemoryAttachmentStorage` (`src/hosted/local/attachments.ts`), `useRestoredHome` (`src/hosted/session/restoredHome.ts`).
