# MUT-382 — Privacy policy (and terms): say only what the code does

Epic MUT-322. Relates MUT-324 (terms), MUT-369 (Resend/Turnstile wording), MUT-375 (phone backups), MUT-439 (phone
encryption, later), MUT-385 (CMEK, later), MUT-346 (terms overlay).

## Decisions (Basel, 2026-10-25)

- **B1:** Basel's approval is enough to ship. A lawyer read is not a gate (Jira 12627).
- **B2:** the contact address is **info@mtb3a.com** everywhere: policy, terms, phone strings, runbook. *Basel sets up the inbox
  or forwarding before release.* The release checklist verifies it receives mail.
- **B3:** the terms get a **new version** in this ticket (the 2026-10-19 text says "close by writing to us", names
  info@malafat.app, and claims to cover the free app). Everyone accepts again. **MUT-346 ships first**, so accepting again keeps drafts.
- **B4:** **pin Cloud SQL backups to me-west1** (`backup_configuration.location = var.region`, main.tf:133-142), so
  the "Tel Aviv" promise becomes true. It applies to new backups; older ones age out within 14 days, and the policy ships after that apply.

## What's false or missing today (from the 2026-10-25 audit; file refs in mini-crm unless marked P = phone)

| # | Policy says (en/ar landing.json) | Reality | Fix |
|---|---|---|---|
| 1 | mobileDeletion :179 "email info@malafat.app … within 30 days" | Self-service Close my account in the portal and the phone (MUT-333); automatic purge after day 30 | Describe Close my account (portal: You › Account; phone: Settings › Account) |
| 2 | ":179 business profile … we handle those together with them" | A shared profile goes to a co-owner, or the close is blocked; your rows on surviving profiles are anonymised | Say exactly that |
| 3 | hostedAccounts :139 "we delete it and its records" | Deleted: account, owned profiles and their records and files, sessions, passkeys, terms acceptances, Stripe customer. Anonymised: your creator fields on surviving profiles. Kept: audit tombstones with a bare internal id, Stripe invoices (tax law), the email suppression entry, server log lines with the internal id | Deleted / anonymised / kept list |
| 4 | ":179 signing out and uninstalling removes MTB3A's data from your phone" | Device backups include the database until MUT-375 ships | Ship after the MUT-375 phone release; name "from version X" |
| 5 | ":139 team opens records only when…" | No technical control: shared admin token, admin audit `actorId: null`, DB proxy access, no Data Access logs | Honest wording: a small team runs the service and can technically reach the data; we only look when you ask, to fix a fault, or when the law requires; admin-tool changes are logged |
| 6 | ":139 records in me-west1" | DB, bucket, secrets and Cloud Run are me-west1; backups have no location (B4 fixes); logs use GCP defaults (_Default bucket, 30-day retention, not region-pinned) | Keep "Tel Aviv" for records and backups; state logs: Google Cloud, 30 days, may be outside Tel Aviv |
| 7 | noTracking :167 "logs … IP address" | App request lines have no IP; the Cloud Run platform log has the connecting IP (Cloudflare's, behind the front door); the real client IP goes only to in-memory rate limits and Turnstile | Say that |
| 8 | errorReports :175 "never includes … anything you type" | Scrubbed by design (shared deny-list, EU, no PII, no screenshots); native crashes rely on Sentry's server-side scrubbing; iOS extensions report too | Keep the facts, scope "we remove…", add extensions |
| 9 | hostedAccounts "PostHog only if you agree" | True for the portal and phone; the website counts without consent (cookieless) | Say both |
| 10 | usageAnalytics :171 website | It also sends page URL, referrer, UTM and device type | List them |
| 11 | sharing :159 "beyond that…" | Missing Stripe (live billing: name, email, internal id, card via Stripe Checkout) and the mailbox provider for info@mtb3a.com | Add both |
| 12 | email :147 list | Missing the account-closing and passkey-added notices (`email/ports.ts:87,92`) | Add |
| 13 | intro :127 vs noTracking :167 / terms :5 | The free local tier is retired (landing is hosted-only) | Drop the free-app mentions |
| 14 | info@malafat.app (policy :179/:191/:195, terms :87, P app_en.arb:2581,3132) | B2 | info@mtb3a.com |
| — | (missing) encryption at rest | Google-managed encryption at rest for the DB, backups and receipts (CMEK off); encrypted-only DB connections; phone: OS file encryption plus kept out of backups (MUT-375), session in Keychain/Keystore | Add a sentence. Update it when MUT-385/MUT-439 ship |
| — | (missing) sessions, passkeys, mail log | Session keeps a truncated user agent; passkey stores credential id and public key; mail log keeps a recipient hash for 30 days | Add to "what we keep" |

## Plan

1. **Policy copy:** `src/lib/i18n/translations/{en,ar}/landing.json` `landing.privacyPolicy.*`. Rewrite the sections in the table, and set
   `updated` to the ship date. Arabic is translated from the approved English (meaning-equal, not fresh copy). Drop the free-app
   sentences. `PrivacyPolicyPage.tsx` SECTION_KEYS only change if a section is added (`encryption` inside `security`, no new
   section).
2. **Checklist in the PR:** every sentence of hostedAccounts, security, sharing, errorReports, noTracking and mobileDeletion maps to a
   file:line or infra reference (ticket AC 1). Kept in `.claude/designs/mut-382-policy-checklist.md`.
3. **New terms version** `src/content/legal/terms/<date>.{en,ar}.json`:
   - closing → self-service plus the same deleted/kept wording;
   - contact info@mtb3a.com;
   - no free-app scope.

   Then:
   - the manifest appends the version (append-only);
   - `server/src/legal.ts` `CURRENT_TERMS` gets the new version and hashes;
   - `legal-terms.test.ts` freezes the new hashes.

   Release order: web first, then server (the guard checks it). Phone: nothing (it reads the version from `/v1/me`; MUT-344).
4. **Terraform B4:** `server/infrastructure/terraform/main.tf` `backup_configuration { location = var.region }`, plus a
   `terraform test` assertion. It ships with the next server release.
5. **Phone strings (flutter repo):** `app_en.arb`/`app_ar.arb` info@malafat.app → info@mtb3a.com (placeholders at :2581, :3132), plus
   gen-l10n. The runbook (`docs/operations/pilot-runbook.md` §6) and `before-release.md:37` get marked done.
6. **Tests updated, not weakened:**
   - `PrivacyPolicyPage.test.tsx` (the info@ asserts, the pinned error-report sentences, the hostedAccounts facts list gains
     'Stripe', 'Close my account', 'info@mtb3a.com', and 'info@malafat.app' must be absent);
   - `qa/specs/web/legal.spec.ts` literal sentences;
   - `qa/features/web/legal.yaml` expectations;
   - `brandName.test.ts`, `hostedOfferKeys.test.ts`.
   - Run `@web.legal.*` specs (ticket AC).

## Sequencing (all pilot-ready)

MUT-346 (overlay) → MUT-375 phone release (backups excluded) → B4 terraform apply → MUT-382 web release (policy + new terms)
→ server release (CURRENT_TERMS bump; everyone accepts again in the overlay). The policy's `updated` date = the web release day.
info@mtb3a.com must receive mail before the web release.

## NOT in scope
- Naming the operator in the admin audit, Data Access logs, a break-glass runbook (honest wording instead; possible follow-up).
- A regional log bucket (the logs sentence says where they really are).
- CMEK (MUT-385) and phone DB encryption (MUT-439): the policy changes again when they ship.

## Eng review: outside voice (Claude Plan subagent; codex not installed), folded in

**Required work that follows from B2 and B4 (no new decision):**

1. **The address really is everywhere.**
   - Phone `lib/domain/services/legal_links.dart:9` `supportEmail` (shown by sign-in and the Updated-terms screen), plus phone `qa/features/ios/{signin,terms}.yaml`, `terms_update_screen_test.dart`, and the arb `example` values.
   - Portal `src/hosted/terms.ts:26` `SUPPORT_EMAIL` (billing mailto, Turnstile link, ProfileOwnersSection), plus `qa/specs/portal/terms.spec.ts:75`.
   - **`production.tfvars:31` `mail_reply_to` → info@mtb3a.com**, plus the `variables.tf:88` description. Replies stop going to Outlook.
   - `grep -r "malafat.app"` across both repos must come back empty, apart from Malafat-product references.
   - info@malafat.app keeps forwarding for good (old app builds). That's a Basel task, on the release checklist.
2. **B4 on both instances.** `location = var.region` on `postgres` **and** `postgres_cmek`. Add it to the cmek.tftest "duplicated settings match" assert. `terraform plan` must show update in-place. Before the policy ships, record `gcloud sql backups list/describe` locations and `transactionalLogStorageState`.
3. **On-demand backups expire too.**
   - Runbook and DEPLOYMENT steps delete the on-demand backups created by `cmek-cutover.sh:397`, the post-cutover backup (`DEPLOYMENT.md:1193`) and the before-restore undo point (`pilot-runbook.md:427`) within 14 days.
   - MUT-383 notes whether it keeps a final backup.
   - The policy sentence stays "backups clear within 14 days".
4. **Terms mechanics.**
   - Add a row to `RELEASED_TERMS` in `legal-terms.test.ts`; the manifest is built from the folder.
   - The `CURRENT_TERMS` bump goes in the **same commit** as the web text (`LATEST_TERMS_VERSION === CURRENT_TERMS.version`).
   - People mid-signup are handled (`setupLink.ts:66` termsChanged).
   - Update the "backup promise" test phrases ("keep each backup for 14 days", "any moment in the last 7 days", "آخر 7 أيام") if the wording changes.
5. **Wording fixes so no claim stays false.**
   - **Uninstall (iOS):** signing out ends the session and removes server-held records (MUT-377). The sign-in token can stay in the iPhone Keychain until the app is reinstalled. Drop "uninstalling removes all data".
   - **Backups before the update:** "Copies in iCloud or Google backups made before version X can still hold the app's data until those backups are replaced."
   - **Closing:** "after 30 days" (not "on day 30"). Deleted receipt files stay recoverable for 14 days (bucket soft delete).
   - **Kept list:** Sentry events with the internal id until Sentry's retention ends; Resend's delivery records (US); the website request form in Netlify for 12 months (plus a runbook step at close); mail in the info@ inbox. PostHog holds nothing linked to the account.
   - **The portal close-account copy over-promises:** `src/hosted/i18n/en.json:126,136` ("everything in it will be deleted"), and the phone close screen too. Align both with the deleted/anonymised/kept list.
   - **IP in logs:** "usually Cloudflare's address". Cloud Run ingress is ALL and the legacy run.app host still answers. Closing it is a follow-up (TD).
   - **Sentry IP:** before keeping "never includes your IP", check "Prevent Storing of IP Addresses" on the web, portal, server and phone projects (sentry-org-settings.ts covers the org). Record the result in the checklist.
   - **Logs:** "logs about your requests are kept 30 days". Check with `gcloud logging buckets describe _Default --location=global`.
   - **Malafat sentence:** check it against the current link model and what closing does to shared Malafat data.
6. **Sequencing.** MUT-346 is not built yet (Planned). B3 waits for it.

**Open: D-min-build (asked separately).** Acceptance is only reported, never required (`server/src/routes/me.ts:110`), and phones without MUT-344 never show the step. Raising the minimum phone build (MUT-293, `minimum-build.ts` / tfvars `IOS_MIN_BUILD`/`ANDROID_MIN_BUILD`) at the server release, to the build carrying MUT-375 and the new address, makes every phone accept, stop backing up and stop showing the old address.

**B5 decided (Basel, 2026-10-25): raise the minimum phone build.** At the server release that ships the new terms, raise `IOS_MIN_BUILD`/`ANDROID_MIN_BUILD` to the phone build carrying MUT-375 and the info@mtb3a.com address (`legal_links.dart`), **only once that build is live in both stores** (DEPLOYMENT §6 rule).

## Final sequence
1. MUT-346 (portal overlay) is built and released (web + server image).
2. **Phone release X**: MUT-375 (backups excluded) plus the phone half of this ticket (`supportEmail`, tests, catalog). Live in both stores.
3. Terraform B4 (backup location, both instances) is applied with a server release. Record the backup locations. Basel sets up info@mtb3a.com and keeps info@malafat.app forwarding.
4. Web release: the policy plus the new terms text, the `CURRENT_TERMS` bump in the same commit, and portal `SUPPORT_EMAIL`.
5. Server release: the new terms are checked live, `mail_reply_to`, and min build = X. Everyone accepts again: in the portal overlay, or in the phone's Updated-terms step after updating.
The policy's `updated` date is the web release day. The checklist (`mut-382-policy-checklist.md`) is filled in and Basel approves the final EN text before the AR translation.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Outside Review | in-host Claude Plan subagent (codex not installed) | Independent 2nd opinion | 1 | unavailable (in-host fallback completed) | 20 findings, 7 high; all folded in or decided (B5) |
| Eng Review | `/plan-eng-review` (condensed) | Architecture & tests | 1 | issues_open | 14 policy defects mapped; B1–B5 decided |

- **VERDICT:** ready to implement via /eng-build MUT-382 after MUT-346 and the MUT-375 phone release.

NO UNRESOLVED DECISIONS
