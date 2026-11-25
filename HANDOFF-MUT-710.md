# MUT-710 handoff (two-step sign-in + 12-month auth logs)

Branch `claude/mut-710-2fa-336415`. Nothing merged or pushed. Server half is already on main (merged by Basel via release/1123-pass, ADR-274, API 1.135.x); this branch carries the portal half.

## Done (2026-11-25)
- main brought in (conflict in hosted.css only, both kept).
- Portal screens (commit 116652e9 WIP, now green): sign-in second step, setup/reset step, Malafat return, You > Account row + TwoFactorDrawer, issuing prompt, ar/en. Tests: `src/hosted/twoFactor` + `pages/auth` 209 pass; root typecheck clean; eslint clean on the touched dirs.
- QA specs written: `qa/specs/portal-selfservice/two-factor.spec.ts` (5 flows, live API) and `qa/specs/portal/two-factor.spec.ts` (issuing-required). `release-qa lint` clean (0 unmapped).
- `portal.two-factor.issuing-required` RECORDED AND PASSED (`release-qa run --attach`, run page qa/runs/after-web-v0.4.0_api-v0.21.0).
- The 5 live flows (`portal-selfservice.two-factor.*`) have NOT been run yet: stopped at the disk gate (free space fell to 11 GB, other sessions).

## Done (2026-11-25, second session)
- Live flows `portal-selfservice.two-factor.{enrol-app,sign-in en+ar,recovery-code,email,reset}`: 6/6 pass on a private stack (:8797), run `qa/runs/after-web-v0.4.0_api-v0.21.0/runs/20261125-174035` (main checkout). Fixed on the way: two-step routes now `open` in the lapse gate (da6557f1), /setup passkey step after the sign-in second step (da6557f1), the QA helper's 201.
- Full suite fixes (7b074660): issuing prompt without router/Me when not needed, QR Canvas, DIR_SITES.
- Checks: server typecheck/lint/openapi:check/test green; root lint/typecheck/test:run/build green; `test:db` 8686/8687 (the 1 is TD-330, operator search contract, pre-existing).
- Phone half: mutaba3a-flutter branch `claude/mut-710-2fa-phone` (worktree `.claude/worktrees/mut-710-2fa-phone`), commit bb3217ab+; `ios.auth.two-factor-sign-in` and `ios.issuing.two-factor-required` pass (run `qa/runs/after-iosv0.1.19_12/runs/20261125-175913` in the Flutter main checkout).

## Next
- Basel: review and merge both branches (nothing merged or pushed). After the phone release, raise IOS_MIN_BUILD / ANDROID_MIN_BUILD (TD-335).
