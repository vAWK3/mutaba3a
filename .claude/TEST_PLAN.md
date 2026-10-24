

## MUT-291 — the carry-over from the old web app and the old address (2026-10-24, ADR-181)
- Unit: `src/lib/carryOver/__tests__/protocol.test.ts` (23); `src/hosted/local/carryOver/__tests__/mapFreeAppBackup.test.ts` (34); `replay.test.ts` (rate limit, refusals, progress, gate); `src/hosted/local/__tests__/createLocalApp.test.ts` (rate-limit option); `scripts/__tests__/vite-config.test.ts` (carry-over origins); `src/lib/__tests__/carryOverExponent.test.ts`; `src/db/__tests__/carryOverBackupVersion.test.ts`, `datasetCountRecords.test.ts`.
- Integration: `src/db/__tests__/carryOver.integration.test.ts` (T-I1 the free app's own demo + CSV data, T-I5 twice); `src/hosted/local/carryOver/__tests__/backend.test.ts` (T-I3, T-I4 through the real local backend).
- UI: `src/hosted/pages/carry-over/__tests__/carryOverPages.test.tsx` (11); `src/pages/carryOver/__tests__/CarryOverScreen.test.tsx` (7); `local-mode.test.tsx` (Restore reads the old backup).
- Guards: `server/src/__tests__/legacy-redirect.test.ts` (no COOP on either page); `scripts/__tests__/netlify-no-coop.test.ts`; `scripts/__tests__/check-bundles.test.ts` (the carry-over code under HOSTED_RULES and LOCAL_RULES); `npm run test:bundles` passes.
- Perf (off by default): `replay.perf.test.ts`, `CARRY_OVER_PERF=1`: 20,000 records, 4.3 s, heap +149 MB.
- Release QA: app `carry-over`, `qa/features/carry-over/carry-over.yaml`, 7 features, `qa/specs/carry-over/carry-over.spec.ts` 7/7 passing (2026-10-24).
- Not covered: a real cross-host run (run.app or netlify.app to app.mtb3a.com) on a real browser: the operator's day-7 check (plan §6). Real iOS standalone: stubbed in QA.
