# MUT-324: pre-landing review findings (/qa-reconcile → /review, pass 1, 2026-10-19)

**Branch:** `feature/mut-324-terms`, head 2405e7e1. **Base:** local `main` 9783b6f7 (32 commits ahead of origin).

**Status (updated 2026-10-19, later):** the must-fix items 1–6 and the should-fix list are fixed on `fix/mut-324-review-fixes`. Items 5–6 use Basel's wording. The INVESTIGATE items were filed as MUT-346/347/348, with the purge added to MUT-333.

**Status at pass 1:**
- **Paused at Basel's request after review pass 1, before Fix-First (Step 5).** No fixes are applied yet.
- **Not done yet:** Step 4.7 exploratory QA (the release-QA specs did run in /eng-build), the Step 5 fix question, and the /qa-reconcile verdict and Jira update.

**Coverage:**
- 9 specialists ran: testing, maintainability, security, performance, data-migration, api-contract, design, simplification, state-machines.
- Red Team ran, plus the native adversarial pass.
- Codex isn't installed, so there is no outside coverage.
- Data-migration and simplification found nothing. Security found no defects.
- The gate scan read 26 hunks; all are intended contract updates, and RH-13 is the repo's usual `no-explicit-any` pragma in a new test, so there are no gate findings.

## Must fix before merge (recommended)

1. **[CRITICAL, conf 8–9; red team + adversarial] The recorded language can differ from what the person read.**
   - **What goes wrong:** the portal records `locale`/`textSha256` from the portal's UI language. `termsHref` (`src/hosted/terms.ts:8`) opens the landing on a different origin, which defaults to Arabic and carries no language in the link. So an English-UI person can read Arabic while the record says English.
   - **Fix:** link `/terms/<version>?lang=<portal lang>` and have `TermsPage` honour `?lang` for that view without storing it. Add tests, plus a QA assertion that the opened text's language matches what's recorded.
2. **[CRITICAL, conf 9; red team] `make release full` contradicts the web-first guard.**
   - **What goes wrong:** `Makefile:267` has `release-full: release-server release-web`. The guard kills the server leg, so web never runs.
   - **Fix:** reorder to `release-web release-server` and log an override of the 2026-10-12 server-first addendum in ADR-102.
3. **[CRITICAL, conf 8; red team] The guard runs after the version bump, commit and push.**
   - **What goes wrong:** the guard is in `deploy.sh`, so a refusal leaves a pushed `release: api vX` commit with nothing deployed (and Netlify builds main).
   - **Fix:** move `terms:check-live` into `scripts/preflight.sh`, the server preflight before bump-version.
4. **[conf 7; multi-source: testing + api-contract + state-machines + adversarial + red team] `TermsUpdatePage` doesn't recover from a stale version.**
   - **What goes wrong:** `TermsUpdatePage.tsx:31-34` swallows a 409 `TERMS_VERSION_STALE` and retries the stale version forever. It also overwrites newer Me data (`{...me, terms}`), and an in-flight `/v1/me` refetch can undo the acceptance.
   - **Fix:** on `TERMS_VERSION_STALE`, invalidate `ME_KEY`. Write with an updater and `cancelQueries` first. Add tests for 409 then retry, and for Sign out on the step.
5. **[conf 7; red team] Privacy text promises more than the infrastructure does.**
   - **What goes wrong:** the privacy text says "restore your records to any point in that time" (14 days), but `transaction_log_retention_days = 7` (`server/infrastructure/terraform/main.tf:110`).
   - **Fix:** reword to "daily backups kept 14 days; point-in-time recovery for 7". Basel must confirm, since it's published text.
6. **[conf 7; red team] Terms §10 can't be kept as written, and the text is frozen once released.**
   - **What goes wrong:** §10 says "we'll ask you … the next time you sign in", which is false for phone-only users until MUT-344 ships.
   - **Fix:** reword before release, e.g. "the next time you open your account on the web, or by email". This is Basel's text decision.

## Should fix in this branch (informational, mechanical)

- **Layout:** the setup checkbox sits inside `.hp-field`, so `.hp-field label` breaks `.hp-check-row`'s flex layout. Move it out, or raise the rule's specificity (design, conf 8).
- **Spacing:** multi-paragraph legal sections have no gap between paragraphs. Add `.privacy-policy-section p + p { margin-top }` (design, conf 9).
- **Link underline:** links in running text aren't underlined (setup checkbox link; the missing-version page). Same axe rule as MUT-188 (design, conf 7).
- **Support email:** make it a `mailto:` link wrapped in `<bdi>` (design).
- **Deploy guard message:** `check-terms-live.ts` swallows fetch errors into "release web first". Report the HTTP status or the error instead (maintainability, conf 7).
- **Build robustness:** the manifest plugin throws on non-`.json` files such as `.DS_Store`. Filter them out first (maintainability + adversarial).
- **Stale docblock:** `recordTermsAcceptance` sits between `snapshot()` and its JSDoc in `memory.ts`. Move it (maintainability, conf 9).
- **Helper location:** move `staleTerms` into `terms-acceptance.ts` (maintainability).
- **Loading prop:** give `LegalPage` an explicit `loading` prop instead of the `updated === undefined` sentinel (maintainability).
- **OpenAPI nullability:** `TermsStatus` is declared nullable in OpenAPI because the shared ref is nullable. Make only `Me.terms` nullable (api-contract, conf 8).
- **Frozen texts:** `legal-terms.test.ts` pins only the current version. Add a `RELEASED_TERMS` table that freezes every released version (testing).
- **Missing tests:**
  - a cross-site 403 and a 422 for `POST /v1/me/terms-acceptance`;
  - a Postgres contract test for `listLatestTermsVersions`;
  - the Arabic governing-law clause;
  - turning the duplicate setup test into the `termsLocale: 'ar'` case (testing).
- **Performance:**
  - `termsAcceptedAudit` is an N+1;
  - the accept route re-reads `latestTermsAcceptance`;
  - `buildMe` awaits the terms lookup in sequence. Run it with `Promise.all` (performance, conf 5–7).
- **Setup loop:** `SetupPage` with `current: null` resends the stale version. Refetch the check instead (state-machines + adversarial).

## Needs a product decision (INVESTIGATE)

- **Drafts lost on a bump:** when a version bump lands, the next focus refetch swaps the whole Outlet, so any open drawer loses its draft (`AuthGate.tsx:35`). Options: show the step only at boot or sign-in, or as an overlay.
- **Audit rows survive closure:** `user.terms_accepted` audit rows outlive account closure, which contradicts the "deleted with the account" promise. Add the purge to MUT-333's scope.
- **Staging can't deploy on its own:** the guard always checks the prod public site, even for a staging deploy. Use a per-environment origin.
- **Rollback check uses the wrong version:** with `IMAGE_TAG=` (a rollback), the guard checks the working tree's `CURRENT_TERMS`, not the image's.
- **Server enforcement:** acceptance is enforced on the portal only (TD-180, D7, already decided).
- **Hash covers the file only:** `textSha256` covers the JSON file, not how `TermsPage` renders it.
- **Firm-only members:** members who own no profile get no audit row; the acceptance row is their only evidence.

## Untested state cells (state-machines, conf 3–5: appendix)

- **Setup redeem:** dead links (expired, superseded, invalid) with a stale version; a reset after a bump.
- **Accept route:** stale on each acceptance state.
- **Updated-terms step:** after-failure retry and sign-out.
- **Setup page:** after-terms-changed submits.

The state matrix is in `.gstack/tmp/state-machines.7ced92e39895.md`.

## Resume

1. Ask Basel the Step 5 fix question:
   - items 1–4 and the "should fix" list as AUTO-FIX or ASK;
   - items 5–6 as his text decisions;
   - the INVESTIGATE items as decisions or follow-up tickets.
2. Apply the fixes, writing the tests first, then rerun the full gate and the release-QA specs (`qa/.state/mut324.playwright.config.ts`).
3. Re-review (pass 2) until it converges.
4. Then give the /qa-reconcile verdict, comment on Jira MUT-324 and move it to In Review.
