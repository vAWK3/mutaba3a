# MUT-710 handoff (two-step sign-in + 12-month auth logs)

Branch `claude/mut-710-2fa-336415`. Nothing merged or pushed. Server half is already on main (merged by Basel via release/1123-pass, ADR-274, API 1.135.x); this branch carries the portal half.

## Done (2026-11-25)
- main brought in (conflict in hosted.css only, both kept).
- Portal screens (commit 116652e9 WIP, now green): sign-in second step, setup/reset step, Malafat return, You > Account row + TwoFactorDrawer, issuing prompt, ar/en. Tests: `src/hosted/twoFactor` + `pages/auth` 209 pass; root typecheck clean; eslint clean on the touched dirs.
- QA specs written: `qa/specs/portal-selfservice/two-factor.spec.ts` (5 flows, live API) and `qa/specs/portal/two-factor.spec.ts` (issuing-required). `release-qa lint` clean (0 unmapped).
- `portal.two-factor.issuing-required` RECORDED AND PASSED (`release-qa run --attach`, run page qa/runs/after-web-v0.4.0_api-v0.21.0).
- The 5 live flows (`portal-selfservice.two-factor.*`) have NOT been run yet: stopped at the disk gate (free space fell to 11 GB, other sessions).

## Next
1. When `df -g /` >= 20: start the private live stack and run the live flows:
   `S=<scratch>/noocr` (a dir with a `tesseract` script that exits 1, so no OCR sidecar starts), then
   `PATH=$S:$PATH QA_SELFSERVICE_API_PORT=8797 QA_SELFSERVICE_OCR_PORT=8798 MALAFAT_STUB_PORT=3951 node qa/support/selfservice-live.mjs &` (8795 was held by another session; it makes its own DB `mutaba3a_qa_selfservice_<pid>` on mutaba3a-test-pg and drops it on SIGTERM; kill by pid, not pkill).
   Then `QA_SELFSERVICE_API_PORT=8797 MALAFAT_STUB_PORT=3951 heavy --light -l "MUT-710 qa" -- release-qa run --attach --only portal-selfservice.two-factor`. Fix specs from failures (the reset flow's post-setup second step and the recovery notice text are the guesses).
2. Phone half: Flutter worktree in /Users/basel/Work/Barmajiyat/Mutaba3a/mutaba3a-flutter/mutaba3a (not created: disk gate). `domain/services/auth_service.dart` finish+resend, second step beside `email_code_step.dart`, Malafat repo, settings > two-step screen, issuing prompt, error codes in `core/errors.dart`; `ios.auth.two-factor-sign-in`, `ios.issuing.two-factor-required`.
3. Full server suite + `test:db` (never run on this branch; server code is unchanged here, main has it), root `npm run lint` and `test:run`.
4. Jira MUT-710 comment with the AC table and evidence (not yet posted); keep it In Progress.

## Outside git
- Test DB `mutaba3a_test_mut710` (mutaba3a-test-pg, :54329): drop when finished.
- Root `node_modules` symlink to main's (rm it), `server/node_modules` APFS clone (672 MB): delete when done.
- Node 22: `$HOME/.nvm/versions/node/v22.23.1/bin` (homebrew node@22 is really 26).
