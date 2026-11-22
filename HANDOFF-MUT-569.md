# MUT-569 handoff (2026-11-22)

**State:** built, reviewed and verified. Main, with MUT-660 (185517a6) and MUT-657's guard fix, is merged into this branch and the conflicts are resolved. **Not merged into main.** Basel said "merge now, add to release" in the MUT-569 session. mini-crm-00 holds the merge until after the 11-23 release, on Basel's yes. Jira MUT-569 is still **In Progress**; In Review comes after the merge.

**Numbers after the merge:** MUT-569 is **ADR-271**, **TD-323** and **API 1.128.0-mut569**. MUT-660 took ADR-270, TD-320 and 1.127.0. The renumbering covered code comments, Terraform, docs and the knowledge files. OpenAPI and `schema.d.ts` were regenerated.

## Checks

**At 219e0532, before the main merge:**
- Server: typecheck, lint and `openapi:check` clean; the full suite passed (7,467 tests).
- Root: lint and `build:hosted` clean.
- Root guards: the only failures were MUT-657's two, which main has since fixed.
- QA flows recorded and passing: `portal.invoicing.uniform-file`, `uniform-file-empty` and `setup`. The other invoicing flows are carried with a reason (`release-qa impact carry`).
- Terraform plan test: `tests/uniform_file.tftest.hcl`, 3 of 3 pass.

**On the merged tree (e32ea945 plus the spec fix in the commit after it):**
- Server: typecheck clean. 587 tests in 15 suites pass: issuing, uniform file, documents due, writability, route lists and the version pins.
- Server: `openapi:check` is up to date.
- Root: typecheck clean, and the 293 portal tests pass (style guards and invoicing card).
- Lint is clean on the uniform-file and invoicing files. The merge seam had dropped my last spec's `});`; that's fixed now.
- The Prisma client in main's shared `server/node_modules` was regenerated, because it predated MUT-660's schema. This branch's schema is identical to main's.

**Not re-run on the merged tree:** the full server and root suites, and the QA flows. The merge only added MUT-660's own files, and the uniform-file flows cover only `src/hosted/pages/invoicing/UniformFileExport.tsx`, `uniform-file.css` and the spec.

## Left before the merge into main

1. Optional: run the full server suite once on this head, through the heavy gate.
2. Take the lock with one `if mkdir /tmp/mutaba3a-locks/mini-crm-main` that also does the merge and the `rm`:
   `git -C <main checkout> merge --no-ff claude/mut-569-unified-file-2ab71d`
   There is no migration. Check :8787 first. On 2026-11-22 it was the separate `qa-api` worktree.
3. Jira MUT-569 → In Review, with a comment carrying the AC table from the session report.

## Basel's own steps

- **Simulator, for MUT-567:**
  1. Open https://www.misim.gov.il/TmbakmmsmlNew/frmCheckFiles.aspx and choose "Windows (ANSI) ISO-8859-8-I".
  2. Upload `docs/operations/tax-authority/uniform-file/fixture/INI.TXT` and `…/BKMVDATA.TXT` from **this worktree**.
  3. Save the result as `docs/operations/tax-authority/uniform-file/simulator-report-<date>.<ext>`.

  The steps are in that folder's `README.md`.
- **Production:** set `software_house_vat_id = "517108775"` and `software_house_name = "נאראבנד סטודיו בע\"מ"` in `production.tfvars` (see `docs/operations/before-release.md`). Set the registration number once MUT-567 issues it.
- **Accountant questions** (B100/B110, Arabic in Hebrew letters): MUT-567.

## Held

The worktree stays, because the simulator fixture is here. `server/node_modules` is a symlink to main's: remove it with a plain `rm`, never a trailing-slash `rm -rf`. No lock, jobs or servers are held.
