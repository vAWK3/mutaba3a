# MUT-468: the new mail frame (colour, icons, header art) for the 13 customer mails

Epic MUT-466 · blocked by MUT-467 (art and frame delivered, see §1) · blocks MUT-469 (welcome)
Status: PLAN, waiting for Basel's approval. No code written.

## 1. Inputs and decisions

- **Frame:** Claude Design export 4, `MTB3A Frame Mockup 1b.html`, approved variant **1b "full-bleed"**. The mood tint runs edge to edge, the wordmark and header art are centred on it, and the white card rises out of the band with the chip and headline where the two colours meet.
- **Art:** the 34 PNGs on `feature/mut-467-mail-kit-assets` (22fef962) plus export 4's `chip-client-hello-2x.png` (used by MUT-469). Export 4's four store badges are redrawn, not Apple's and Google's official files, so they stay out; MUT-469 owns the badges.
- **D1 (Basel, 2026-10-27): plan now.** MUT-467's only leftover is the badges, which MUT-469 needs, not this ticket.
- **D2 (Basel): adopt the mockup's copy, corrected.** Every mail gets a headline, an inbox preview line, a body, one button and a note, in the mockup's shape. The mockup's facts are wrong in many places; §4 is the corrected copy and the only source.
- **D3 (Basel): footer = the "we never ask for your password" line + "sent to <recipient>" + a Privacy link.** There is no help centre, so no Help link.
- **D4 (eng review R1/D2, Basel 2026-10-27): the art is served by the portal, at `<PORTAL_ORIGIN>/mail/v1/<file>`** (app.mtb3a.com), not by the website. The API serves the portal build (`server/src/app.ts:646-663`), so the art ships in the same `api-v*` release as the mail code and never depends on Netlify (mtb3a.com answered 401 on every path on 2026-10-26). `PORTAL_ORIGIN` already exists (`config.ts:88`, set by Terraform `domain.tf:36`). The Privacy link needs the website, so one small new setting stays: `WEBSITE_ORIGIN`, set by Terraform to `https://<domain>` from `config/hosts.json` at stage live, like `WEBAUTHN_RP_ID`. `scripts/__tests__/no-hardcoded-hosts.test.ts` forbids writing either host anywhere else. Unset `PORTAL_ORIGIN` (development, tests) = no images, which is also the images-off path; unset `WEBSITE_ORIGIN` = no Privacy link.
- **D5 (amended by R1): the PNGs move from `assets/email/` to `src/hosted/public/mail/v1/`**, the portal build's public dir (`vite.config.ts:561`), so `dist-hosted/mail/v1/<file>` needs no build step and there is one copy of each file. `v1` is the version: changed art goes in `v2/`, and `v1/` is never deleted because sent mails keep pointing at it. `assets/email/README.md` folds into this brief.
- **D6 (this plan): inline styles only, no `<style>` block.** The existing test that pins "no `<style>`" stays. So there are no phone-specific sizes: the art is a fixed 150 px (fits a 375 px screen) and the button is as wide as its label. The mockup's 120 px art and full-width button on phones need a media query; dropped.
- **Override log:** the MUT-359 brief's §3.3 / §8.4 "no images, no pixels, nothing fetched" is replaced by a new ADR (the next free number at build time; ADR-212 is the latest on main). Only static, versioned PNGs from `<PORTAL_ORIGIN>/mail/v1/` are allowed: the same URL for every recipient, no query string, no per-person part. ADR-159 §5 (no amounts, currencies or money dates; the deletion day of `account-closing` excepted) is unchanged.

## 2. Where the code goes

| File | Change |
|---|---|
| `server/src/email/templates/look.ts` (new) | `MOODS` (band, panel and art-cell colours for hello / safety / trial / goodbye), `ART` (file names and alt text in both languages, with the `-rtl` variant where one exists), `CHIPS` (icon file and alt per mood), and `LOOK: Record<CustomerTemplateId, { mood, header, chip }>`, the per-mail mapping in §3. `review-digest` has no look, so it renders plain. |
| `server/src/email/templates/layout.ts` | Rewritten to frame 1b. `MailBody` gains `headline`, `preheader`, optional `details: { label, value: Inline }[]`; `intro` is the body and `outro` is the note under a rule. `renderLayout(locale, body, frame)` with `frame = { look?: Look; to: string; artOrigin?: string; websiteOrigin?: string }`. It keeps escaping everything, `checkedHref`, the button plus the raw link in `<bdi dir="ltr">`, and the text part. |
| `server/src/email/templates/copy.ts` | §4's copy for the 13 mails (en + ar). `review-digest` is unchanged apart from the new fields being empty. |
| `server/src/email/templates/index.ts` | `renderMail(template, locale, vars, { to, artOrigin, websiteOrigin })`. |
| `server/src/email/mailer.ts` | Passes `to`, `options.artOrigin` and `options.websiteOrigin` to `renderMail` (its only caller, line 85). |
| `server/src/config.ts` + `index.ts` | `WEBSITE_ORIGIN: z.string().url()`, https origin only (no path). Production with `MAILER=resend` refuses to start without `PORTAL_ORIGIN` (fail fast, like `MAIL_FROM_ADDRESS`). Built: `WEBSITE_ORIGIN` stays optional, as §7 requires (a release before `terraform apply` only drops the Privacy link). Both wired into `createMailer`'s options as `artOrigin` and `websiteOrigin`. |
| `server/.env.example`, `server/README.md` | Documents it. |
| `server/infrastructure/terraform/domain.tf` | `WEBSITE_ORIGIN = "https://${local.domain}"` from stage live, next to `WEBAUTHN_RP_ID`. |
| `src/hosted/public/mail/v1/*.png` | `git mv` from `assets/email/` (34 files + the client chip). |
| `server/src/app.ts` | The portal's immutable cache (`:660`) covers hits under `/mail/` as well as `/assets/`. A miss still falls through to the SPA shell with `no-store`, as today. |
| `server/src/scripts/mail-preview.ts` + `npm --prefix server run mail:preview` | Writes all 13 mails × 2 languages (images on and off) to `server/.mail-preview/` (gitignored) for review in a browser. `--send <address>` sends them through the configured transport, for the client checks in §6. |
| `docs/operations/before-release.md` | Release order (§7). |
| Knowledge files | DECISIONS (the ADR + override log), CHANGELOG, PATTERNS (mail look per template), TECH_DEBT if any, TEST_PLAN. |

## 3. Look per mail (from the approved mockup)

| Mail | Mood | Header art | Chip |
|---|---|---|---|
| finish-signup | hello | `spot-email` | email |
| finish-setup | hello | `empty-state` | edit |
| account-under-review | hello | `spot-pending` | pending |
| account-ready | hello | `milestone-firm` (rtl in Arabic) | success |
| reset-password | safety | `spot-lock` | password |
| password-changed | safety | `spot-lock` | lock |
| passkey-added | safety | `spot-badge` | badge |
| account-exists | safety | `spot-person` | person |
| trial-ending-soon | trial | `spot-calendar` | calendar |
| trial-ended | trial | `spot-schedule` | schedule |
| trial-locking-soon | trial | `spot-lock` | lock |
| account-declined | goodbye | `empty-state` | info |
| account-closing | goodbye | `destructive-confirmation` (rtl in Arabic) | delete |

Colours: hello band `#FBE5D1` / panel `#FDF1E6`; safety `#EAE4F6` / `#F4F1FA`; trial `#DFEBF1` / `#EEF4F7`; goodbye `#ECE7E1` / `#F5F1EC`. Inks, link, button and surface as today (`#392F4B`, `#564E68`, `#4D387E`, `#FFFCF7`). The details-panel labels are ink and bold, not secondary ink (see §5 test 6).

## 4. Corrected copy (English; Arabic is written alongside in `copy.ts`)

What the mockup got wrong and the plan does not take: `mtb3a.app` links (an unregistered domain, refused by `UNOWNED_DOMAINS`) and routes that don't exist (`/verify`, `/status`, `/plans`, `/security`, `/owed`); review "for firm accounts within one working day" (it is personal email addresses, within two working days); "Check status", "Secure my account", "Choose a plan" and "Visit the help centre" buttons with no page behind them; times, devices and calendar dates in the security and trial mails (ADR-159 §5; the server has no device data). Every link below is one the template already receives.

| Mail | Headline | Inbox preview | Body (summary; today's facts) | Button | Note |
|---|---|---|---|---|---|
| finish-signup | One step left: set your password | Set a password and your account is ready. | Someone, hopefully you, asked to create an MTB3A account with this address. Set your password to finish. The link works once and expires in {validHours}. | Set your password | Didn't sign up? Ignore this email. Nothing happens until the link is used. |
| finish-setup | Your account is almost ready | Set a password to start. | Your MTB3A account is waiting for you to set a password. The link works once and expires in {validHours}. | Set your password | (same ignore note) |
| account-under-review | We're reviewing your account | We'll email you within two working days. | Thanks for creating an MTB3A account. We review new accounts that use a personal email address before they open. We'll email you within two working days; there's nothing you need to do meanwhile. | none | none |
| account-ready | Your account is ready | We approved your account. | Good news: we approved your account. Sign in to start. | Sign in | none |
| reset-password | Set a new password | The link works once, for {validHours}. | Someone asked to set a new password for this account. Your current password keeps working until the new one is set. The link works once and expires in {validHours}. | Set a new password | Didn't ask for this? Ignore this email and your password stays the same. |
| password-changed | Your password is set / Your password was changed | If this was you, there's nothing to do. | The password for your MTB3A account was just set, and you can sign in with it now / was just changed, and your other devices were signed out. If this was you, there's nothing else to do. | Sign in | If this wasn't you, set a new password from the sign-in page right away, then reply to this email so we can help. |
| passkey-added | A passkey was added | It can sign in without your password. | Details panel: Passkey = "{passkeyName}". A passkey was just added to your MTB3A account; it can sign in without your password. If this was you, there's nothing else to do. | Sign in | Not you? Sign in, change your password, then remove this passkey from Passkeys. Reply to this email if you need help. |
| account-exists | You already have an account | Sign in instead of signing up. | Someone asked to create an MTB3A account with this address, but you already have one. If it was you, sign in, or set a new password if you've forgotten it. | Sign in · secondary: Forgot your password? | If this wasn't you, ignore this email. Nothing has changed. |
| trial-ending-soon | Your free trial ends within {daysLeft} | Add a card so nothing stops. | After that your account becomes read-only: you can still see and download everything, but you can't add or change anything until you subscribe. | Add a card | Your records stay safe whatever you decide. |
| trial-ended | Your account is read-only | You can still see and download everything. | Your free trial has ended, so your account is now read-only. Your records are safe: you can see and download all of them. Subscribe to keep adding them. | Subscribe · secondary: Download my records | Nothing is deleted. |
| trial-locking-soon | Your account locks within {daysLeft} | Nothing is deleted when it locks. | After that you can only subscribe or download your records. You can still download all of them, now or after the lock. | Subscribe · secondary: Download my records | Nothing is deleted. |
| account-declined | We couldn't approve your account | About your account request. | We couldn't approve your account request, so we removed it. No data was kept. If you think this is a mistake, write to us at {supportAddress}. | none | none |
| account-closing | Your account will be deleted on {deleteOn} | You can still sign in and keep it. | Details panel: Deletion day = {deleteOn}. You closed your MTB3A account. We'll delete it, with all its records and receipts, on that day. Until then you can sign in and keep it. After that it can't be recovered, and the copies in our backups expire two weeks later. | Sign in to keep my account | If you didn't close it, sign in, keep your account and change your password. |

Subjects stay as today (they are tested and already in people's inboxes). Counts keep MUT-419's "within N days" and the Arabic counted-noun helpers (`arDays`, `arHours`).

## 5. Tests first (TDD), all in `server/src/email/__tests__/`

`templates.test.ts` (rewritten where the old rules change, everything else kept):
1. With no `artOrigin`, no mail has an `<img`. With one, every `<img src>` is `<artOrigin>/mail/v1/<file>` for a file named in `look.ts`, with a non-empty `alt` in the mail's language plus `width` and `height`. `<style>`, `<script>`, `<link>`, `url(` and `background-image` are still refused.
2. Links: every `http(s)` URL is either one passed in the vars, a `mail/v1` art URL, or `<websiteOrigin>/privacy?lang=<locale>`. With `websiteOrigin` unset there is no Privacy link.
3. Arabic uses the `-rtl` file for `milestone-firm` and `destructive-confirmation`; English never does.
4. Every customer mail has a headline (an `<h1>`) and a hidden preview line before it. `review-digest` has neither art nor chip.
5. The footer has the recipient inside `<bdi dir="ltr">`, escaped, and the password line.
6. Contrast, computed in the test: every text colour the layout puts on a background reaches 7:1 (AAA). Measured while planning: the ink `#392F4B` is 10.1–11.3 on every band and panel, and the link `#4D387E` is 7.8–8.7. The secondary ink `#564E68` is only 6.3–6.4 on the bands and 6.95 on the goodbye panel, so **the secondary ink appears only on the white surface** (7.64), and the bands and panels carry ink-coloured text only. The test enforces that pairing.
7. Every rendered html is under 100 KB (Gmail clips at 102 KB).
8. **Regression contract (R2/D3):** `templates.test.ts:49-170` stays unchanged except `:65-75`, which tests 1–2 replace; all 13 × 2 subjects are asserted byte-for-byte against today's; the text part has every link and details row. The existing rules still hold: no amount, currency or digit except the declared counts and the deletion day; Arabic `dir="rtl"`; escaping (including a hostile recipient address and passkey name); non-http links throw; first password vs change; Arabic counted nouns; MUT-419's "within".
9. `account-closing` and `passkey-added` show their details panel; no other mail does.

New `look.test.ts`: every customer template has a look; every file `look.ts` names exists in `src/hosted/public/mail/v1/`, starts with the PNG signature and is under 40 KB.
`mailer.test.ts`: the mailer passes the recipient, `artOrigin` and `websiteOrigin` to the render.
`server/src/__tests__/config.test.ts`: `WEBSITE_ORIGIN` accepts an https origin, refuses http and a path; production with `MAILER=resend` refuses to start without `PORTAL_ORIGIN` or `WEBSITE_ORIGIN`.
`server/src/__tests__/app*.test.ts` (the portal-serving test): a hit under `/mail/` gets the immutable header; a miss under `/mail/` gets the SPA shell with `no-store`, never a cached broken response.

Command: `npm --prefix server test -- src/email` while iterating, then §8's full checks.

## 6. Release-QA (CLAUDE.md Phase 5)

QA scenario "the signup mail is on brand": sign up on the portal (Arabic), open the finish-signup mail from the dev outbox, and see the hello tint, the envelope art and chip, the headline, one button and the footer, right to left; then the same mail with images off still reads fully.

- `qa/features/portal-selfservice/mail.yaml`: feature `mail-frame`, `tier: extended`, paths `server/src/email/templates/**`, `public/mail/**`.
- `qa/specs/portal-selfservice/mail.spec.ts`, tagged `@portal-selfservice.mail.mail-frame`: reuses `qa/support/selfService.ts`'s outbox reader. The QA API serves the built portal on its own origin (`selfService.ts:10`), so with `PORTAL_ORIGIN` set to that origin the images load in the recording; the spec also requests one art URL and expects `image/png` with the immutable header.
- Run once until it passes: `release-qa run --attach --only mail-frame`. `release-qa lint` clean.

**Hand checks (the ticket's client criterion, Basel or a session with the key):** `npm --prefix server run mail:preview -- --send <test inbox>` from a machine with the Resend key, then check Gmail web and app, Apple Mail light and dark, Outlook web and desktop, each with images on and off. Outlook desktop shows square corners (no `border-radius`); that is accepted.

## 7. Release (before-release.md)

One `api-v*` release carries the art and the frame together (R1). Its `terraform apply` (run by deploy.sh) adds `WEBSITE_ORIGIN`; until then mails go out without the Privacy link, nothing else changes. After the release, check one file: `curl -sI https://app.mtb3a.com/mail/v1/mail-header-hello-spot-email-2x.png` returns 200, `image/png` and the immutable `Cache-Control`, not the SPA's HTML.

## 8. Definition of done

Root: `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build` (Node 22). Server: `npm --prefix server run typecheck`, `lint`, `openapi:check` (expected no change) and `npm --prefix server test`. All heavy commands go through `~/Work/tools/heavy-gate/heavy`. Release-QA spec passing; knowledge files updated. Ticket → In Review only after `/qa-reconcile MUT-468`.

## 9. Risks

- **MUT-460 (In Progress, another session)** changes the review digest (a portal link). It touches `copy.ts` and `TemplateVars['review-digest']`. The digest stays plain here; whichever lands second takes a small rebase in `copy.ts`.
- **Copy review:** about 26 new strings (13 mails × headline and preview × 2 languages) plus reworded bodies. Basel reviews the Arabic in `mail:preview` before merge.
- **Gmail image proxying** caches the art; that's why `v1` is immutable.
- **A broken portal release** now takes the art down with it; it takes the portal and the API down too, so the art is no worse off than the product.
- **Images blocked by default** (Outlook desktop): the tint, headline, button and footer carry the mail; alt text names each picture.

---

# Eng review (/plan-eng-review, 2026-10-27)

Target: this file, `.claude/designs/mut-468-mail-frame.md` (MUT-468 plan). Report file: this file.

## Scope record

Feature answers: none proposed (no cuts). Structure: D1 = A) Original arrangement (Basel, 2026-10-27). Accepted scope: §2 as written (look.ts + look.test.ts + mail:preview). Pending remedies: R1.
Scope Challenge result: scope accepted as-is.

## Factual corrections (no behaviour change, no question)

- **F1** [INFORMATIONAL] (confidence: 10/10) plan §4 claimed `mtb3a.app` is "refused by `UNOWNED_DOMAINS`". `server/src/email/ports.ts:168` reads `export const UNOWNED_DOMAINS: readonly string[] = ['mutaba3a.app'];`. Corrected: `mtb3a.app` is simply not our domain; every link in §4 is one the template already receives, so no mail carries it.
- **F2** [INFORMATIONAL] (confidence: 9/10) plan §2 says the text part is unchanged, but §4 moves the passkey name and the deletion day into a details panel. `copy.ts` today puts `passkeyName` in the intro (`['A passkey named “', passkeyName, '” was just added…']`). Corrected: the text part prints each details row as `Label: value`, so plain-text readers keep the passkey name and the deletion day. Test: §5 test 9 also asserts the text part.
- **F3** [INFORMATIONAL] (confidence: 8/10) `MailBody` serves the digest too. Corrected: customer templates return a body whose `headline` and `preheader` are required by type, and `LOOK` is a `Record<CustomerTemplateId, Look>`, so a new customer template without a look or headline fails to compile; `review-digest` returns the plain body.

## Decision ledger

### R1: where the mail art is served from
Finding: A1 [CRITICAL] (confidence: 8/10) plan §1 D4/D5 and §7, reviewer: Claude (eng review). The art is served from the website, `https://mtb3a.com/mail/v1/`, which ships separately from the API. Two failures follow: (1) the API can release before the website and send broken images; (2) any website outage breaks the art in every mail already sent. That happened on 2026-10-26: mtb3a.com answered 401 on every path (Netlify credits, then team login; memory release-2026-10-26-web-0-3-0-api-0-9-0).
Plan baseline: art on the website host (Basel's intake answer "Hosted PNGs: static PNGs on mtb3a.com", 2026-10-27), new setting `MAIL_SITE_ORIGIN` for art + Privacy link, release order by runbook (§7).
Runtime evidence: `server/src/app.ts:646-663` already serves every file in the portal build (`serveStatic({ root: distDir })`) and sets `Cache-Control: public, max-age=31536000, immutable` on hits under `/assets/`. The portal build's public dir is `src/hosted/public` (`vite.config.ts:561`, not created yet). `PORTAL_ORIGIN` is already set by Terraform (`domain.tf:36`) and known to the server (`config.ts:88`). The QA API serves the built portal on one origin (`qa/support/selfService.ts:10`).
Comparison grid:
| Choice | Current (plan) | A) Portal | B) Website + preflight | C) Website, runbook only |
|---|---|---|---|---|
| Art URL | `https://mtb3a.com/mail/v1/<file>` | `<PORTAL_ORIGIN>/mail/v1/<file>` (app.mtb3a.com) | `https://mtb3a.com/mail/v1/<file>` | same as plan |
| Files live in | `public/mail/v1/` | `src/hosted/public/mail/v1/` | `public/mail/v1/` | `public/mail/v1/` |
| Ships with | web-v* release | api-v* release (same image as the mail code) | web-v* release | web-v* release |
| Release-order guard | runbook | none needed | API release fails unless one art URL answers 200 image/png | runbook |
| Website outage | breaks art in all sent mails | no effect | breaks art in all sent mails | breaks art in all sent mails |
| Cache header | netlify.toml `/mail/*` | `/mail/` prefix added beside `/assets/` in app.ts | netlify.toml | netlify.toml |
| New setting | `MAIL_SITE_ORIGIN` (art + Privacy) | `WEBSITE_ORIGIN` for the Privacy link only; art uses `PORTAL_ORIGIN` | `MAIL_SITE_ORIGIN` | `MAIL_SITE_ORIGIN` |
| Images in QA recordings | need a website preview | load by themselves | need a website preview | need a website preview |
| Images-off fallback, tests, copy, D1–D3 | unchanged | unchanged | unchanged | unchanged |
Question D2:
D2 — Serve the mail pictures from the portal instead of the website?
Project/branch/task: MUT-468 mail frame on feature/mut-467-mail-kit-assets.
ELI10: Every mail will point at picture files on a web server. The plan puts them on the website (mtb3a.com), which ships separately from the code that sends mails. If the website is down or released late, every mail ever sent shows broken pictures. That happened on 26 October: mtb3a.com answered "unauthorised" on every page for a while. The portal (app.mtb3a.com) is served by the API itself, so pictures there ship in the same release as the mail code and don't depend on Netlify. This reopens one detail of your intake answer ("on mtb3a.com"); the rest of it (hosted static PNGs, same URL for everyone) stays.
Stakes if we pick wrong: a Netlify hiccup or a mis-ordered release puts broken-image boxes into every customer's inbox at once.
Recommendation: A) Portal because the pictures then ship and fail together with the code that sends them, and the server already serves and caches portal files.
Completeness: A=10/10, B=8/10, C=6/10
Net: one prefix in app.ts and a different folder remove a whole class of outage.
Header: Art host
Options:
A) Portal (recommended)
Art in src/hosted/public/mail/v1/, served by the API at <PORTAL_ORIGIN>/mail/v1/ with the existing immutable cache (add /mail/ beside /assets/ in app.ts). Ships in the same api-v* release as the mail code; no release order, no Netlify dependency. A small WEBSITE_ORIGIN setting stays for the Privacy link only. Human ~2 h / CC ~10 min more than the plan.
B) Website + preflight
Keep mtb3a.com/mail/v1/. The API release fails unless one art URL answers 200 image/png. Fixes the release order; a website outage still breaks the art in every sent mail. Human ~3 h / CC ~15 min.
C) Website, runbook only
The plan as written: mtb3a.com/mail/v1/ and the release order in before-release.md. Cheapest; both failure modes stay open, guarded only by a person following the runbook.

State: approved
Actual answer: A) Portal (Basel, D2, 2026-10-27)
Accepted scope: art in `src/hosted/public/mail/v1/`, served at `<PORTAL_ORIGIN>/mail/v1/` with the portal's immutable cache extended to `/mail/` in `server/src/app.ts`; ships in the api-v* release with the frame; `WEBSITE_ORIGIN` (Terraform, stage live) for the Privacy link only; plan §1 D4/D5, §2, §5, §6, §7 amended accordingly. Images-off fallback, tests, copy and D1–D3 unchanged.
History: Plan baseline was website host + `MAIL_SITE_ORIGIN` + runbook order (intake answer). Reopened for the 2026-10-26 mtb3a.com 401 outage.

### R2: regression contract for the layout rewrite
Finding: T1 [CRITICAL] (confidence: 9/10) plan §2 "layout.ts | Rewritten to frame 1b", reviewer: Claude (eng review). Rewriting the only mail renderer puts every guarantee `templates.test.ts` pins today at risk (subjects, `lang`/`dir`, links in `<bdi dir="ltr">`, no digits or currency, escaping, non-http links throw, Arabic counted nouns, MUT-419's "within").
Plan baseline: §5 test 8 keeps "the existing rules"; the no-images assertion (`templates.test.ts:65-75`) is replaced by tests 1–2. Not yet approved as a contract.
Runtime evidence: `server/src/email/__tests__/templates.test.ts:49-170` holds those assertions today (read in this review).
Comparison grid:
| Choice | Current | A) Behaviour contract | B) Contract + golden snapshots |
|---|---|---|---|
| Existing assertions :49-:170 | in place | all kept unchanged except :65-75, which tests 1–2 replace | same as A |
| Subjects | tested by content | byte-for-byte unchanged, asserted for all 13 × 2 | same as A |
| Text part | links tested | every link + every details row present (F2) | same as A |
| Golden html files | none | none | 28 committed html snapshots, updated on every copy or layout change |
| Copy (§4), look, D1–D2 | approved/accepted | unchanged | unchanged |
Question D3:
D3 — How should the rewrite prove it broke nothing?
Project/branch/task: MUT-468 mail frame on feature/mut-467-mail-kit-assets.
ELI10: Today's mail tests check rules, not pictures of the output: every link is copyable, Arabic reads right to left, no money or dates sneak in, odd input is escaped. The rewrite replaces the code those tests protect. A) keeps every one of those rules unchanged (only the old "no images" rule is replaced by the new image rules) and adds that subjects stay word-for-word. B) also saves the full HTML of all 28 mails as reference files and fails on any difference.
Stakes if we pick wrong: without a firm contract, a quiet slip (a link no longer copyable, a stray digit) ships to every customer; with snapshots, every copy tweak becomes a 28-file update that reviewers rubber-stamp.
Recommendation: A) Behaviour contract because the rules catch the regressions that matter, and snapshots would be rewritten wholesale by this very change and then by every copy edit.
Completeness: A=9/10, B=10/10
Net: rules that survive copy edits versus byte-exact files that don't.
Header: Regression
Options:
A) Behaviour contract (recommended)
Keep templates.test.ts :49-:170 unchanged except :65-75 (replaced by tests 1–2); assert all 13 × 2 subjects byte-for-byte; text part has every link and details row. Human ~1 h / CC ~5 min.
B) Contract + snapshots
Everything in A, plus 28 committed golden HTML files compared exactly; any layout or copy change rewrites them. Human ~3 h / CC ~15 min, ongoing churn.

State: approved
Actual answer: A) Behaviour contract (Basel, D3, 2026-10-27)
Accepted scope: templates.test.ts :49-:170 kept unchanged except :65-75 (replaced by §5 tests 1–2); all 13 customer templates × 2 languages assert their subject byte-for-byte against today's; the text part contains every link and every details row (F2). No golden snapshots.
History: none

Approval readiness: PASS. R1 = D2 A) Portal (Basel, 2026-10-27); R2 = D3 A) Behaviour contract (Basel, 2026-10-27). F1–F3 are factual corrections (no behaviour choice). Structure D1 = A) Original arrangement.

## Review body

### NOT in scope
- The welcome mail, store badges and the client chip's use: MUT-469.
- The operator review digest's look: it stays plain (epic decision); MUT-460 owns its content.
- Phone-specific sizes via a `<style>` media query: dropped (D6) to keep the inline-only rule.
- Automated client rendering (Litmus-style): hand checks through `mail:preview --send` cover the ticket's client criterion.
- Netlify cache headers for mail art: no longer needed (R1); MUT-108 is unaffected.

### What already exists (reused, not rebuilt)
- Mail port, caps, idempotency, transports: `server/src/email/mailer.ts`, `ports.ts` (unchanged contract; `renderMail` gains a frame argument).
- Escaping, `checkedHref`, `<bdi dir="ltr">` links, text part: `server/src/email/templates/layout.ts` (kept inside the rewrite).
- Portal static serving with immutable cache: `server/src/app.ts:646-663` (extended to `/mail/`).
- Host derivation from `config/hosts.json` in Terraform: `domain.tf:36-38` (`PORTAL_ORIGIN`, `WEBAUTHN_RP_ID` precedent for `WEBSITE_ORIGIN`).
- Dev outbox and its QA reader: `server/src/routes/dev-outbox.ts`, `qa/support/selfService.ts:44-51`.
- Privacy page language switch: `src/pages/landing/PrivacyPolicyPage.tsx:40`.

### Diagram
```
caller (route/job) ──send(to, template, locale, vars)──► mailer.ts
   mailer: suppression → caps → renderMail(template, locale, vars, { to, artOrigin=PORTAL_ORIGIN, websiteOrigin })
        copy.ts[template][locale](vars) ──► MailBody { subject, preheader, headline, intro, details?, action?, secondary?, outro? }
        look.ts LOOK[template] (customer only) ──► { mood, header(+rtl), chip }
        layout.ts renderLayout
          ├─ look?        yes → band(mood) + art <img artOrigin/mail/v1/…> + chip + h1     no (digest) → plain card
          ├─ artOrigin?   yes → <img> with alt/width/height                                no → tinted cells only
          ├─ details?     yes → panel (ink on panel) + "Label: value" in text part
          ├─ action?      button + raw link <bdi dir=ltr>   (none for under-review, declined)
          └─ footer       password line + "sent to <to>" (<bdi>) + Privacy (websiteOrigin?)
   transport.deliver ──► Resend
mail client ──GET <PORTAL_ORIGIN>/mail/v1/<file>──► Cloud Run app.ts serveStatic(dist-hosted)
   hit → image/png + immutable   miss → SPA shell, no-store (never cached broken)
```

### Failure modes
| Path | Realistic failure | Covered by | User sees |
|---|---|---|---|
| Art fetch | portal down or a file renamed | look.test.ts (files exist); images-off layout; app.ts miss → no-store | tint, alt text, headline, working button |
| Art origin unset in prod | Terraform lost `PORTAL_ORIGIN` | config fail-fast with `MAILER=resend` | API refuses to start (deploy smoke test fails), no mail sent broken |
| Hostile input | recipient address or passkey name with HTML | test 5 + regression :118 | escaped text |
| Wrong mood/art | template added without a look | type: `Record<CustomerTemplateId, Look>` (F3) | compile error, never shipped |
| Gmail clipping | copy growth past 102 KB | test 7 (< 100 KB) | n/a, caught in CI |
| Plain-text readers | details only in html | F2 + test 9 | full facts in text part |
No critical gaps: every failure has a test or handling, and none is silent.

### Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one module, `server/src/email/templates/`, with config and app.ts touching the same wiring).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~2h / CC: ~10min)** — server/static — Serve mail art from the portal (`src/hosted/public/mail/v1/`, `/mail/` immutable in app.ts, `WEBSITE_ORIGIN` in config + Terraform)
  - Surfaced by: Architecture — A1 / R1 (D2)
  - Files: src/hosted/public/mail/v1/*, server/src/app.ts, server/src/config.ts, server/src/index.ts, server/infrastructure/terraform/domain.tf, server/.env.example
  - Verify: `npm --prefix server test -- src/__tests__/config src/__tests__/app` + the release `curl -sI` check
- [ ] **T2 (P1, human: ~1h / CC: ~5min)** — server/email tests — Regression contract: keep templates.test.ts :49-:170 except :65-75; 13 × 2 subjects byte-for-byte
  - Surfaced by: Tests — T1 / R2 (D3)
  - Files: server/src/email/__tests__/templates.test.ts
  - Verify: `npm --prefix server test -- src/email`
- [ ] **T3 (P1, human: ~30min / CC: ~5min)** — server/email — Text part prints details rows (`Label: value`)
  - Surfaced by: Code quality — F2
  - Files: server/src/email/templates/layout.ts, templates.test.ts
  - Verify: `npm --prefix server test -- src/email`
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — server/email — Type-enforce headline/preheader and an exhaustive LOOK for customer templates
  - Surfaced by: Code quality — F3
  - Files: server/src/email/templates/layout.ts, look.ts, copy.ts
  - Verify: `npm --prefix server run typecheck`

### Unresolved decisions
None.

### Suppressed findings (appendix)
None.

### Completion summary
- Step 0: Scope Challenge — scope accepted as-is
- Reality rows: 7/7 applicable rows emitted, 2 unverified premises (Netlify fallback ordering, now moot under R1; Gmail's 102 KB clip)
- Architecture Review: 1 issue found (A1, accepted via D2)
- Code Quality Review: 2 issues found (F2, F3, corrected)
- Test Review: diagram produced, 2 gaps identified (regression contract via D3; no-Privacy-link case folded into test 2)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex unavailable (not installed); native Plan fallback gave no complete report within five minutes, no credit
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 1/2 (D2 picked the 10/10 option; D3 picked the 9/10 behaviour contract over snapshots; D1 kind-only, not scored)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex (auto, plan-review phase) | Independent 2nd opinion | 1 | unavailable | codex not installed; native fallback timed out, no credit |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN (not persisted until logged) | 5 issues, 0 critical gaps (all resolved: D2, D3, F2, F3, test-2 fold) |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase, unavailable (CLI not installed); the native Plan fallback did not finish within five minutes and gets no credit. No outside findings.
- **VERDICT:** no review CLEAR. Eng review ran with 5 issues found, all resolved in the plan (status issues_open by the log's rule: issues were found); eng review required.

NO UNRESOLVED DECISIONS
