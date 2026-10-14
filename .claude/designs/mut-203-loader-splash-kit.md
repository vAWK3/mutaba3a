# MUT-203 — Brand kit: the Loader & Splash delivery in docs/brand

**Status**: Planned 2026-10-15 (eng review in `mut-206-brand-loader.md`, which covers the whole set)
**Ticket**: MUT-203 (Task, Backlog). Blockers: none.
**Blocks**: MUT-204, MUT-205 (Flutter), MUT-206, MUT-207 (web and portal).
**Epic**: MUT-101 · Kit index: `docs/brand/README.md`.

## Problem

Design delivered the bloom loader and the native splash on 2026-10-14 (`Loader & Splash.dc.html`, Claude Design project 160fbfa7…). Neither repo has the files, and the kit index doesn't list them. Four stories build from them, so the kit needs one canonical, committed copy first. This follows the PD0 precedent from MUT-102: commit the kit as delivered before any worktree is cut.

## Source

The export `~/Downloads/loading-Mutaba3a design system.zip` (2026-10-14 23:49; zip sha256 `9430717808795c26…`). Take only `loader/*` and `splash/**`. The project's `icons/` folder is the 10-12 set that MUT-104 and MUT-105 already handled, so leave it.

**C2PA.** Every file the export or `GetFile` returns has a C2PA manifest stamped in at download, so PNG sizes are about 6 KB above the sizes the project lists. "As delivered" therefore means **byte-identical to the export**, not to the project listing. Keep the stamps, as MUT-104 did for `mark.svg`: `docs/` ships in no build. MUT-205's generator re-encodes the PNGs, and MUT-206 ports the SVG into code.

| File | sha256 (first 16) | Notes |
|---|---|---|
| `loader/mutaba3a-loader.json` | `679acf9fbe112838` | Lottie 5.7.4, light, 120×120, 270 frames at 60 fps. Layers tr/tl/bl/br |
| `loader/mutaba3a-loader-dark.json` | `de21ecfd7ce4c9f6` | dark: tr `#F3E5B0`, br `#F9B379` |
| `loader/mutaba3a-loader.js` | `54ec5d185de54b60` | `<mutaba3a-loader>`, inline SMIL. **Reference only**, ported by MUT-206 |
| `loader/mutaba3a_loader.dart` | `e6995856812bd0a8` | `CustomPainter`, adapted by MUT-204 |
| `splash/splash.png`, `splash-dark.png` | `cbc4d60906d1cd57`, `9556f42fd2560a1c` | 768×768, mark 576 px, centred |
| `splash/android12.png`, `android12-dark.png` | `b4e5dbea17668543`, `7c82b19419463f76` | 1152×1152, mark 500 px |
| `splash/flutter_native_splash.yaml` | `c7ee0e412f8f6cde` | MUT-205 records 3 deviations |
| `splash/screens/splash-{light,dark}-1290x2796.png` | `b4df772bd1ff8e0f`, `60006193a81a5487` | reference renders (mark ≈ 135 pt) |
| `splash/screens/splash-{light,dark}-1080x2400.png` | `8817f33854909a99`, `0278edd085172617` | reference renders |

Checked on 2026-10-15 by script: the keyframe times are identical across the JSON, the Dart and the JS. Each piece runs 0/36/84/126/150/190/236/270, with 4 frames of stagger between pieces, and the rotation runs 0/36/220/270, in both themes.

## Plan

1. In a worktree cut from main: `unzip` the two folders into scratch, then copy them to `docs/brand/loader/` and `docs/brand/splash/` (including `screens/`).
2. `docs/brand/README.md`:
   - **Asset map**: add rows in the existing `| Asset | Location | Used by |` format, one per group: the loader JSONs (the motion source of truth; parity tests in MUT-204 and MUT-206), the loader JS (reference for `BrandLoader`, MUT-206), the loader Dart (reference for `Mutaba3aLoader`, MUT-204), the splash PNGs and yaml (MUT-205), and the splash screens (QA reference, MUT-205 and MUT-207).
   - **Source of truth**: one paragraph. The Lottie JSONs define the motion. Ports regenerate from them and are never hand-tuned, and parity tests on both platforms enforce it.
   - **Deviations**: none yet. MUT-205 and MUT-206 add theirs when they land.
3. Commit as `chore(brand): MUT-203 — Loader & Splash as delivered`, then fast-forward merge.

## Tests

None in code. Acceptance checks for the review:
- `shasum -a 256` of the 13 files equals the table.
- `npm run lint` stays green. ESLint applies rules only to `ts`/`tsx`, so the delivered `.js` passes. `test:run` stays green (Vitest includes only `src/**` and `scripts/**`).
- `npm run build` output contains nothing from `docs/` (the PWA precache globs cover the dist only).

## Knowledge updates

`CHANGELOG.md` gets one line. ADRs and the registry are unchanged: no code changes here.

## Build notes

Basel's main checkout has another session's uncommitted edits (`src/db/repository.ts`, `useQueries.test.tsx`), so build in a worktree. The diff is docs only, so a fast-forward merge is safe.
