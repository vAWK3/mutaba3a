# Verdict → Glance contract (MUT-449 D5)

Each `<case>.json` holds one `GET /v1/summaries/verdict` answer (`verdict`), the view inputs (`period`, `readable`), and what the Reports Glance must make of it (`expected`: `glance`, `isFirstRun`, `verdictAllLocked`). The shapes are the portal's `Glance` in `src/hosted/data/verdict.ts`: amounts are minor units with an `approximate` (≈) flag.

The server owns the money rules (ADR-204). These files pin the **display shaping** that both clients do: which figure each line shows, ≈, "leaves out", usual on finished months only, and First Run. With them, the portal and the phone can't drift apart.

- **Write:** `npx tsx scripts/verdict-glance-fixtures.ts` builds every case from the portal's `glanceOf`. Add or change cases there, never by hand here.
- **Check:** `npx tsx scripts/verdict-glance-fixtures.ts --check`. The portal test `src/hosted/data/__tests__/verdict.test.ts` also asserts `glanceOf` against every file.
- **Phone:** `mutaba3a-flutter` copies this folder to `test/fixtures/verdict_glance/` with `tool/sync_verdict_fixtures.sh`, which records the sha256 the script prints in `SOURCE.sha256`. `glance_test.dart` asserts its Dart `glanceOf` against the same files, and a pin test fails when the copy no longer matches the recorded digest.

A change to the contract is therefore a two-repo change. Re-write it here, re-sync the phone, and fix whichever side then fails.
