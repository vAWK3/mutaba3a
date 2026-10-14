# MUT-188 — Portal sign-in: "No account? Request one" link to `/hosted`

Status: **Planned, eng-reviewed (2026-10-14)**. Not built. Review ledger and findings at the end of this file; D1/D2 were auto-decided (non-interactive run).
Ticket: MUT-188 (Task) · Epic MUT-185 · Blocked by MUT-186 (merged to local main a7d5068, Jira In Review → gate passes). Siblings: MUT-187 (merged, 11e9f0a), MUT-197 (Backlog, conditional), MUT-172 (landing, under MUT-171).
Tracker: Jira · barmajiyat.atlassian.net · MUT via atlassian-barmajiyat · Backlog = planning allowed · finished → In Review after /qa-reconcile.

## 1. Problem and acceptance criteria

Someone who reaches the portal's sign-in page without an account hits a dead end. The free web app now points at `/hosted` (MUT-187), the landing will (MUT-172), but the portal itself, the one place a curious person lands when a colleague shares the run.app link, says nothing.

| # | AC (ticket) | Proved by |
|---|---|---|
| A1 | The sign-in page shows a "No account? Request one" link to the `/hosted` benefits page; the URL comes from config | `auth-states.test.tsx` (new S3b block: link name, `href`), `vite-config.test.ts` (`__HOSTED_OFFER_URL__` define, env override, bad value fails the build) |
| A2 | The link points outward only. ADR-037's route-inventory and bundle tests still pass; no signup route is added | `server/src/__tests__/no-self-registration.test.ts` untouched and green; `npm run test:bundles` green with the landing origin added to the **hosted** allowlist as a link target; S3's `BANNED` regex still matches nothing on the page |
| A3 | Link text in EN and AR, in the portal's own dictionaries (`src/hosted/i18n`) | `hosted.auth.request.*` in `en.json`/`ar.json`; `parity.test.ts` covers the `hosted.*` subtree; S3b runs in `ar` |

## 2. Where it goes

The nearest thing built the same way is MUT-187's portal link (ADR-076 D1/D3): a build-time URL validated in `vite.config.ts`, injected by `define`, read at render time through a typeof-guarded getter so Vitest (which defines no build globals) keeps every existing test untouched.

| File | Change |
|---|---|
| `vite.config.ts` | **D1**: `DEFAULT_PUBLIC_ORIGIN` becomes `https://mutaba3a.netlify.app` (see §3). New exported `hostedOfferUrl(override)` = `assertHttpsOrigin('MUTABA3A_PUBLIC_ORIGIN', override ?? DEFAULT_PUBLIC_ORIGIN) + HOSTED_OFFER_URL`, importing `HOSTED_OFFER_URL` from `src/content/download-config.ts` (no React/DOM imports there, same as the existing `hostedRequest.ts` import). `hostedConfig().define` gains `__HOSTED_OFFER_URL__: JSON.stringify(hostedOfferUrl(process.env.MUTABA3A_PUBLIC_ORIGIN))`. The web and desktop builds get no such define: the local builds don't need it, and nothing of the portal's config leaks the other way. |
| `src/vite-env.d.ts` | `declare const __HOSTED_OFFER_URL__: string;` beside `__PORTAL_URL__`. |
| `src/hosted/pages/auth/SignInPage.tsx` | A module-level `const HOSTED_OFFER_URL = typeof __HOSTED_OFFER_URL__ !== 'undefined' ? __HOSTED_OFFER_URL__ : ''` (eng review R1: inline, one consumer; the typeof guard is the `goHosted.ts` precedent, ADR-076 D3). Under the existing `<p className="hp-help">` help line, when it is non-empty: a second `hp-help` paragraph, `{t('hosted.auth.request.lead')} <a href={url}>{t('hosted.auth.request.link')}</a>`. Same tab (D3). Nothing else on the page changes. |
| `src/hosted/hosted.css` | `.hp-help + .hp-help { margin-top: var(--space-2); }` so the two help lines don't fuse. The anchor takes `index.css`'s unclassed-link style (accent colour, underline on hover; the portal imports `index.css`). No new colour. |
| `src/hosted/i18n/en.json`, `ar.json` | `hosted.auth.request.lead` = "No account?" / "ليس لديك حساب؟"; `hosted.auth.request.link` = "Request one" / "اطلب حسابًا". Neither phrase trips `HOSTED_RULES` (sign up, create account, إنشاء حساب, اشترك…) or the S3 `BANNED` regex. |
| `scripts/bundle-origins.json` | `hosted`: add `https://mutaba3a.netlify.app` (link target, never fetched). `local`: add the same origin (og:url now points there). `https://mutaba3a.app` **stays** in `local`: `public/.well-known/oauth-client.json` carries it as the Malafat OAuth client id (ADR-023) and ships in `dist-web` (eng review S2). |
| `.env.example` | `MUTABA3A_PUBLIC_ORIGIN`: default now the Netlify origin; note that the **hosted** build reads it too, for the sign-in page's link, and that another origin must be added to **both** allowlists. |
| `.claude/INFRA.md`, `.claude/SYSTEM_OVERVIEW.md` | The "PWA + landing" row and the two deployment rows name `mutaba3a.netlify.app` (custom domain pending, MUT-112). |
| `.claude/designs/mut-43-auth-states.md` (§4 line "No link other than the language switch…"), `.claude/designs/hosted-portal.md` §7.6 | Amend the sign-in invariant: *one outbound link to the public `/hosted` offer page is permitted; no inbound door (signup, reset, invite) exists* (outside voice F3). The S3 test block cites these documents, so they must agree with S3b. |
| `.claude/DECISIONS.md` | A dated note under ADR-037 (decisions 1 and 10): the portal may link **out** to the landing's `/hosted`; nothing links **in**. Not a new ADR. |
| `qa/features/portal/signin.yaml`, `qa/specs/portal/signin.spec.ts` | `@portal.signin.request-link`: in EN then AR, the link named from the dictionary is visible, its `href` ends in `/hosted`, and the page still passes axe. `qa/qa.config.mjs` starts `npm run dev:hosted`; the dev server applies the same `define`, so no env is needed. |

Nothing in `server/`, the router, the session code, the local app or the landing changes. No new dependency.

## 3. Decisions

- **D1 — The default public origin becomes the Netlify origin.** `DEFAULT_PUBLIC_ORIGIN` is `https://mutaba3a.app`, but that host does not resolve today (`curl` on 2026-10-14: "Could not resolve host"), while `https://mutaba3a.netlify.app/hosted` answers 200. INFRA.md and the epic text disagree on this; the DNS is the truth. Shipping the portal link on a dead default would be exactly the "silent dead link" ADR-076 rejected for the portal URL. Fixing the one constant also repairs the landing's `og:url`/`og:image` tags, which point at the dead host today. The custom domain returns through MUT-112, which already owns "move landing and portal to the custom domain". **What D1 does not touch** (outside voice F2): `public/.well-known/oauth-client.json` and `src/services/oauth/oauth-client.ts` `CIMD_CLIENT_ID` are the Malafat OAuth client identity (ADR-023) and must keep `https://mutaba3a.app` whatever the DNS does; `server/.env.example` `PORTAL_ORIGIN=https://portal.mutaba3a.app` is an example for a future custom portal origin. D1 fixes the two Vite-emitted uses only; MUT-112 gets this inventory as a comment. *Alternative rejected*: a second constant (`DEFAULT_WEB_ORIGIN`) for the portal only, leaving `og:url` dead, so two "where is the landing" values would disagree.
- **D2 — Same env var for both builds.** `MUTABA3A_PUBLIC_ORIGIN` already means "where the landing is served"; the portal's link is that origin plus `HOSTED_OFFER_URL`. One name, one validator (`assertHttpsOrigin`), no new env var. A staging portal build points its link at a staging landing by setting the one value it already sets for link previews. Caveat (outside voice F4): the name is read by two pipelines that never set it today, Netlify's UI env for the web build and `server-ci.yml` / `server/scripts/deploy.sh` for the hosted build. The portal link therefore depends on the default being right, and a staging override on Netlify alone would not move it. INFRA.md records this. Verified live on 2026-10-14: `mutaba3a.netlify.app` serves og:url `https://mutaba3a.app/` (the default, so Netlify sets no override) and MUT-186 is not deployed there yet.
- **D3 — Same tab, no `target="_blank"`.** The sign-in form holds nothing worth preserving, and the ticket only says "points outward". MUT-187's links open new tabs because they leave a running app with state; that reason doesn't apply here. No sr-only "opens in a new tab" label is needed. The page then shows two help lines naming two different actions ("Ask the person who set up your account" for a colleague of an existing firm, "No account? Request one" for a new firm). This is deliberate: both people land on the same page and each line is the right one for one of them.
- **D4 — Render nothing when the build set no URL.** Vitest defines no `__HOSTED_OFFER_URL__`, so S3's existing `queryAllByRole('link')` → 0 assertion keeps proving the page has no other door; the new block stubs the global and proves exactly one link. In production the define always exists (default or env), so the empty branch never ships; it is the test seam, as in ADR-076 D3.
- **D5 — The portal does not import `src/content/download-config.ts` at runtime.** The URL is resolved at build time in `vite.config.ts`; the portal bundle sees one string. `download-config.ts` carries download paths and store flags that have no business in the portal.

## 4. Tests (written first)

| Test | Cases |
|---|---|
| `scripts/__tests__/vite-config.test.ts` → "portal request link (MUT-188)" | hosted define = `DEFAULT_PUBLIC_ORIGIN + '/hosted'`; `hostedOfferUrl('https://staging.example/')` → `https://staging.example/hosted` (slash trimmed); `hostedOfferUrl('http://x')` throws naming `MUTABA3A_PUBLIC_ORIGIN`; web and desktop configs define no `__HOSTED_OFFER_URL__`; `DEFAULT_PUBLIC_ORIGIN` ends in `.netlify.app` until MUT-112 (a deliberate pin, like the run.app pin for the portal). `DEFAULT_PUBLIC_ORIGIN` is exported for this (today it is module-private). Only the web and desktop configs are snapshotted (`vite-config.test.ts:60`), so no snapshot changes (eng review S3). |
| `scripts/__tests__/brand-head.test.ts` | `hosted.html` keeps `<meta name="referrer" content="same-origin">`, so `?next=` paths never reach the landing host (eng review R3). |
| `src/hosted/session/__tests__/auth-states.test.tsx` → "S3b no account (MUT-188)" | with the global stubbed: a link named "Request one" with the stubbed `href`, preceded by "No account?"; it is the only link on the page; `BANNED` still matches nothing; in `ar` the link is named "اطلب حسابًا" and the page is `dir="rtl"`. S3's existing "zero links" case is left exactly as it is. |
| `src/hosted/i18n/__tests__/parity.test.ts` | unchanged; covers the new keys. |
| `npm run test:bundles` | hosted bundle: no forbidden phrase, no new origin beyond the allowlist. |
| QA `@portal.signin.request-link` | EN/AR visible link, `href` ends `/hosted`, axe clean. |

Gate (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`, `npm run test:bundles`. No `server/` change, so the server gate is not owed.

## 5. Reuse analysis

| Need | Reused | New |
|---|---|---|
| Validated https origin | `assertHttpsOrigin` (vite.config.ts) | — |
| `/hosted` path | `HOSTED_OFFER_URL` (download-config.ts) | — |
| Render-time gate | the ADR-076 D3 typeof-guard shape, inline (R1) | — |
| Help line style | `.hp-help` | one adjacency rule |
| Link style | `index.css` unclassed `a` | — |

## 6. Scope check

Covers A1–A3 and nothing else. D1 touches a constant outside the ticket's literal wording; it is required for A1 to be true in production (a link to a dead host doesn't "point to the /hosted benefits page"). Not in scope: a custom domain (MUT-112), any copy on `/hosted`, any portal route.

## 7. Follow-ups to note on tickets

- MUT-112: when the custom domain lands, flip `DEFAULT_PUBLIC_ORIGIN` and both allowlist entries back; the portal link follows automatically.
- INFRA.md's `mutaba3a.app` row was stale; corrected here.

Business / product impact
- Closes the last dead end in the Go hosted funnel: a person who lands on the portal without an account now has a way to ask for one instead of bouncing. The three doors (sidebar, Settings, portal) all lead to the same request form Basel answers by hand.
- Epic MUT-185; after this only MUT-172 (landing copy) and the conditional MUT-197 remain.
- Also repairs the landing's social preview links, which pointed at a host with no DNS. Risk is one constant and one allowlist entry, both reverted by MUT-112.

---

# Eng review (/plan-eng-review, 2026-10-14, non-interactive by Basel's instruction)

Target: this plan. Reviewer: Claude (native). Basel asked for a non-interactive run, so every decision gate below was auto-decided on the recommended option and is marked **auto**; each one is listed again under "Unresolved decisions" so Basel can overturn it before /eng-build commits anything that depends on it.

## Scope Challenge

**A. Assess.** Already solving each sub-problem: `assertHttpsOrigin` + `define` (ADR-076 D1) for the URL; `HOSTED_OFFER_URL` for the path; `.hp-help` for the line; `parity.test.ts` for the dictionaries; `check-bundles.ts` for "no new origin". Complexity: 14 files touched (5 source, 3 dictionaries/config, 2 docs, 2 QA, 2 tests + 1 new test), 0 new services, 1 proposed new module. Search check: no new pattern (build-time define + typeof guard is the repo's own, ADR-076); search skipped, in-distribution. TODOS.md: nothing blocks or overlaps (#13/#14 are portal profile items). Distribution: the hosted build ships inside the API image (`server/Dockerfile`, built by `npm run build:hosted` at the repo root); no CI change.

**B. Complexity gate** (14 files ≥ 8): structure question, **auto-decided → Smaller arrangement.**

**C. Findings**

| # | Sev | Conf | Where | Finding | Disposition |
|---|---|---|---|---|---|
| S1 | P2 | 9/10 | plan §2 "`src/hosted/hostedOffer.ts` (new)" | One consumer (`SignInPage.tsx`) does not justify a module plus its own test file. ADR-076 D3 put the getters in `goHosted.ts` because two components read them. | **accepted (R1 auto)**: inline `typeof __HOSTED_OFFER_URL__ !== 'undefined' ? __HOSTED_OFFER_URL__ : ''` in `SignInPage.tsx`; drop `hostedOffer.ts` and `hostedOffer.test.ts`. S3b covers both branches (stubbed and unstubbed). |
| S2 | P1 | 9/10 | plan §2 `scripts/bundle-origins.json`: "drop `https://mutaba3a.app`" | `public/.well-known/oauth-client.json:2-5` carries `https://mutaba3a.app` as the Malafat OAuth `client_id`/`client_uri`/`logo_uri` (ADR-023). It ships in `dist-web`, so dropping the allowlist entry would fail `test:bundles`, and the client id must not change. | **accepted (factual correction, no choice)**: keep `https://mutaba3a.app` in `local`; only add `https://mutaba3a.netlify.app` to both lists. |
| S3 | P3 | 9/10 | plan §4 "if the hosted config is snapshotted" | `vite-config.test.ts:60` snapshots only `web` and `desktop`. The hosted define changes no snapshot. | **accepted (factual correction)**: drop the sentence. |

Result: **scope accepted as-is** (a smaller arrangement that keeps every commitment is not a scope reduction). MODE = FULL_REVIEW.

## Decision ledger

### R1: file arrangement for the render-time URL getter
Finding: S1, P2, 9/10, plan §2, Claude
Plan baseline: original proposal, new `src/hosted/hostedOffer.ts` + `src/hosted/__tests__/hostedOffer.test.ts`
Runtime evidence: `src/lib/goHosted.ts:58-66` reads `__BUILD_MODE__`/`__PORTAL_URL__` through typeof guards; two consumers there (`GoHostedCard`, `HostedAccountEntry`). `SignInPage.tsx` would be the only portal consumer.
Comparison grid:

| Choice | Current | A) Original arrangement | B) Smaller arrangement |
|---|---|---|---|
| R1 module | new `hostedOffer.ts` + test | as proposed (2 extra files) | inline guard in `SignInPage.tsx`, no new files |
| Behaviour, tests S3b, vite-config tests, allowlist, i18n | fixed | same | same |
| Pending remedies not decided here | none | — | — |

Question D1: Original or smaller arrangement for one 3-line getter with one caller?
Header: Arrangement
Options:
A) Original arrangement — a `src/hosted/hostedOffer.ts` getter + its own unit test; a second consumer later imports it. ✅ mirrors `goHosted.ts` exactly ✅ the getter is unit-testable in isolation ❌ two files for three lines that one component reads.
B) Smaller arrangement (recommended) — the typeof guard lives in `SignInPage.tsx`; S3b proves both branches. ✅ smallest clear diff, no premature module ✅ one fewer test file to keep green ❌ a second consumer would have to extract it then (a 2-minute move).
Completeness: A=10/10, B=10/10 (same behaviour and proof).

State: approved
Actual answer: B (auto, non-interactive run; Basel may overturn before /eng-build)
Accepted scope: inline the guard in `SignInPage.tsx`; no `hostedOffer.ts`, no `hostedOffer.test.ts`; S3b keeps the "no global → no link" case.
History: none

### R2: `DEFAULT_PUBLIC_ORIGIN` → the Netlify origin (plan D1)
Finding: Architecture A1, P1, 9/10, `vite.config.ts:47`, Claude
Plan baseline: original proposal D1 (change the constant), shared by every option, so it still needs approval
Runtime evidence: `curl https://mutaba3a.app/hosted` → "Could not resolve host"; `https://mutaba3a.netlify.app/hosted` → 200 (2026-10-14). The constant feeds `socialMeta()` (:137), `hostedOfferHtml()` canonical + og:url (:207) and, after this plan, the portal's link. `public/.well-known/oauth-client.json` keeps its own literal `https://mutaba3a.app` (ADR-023 client id), untouched.
Comparison grid:

| Choice | Current | A) Change the default | B) Keep the default, set the env in each hosted build | C) Second constant for the portal only |
|---|---|---|---|---|
| R2 default | `https://mutaba3a.app` (dead) | `https://mutaba3a.netlify.app` | unchanged | unchanged; new `DEFAULT_WEB_ORIGIN` |
| Portal link in a default build | — | works | dead | works |
| og:url / canonical | dead | fixed | dead | dead |
| Allowlist | — | + netlify.app (local, hosted) | + netlify.app (hosted) | + netlify.app (hosted) |

Question D2: What should the build's public origin default to while the custom domain has no DNS?
Header: Public origin
Options:
A) Change the default to the Netlify origin (recommended) ✅ the portal link, og:url and canonical all point at a host that answers today ✅ one constant, one env var, MUT-112 flips it back ❌ touches social-preview output outside MUT-188's literal wording.
B) Keep the default; rely on `MUTABA3A_PUBLIC_ORIGIN` at hosted build time ✅ no change outside the ticket ❌ a default `npm run build:hosted` (the documented deploy path) ships a link to a host with no DNS, the "silent dead link" ADR-076 rejected ❌ og:url stays dead.
C) A separate constant for the portal link ✅ no social-meta side effect ❌ two "where is the landing" values that disagree; the dead og:url stays.
Completeness: A=10/10, B=4/10, C=6/10.

State: approved
Actual answer: A (auto; **flagged for Basel**: this also changes the landing's link-preview URL from mutaba3a.app to mutaba3a.netlify.app)
Accepted scope: `DEFAULT_PUBLIC_ORIGIN = "https://mutaba3a.netlify.app"`; `.env.example`, INFRA.md and SYSTEM_OVERVIEW.md deployment rows say so; `https://mutaba3a.netlify.app` added to both allowlists; `https://mutaba3a.app` stays in `local` (S2).
History: none

### R3: referrer on the outward link
Finding: Architecture A2, P3, 9/10, `hosted.html:18`, Claude
Plan baseline: plain `<a href>` with no `rel`
Runtime evidence: `hosted.html:18` `<meta name="referrer" content="same-origin" />`, so a cross-origin navigation from `/sign-in?next=/p/<id>/…` already sends no Referer to the landing host. No server `Referrer-Policy` header exists (`grep -i referrer server/src` → none), the meta is the control.
Factual correction, no behaviour change: the plan's link needs no `rel="noreferrer"`; the page policy covers it. S3b asserts the meta is present on the portal entry (one `expect` in the existing `Brand`/entry test is enough) so the guarantee is pinned. No question.

State: approved (no change to the plan's link markup; add the one assertion)
Accepted scope: assert `hosted.html` keeps `referrer=same-origin` in `scripts/__tests__/brand-head.test.ts` (it already reads `hosted.html`).

Approval readiness: PASS — R1 (D1 auto B), R2 (D2 auto A), R3 (factual, no choice); S2/S3 factual corrections applied to the working plan.

## Working plan amendments (applied)

- §2: no `src/hosted/hostedOffer.ts`; the guard is inline in `SignInPage.tsx` (R1).
- §2 `bundle-origins.json`: add the Netlify origin to `local` and `hosted`; keep `https://mutaba3a.app` in `local` (S2).
- §4: remove the snapshot sentence (S3); drop `hostedOffer.test.ts`; add the `referrer=same-origin` assertion to `brand-head.test.ts` (R3).
- §2 docs: also correct `.claude/SYSTEM_OVERVIEW.md` deployment rows 282-283 (Netlify origin, custom domain pending MUT-112).

## 1. Architecture review

- **[P1] (9/10) `vite.config.ts:47`** `const DEFAULT_PUBLIC_ORIGIN = "https://mutaba3a.app";` — dead host; feeds the portal link, og:url and the `/hosted` canonical. → R2 accepted.
- **[P3] (9/10) `hosted.html:18`** referrer already `same-origin`; the plan's worry about leaking `?next=` paths is moot. → R3, one assertion.
- Boundaries: the portal bundle gains one string; no new import across the `src/hosted` lint fence (`hosted-lint.test.ts`); nothing in `server/`. ADR-037 decision 1 (no signup route) and 10 (no portal code in local builds) hold: the link is an outward anchor, and `HOSTED_RULES` still bans sign-up/create-account/forgot/invite copy.
- Data flow: `MUTABA3A_PUBLIC_ORIGIN?` → `assertHttpsOrigin` (throws → build fails) → `__HOSTED_OFFER_URL__` → `SignInPage` → `<a href>`. One production failure: someone sets the env to a path (`https://x/hosted`); `assertHttpsOrigin` refuses it at build, the deploy never starts. Covered by the existing `it.each` refusals plus one new case.
- Distribution: no new artifact; the define lands in `dist-hosted` through the existing `build:hosted`, copied into the API image.

```
build (vite --mode hosted)                      runtime (portal /sign-in)
MUTABA3A_PUBLIC_ORIGIN ─┐                        __HOSTED_OFFER_URL__ ──typeof guard──┐
  (unset → default)     ├─ assertHttpsOrigin ─┐                                       ├─ "" → no line
                        │   throws on non-https│                                       └─ url → <p.hp-help>No account? <a href=url>Request one</a></p>
HOSTED_OFFER_URL "/hosted" ─────────────────────┴─ define __HOSTED_OFFER_URL__ ─ dist-hosted
```

Dispositions: A1 accepted (R2 auto A); A2 accepted as a factual correction (R3).

## 2. Code quality review

- **[P2] (9/10) plan §2 new module** — one consumer; inline it. → R1 accepted (auto B).
- **[P1] (9/10) plan §2 allowlist** — `public/.well-known/oauth-client.json:2` `"client_id": "https://mutaba3a.app/.well-known/oauth-client.json"` ships in `dist-web`; removing the allowlist entry breaks `test:bundles`. → S2 accepted.
- Shared code: `assertHttpsOrigin` is reused (2 existing callers at :66 and :106, now 3). No extraction proposed: a `hostedOfferUrl(override)` helper beside `portalUrl()` is the same 1-line shape, not a new abstraction.
- Error handling: the only runtime branch is "define absent" (test seam). Build-time errors name the env var. Nothing silent.
- Naming: with R1 the only `hostedOfferUrl` is the vite.config export; no collision.

Dispositions: Q1 accepted (R1), Q2 accepted (S2).

## 3. Test review

Framework: Vitest (`npm run test:run`), Playwright QA under `qa/` (preview builds, `QA_CONTEXT`), bundle gate `npm run test:bundles`. CLAUDE.md names them.

```
CODE PATHS                                                      USER FLOWS
[+] vite.config.ts                                              [+] Portal sign-in without an account
  ├── hostedOfferUrl(override)                                    ├── [GAP→new] sees "No account? Request one" (EN) — auth-states S3b
  │   ├── [GAP→new] undefined → DEFAULT + "/hosted"               ├── [GAP→new] sees "ليس لديك حساب؟ اطلب حسابًا" (AR, rtl) — S3b
  │   ├── [GAP→new] "https://x/" → "https://x/hosted"             ├── [GAP→new] link is the only link; BANNED copy absent — S3b
  │   └── [GAP→new] "http://x" / "https://x/p" → throws           ├── [GAP→new][→E2E] preview build: link visible, href ends /hosted, axe clean — @portal.signin.request-link
  └── hostedConfig().define.__HOSTED_OFFER_URL__                  └── [★★★ TESTED] no other door: HOSTED_RULES + no-self-registration — unchanged
      ├── [GAP→new] hosted defines it
      └── [GAP→new] web/desktop define none                     [+] Error states
[+] src/hosted/pages/auth/SignInPage.tsx                          ├── [GAP→new] build with a bad origin fails, naming the env var — vite-config
  ├── [GAP→new] typeof guard: global absent → no paragraph        └── [★★★ TESTED] existing S3 "zero links" stays as the no-global proof
  └── [GAP→new] global set → paragraph + anchor
[+] hosted.html referrer=same-origin                             [+] Dictionaries
  └── [GAP→new] pinned in brand-head.test.ts                      └── [★★★ TESTED] parity.test.ts covers hosted.auth.request.* automatically

COVERAGE (before build): 3/14 paths tested (21%)  |  after the planned tests: 14/14
QUALITY: ★★★:3  |  GAPS: 11 (1 E2E)
```
Legend: ★★★ behavior + edge + error | ★★ happy path | ★ smoke | [→E2E] integration

Value cards (one per new test group):
- vite-config "portal request link": protects=hosted build carries DEFAULT_PUBLIC_ORIGIN + /hosted, env override trimmed, bad value fails build, local builds carry none; fails_when=define dropped, path concatenation wrong, validation bypassed; why_new=no test reads hostedConfig().define today; seam=none.
- auth-states S3b: protects=sign-in shows exactly one outward link with the configured href in EN and AR, and nothing when unconfigured; fails_when=link removed, href wrong, copy trips BANNED, AR missing; why_new=S3 asserts zero links only; seam=none (vi.stubGlobal, the goHosted precedent at `goHosted.test.ts:87`).
- brand-head referrer: protects=portal entry keeps referrer=same-origin so `?next=` never reaches another host; fails_when=meta removed; why_new=nothing asserts it; seam=none.
- QA `@portal.signin.request-link`: protects=the built bundle (real define) renders the link, EN/AR, axe; fails_when=define missing at build or CSS hides it; why_new=unit tests stub the global, only a build proves it; seam=none.

Regression rule: existing S3 "zero links" and `BANNED` stay untouched (they are the regression contract for "no signup door"); the bundle rules are unchanged. Tests made obsolete: none.

Test gaps identified: 11, all planned above. No LLM/eval scope.

Dispositions: all test requirements are proof of approved behaviour (ticket A1–A3, R1–R3); no new policy, no question.

## 4. Performance review

No issues found. One compile-time string; no request, no storage, no loop. Bundle delta: ~120 bytes in `dist-hosted`.

## Outside voice (native fallback, Claude Plan subagent; Codex not installed)

Provider: codex not installed → native in-host fallback. Outside coverage: **unavailable** (a native result never supplies outside coverage). The subagent's seven findings and their dispositions:

| # | Sev | Finding | Disposition |
|---|---|---|---|
| O1 | High | Dropping `https://mutaba3a.app` from `local` breaks `test:bundles` (oauth-client.json ships in dist-web/desktop; check-bundles scans `.json` and dot-dirs). | agrees with S2; already accepted |
| O2 | Medium | D1's "one truth" claim is overstated: `CIMD_CLIENT_ID`, `oauth-client.json`, `server/.env.example` keep `mutaba3a.app`. | **accepted (factual)**: D1 text corrected; inventory goes to MUT-112 as a comment |
| O3 | Medium | `mut-43-auth-states.md` §4 says "No link other than the language switch"; the S3 test cites it. | **accepted (R4 auto, no alternative preserves S3b)**: amend that line and hosted-portal.md §7.6; dated note under ADR-037 |
| O4 | Medium | Live check: Netlify serves og:url `https://mutaba3a.app/` (default, no override) and MUT-186 is not deployed yet; two pipelines read one env name. | **accepted (factual)**: D2 caveat + INFRA.md note |
| O5 | Low | `rel="noreferrer"` redundant; `hosted.html` meta is the mechanism. | agrees with R3; already accepted |
| O6 | Low | `hostedOffer.ts` + test over-engineered. | agrees with R1; already accepted |
| O7 | Low | Export `DEFAULT_PUBLIC_ORIGIN` for the pin test; `.env.example` must say both allowlists; QA runs `dev:hosted`, not a preview; two help lines name two humans. | **accepted (factual)**: plan text corrected; the two lines are deliberate (D3) |

Cross-model tension: none. Both reviewers converge on the same three corrections (allowlist, inline guard, referrer meta); the subagent's spec-drift catch (O3) is the one thing the native pass missed. Model identity of the subagent: same harness, unknown model.

### R4: sign-in spec amendment (outside voice O3)
Finding: O3, Medium, 9/10, `.claude/designs/mut-43-auth-states.md:46` "No link other than the language switch. The help line is plain text, not a link.", subagent
Plan baseline: the plan edits no portal design doc
Runtime evidence: `auth-states.test.tsx:20` cites "mut-43-auth-states.md §2–§3"; S3 asserts zero links; `hosted-portal.md` §7.6 forbids inbound affordances only.
Factual correction with one necessary edit: the ticket's A1 contradicts that line as written, so the line must change for the test suite and the spec to agree. No alternative keeps both A1 and the line. No question.
State: approved
Accepted scope: amend `mut-43-auth-states.md` §4 and `hosted-portal.md` §7.6 (one outbound link permitted, no inbound door); dated note under ADR-037.

Approval readiness (re-run after Outside Voice): PASS — R1 (D1 auto B), R2 (D2 auto A), R3 (factual), R4 (factual), S2/S3/O2/O4/O7 factual corrections applied.

## NOT in scope
- Custom domain and flipping the default back: MUT-112.
- Any change to `/hosted` copy or the request form: MUT-186 is merged; MUT-197 owns spam protection.
- A `Referrer-Policy` response header on the API/portal: the page meta already covers the portal; a header is a server hardening item, not this ticket.
- Refreshing the README's deployment prose beyond INFRA.md and the two SYSTEM_OVERVIEW rows.

## What already exists
- `assertHttpsOrigin`, `portalUrl`, `define` plumbing: `vite.config.ts:57-67, 343-348` (reused).
- Typeof-guard getter precedent: `src/lib/goHosted.ts:58-66` (pattern reused inline, module not duplicated).
- Help-line slot: `SignInPage.tsx:198` `.hp-help`; `hosted.css:198`.
- Dictionaries + parity test: `src/hosted/i18n/*.json`, `parity.test.ts`.
- Bundle gate: `scripts/bundle-rules.ts`, `check-bundles.ts`, `bundle-origins.json`.
- QA harness for the signed-out portal: `qa/specs/portal/signin.spec.ts` `openSignIn()`.

## Failure modes
| Path | Failure | Handling | User sees |
|---|---|---|---|
| Build with bad `MUTABA3A_PUBLIC_ORIGIN` | typo'd value | `assertHttpsOrigin` throws; build fails | nothing ships |
| Portal built without the define (impossible via vite.config, possible in a hand-rolled test) | `typeof` → undefined | paragraph not rendered | no link, page otherwise intact |
| Landing host down | 404/timeout after click | outside the portal | browser error page; same as any external link |
Critical gaps: 0.

## Worktree parallelization strategy
Sequential implementation, no parallelization opportunity (one component, one config file, one epic worktree by Basel's instruction).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~1h / CC: ~5min)** — vite.config — Change `DEFAULT_PUBLIC_ORIGIN` to the Netlify origin; add `hostedOfferUrl()` and the hosted `__HOSTED_OFFER_URL__` define; declare it in `vite-env.d.ts`
  - Surfaced by: Architecture — A1 dead default host (R2)
  - Files: vite.config.ts, src/vite-env.d.ts, .env.example
  - Verify: `npx vitest run scripts/__tests__/vite-config.test.ts`
- [ ] **T2 (P1, human: ~30min / CC: ~3min)** — bundle allowlist — Add `https://mutaba3a.netlify.app` to `local` and `hosted`; keep `https://mutaba3a.app`
  - Surfaced by: Code quality — Q2 oauth-client.json (S2)
  - Files: scripts/bundle-origins.json
  - Verify: `npm run test:bundles`
- [ ] **T3 (P1, human: ~1h / CC: ~5min)** — SignInPage — Inline typeof guard, second `.hp-help` paragraph with the anchor; CSS adjacency rule; EN/AR keys
  - Surfaced by: Code quality — Q1 inline the getter (R1); ticket A1/A3
  - Files: src/hosted/pages/auth/SignInPage.tsx, src/hosted/hosted.css, src/hosted/i18n/en.json, src/hosted/i18n/ar.json
  - Verify: `npx vitest run src/hosted/session/__tests__/auth-states.test.tsx src/hosted/i18n`
- [ ] **T4 (P2, human: ~20min / CC: ~2min)** — brand-head test — Pin `referrer=same-origin` on `hosted.html`
  - Surfaced by: Architecture — A2 (R3)
  - Files: scripts/__tests__/brand-head.test.ts
  - Verify: `npx vitest run scripts/__tests__/brand-head.test.ts`
- [ ] **T5 (P2, human: ~1h / CC: ~5min)** — QA — `@portal.signin.request-link` feature + spec
  - Surfaced by: Test review — E2E gap
  - Files: qa/features/portal/signin.yaml, qa/specs/portal/signin.spec.ts
  - Verify: Playwright run on `vite preview --mode hosted` with QA_CONTEXT (see memory: QA on preview builds)
- [ ] **T6 (P2, human: ~20min / CC: ~3min)** — docs — INFRA.md + SYSTEM_OVERVIEW.md deployment rows name the Netlify origin
  - Surfaced by: Architecture — A1 docs drift
  - Files: .claude/INFRA.md, .claude/SYSTEM_OVERVIEW.md
  - Verify: grep `mutaba3a.app` leaves only the OAuth client id, MUT-112 notes and history

- [ ] **T7 (P2, human: ~20min / CC: ~3min)** — portal design docs — Amend `mut-43-auth-states.md` §4 and `hosted-portal.md` §7.6; dated note under ADR-037; MUT-112 inventory comment
  - Surfaced by: Outside voice — O2, O3
  - Files: .claude/designs/mut-43-auth-states.md, .claude/designs/hosted-portal.md, .claude/DECISIONS.md
  - Verify: `npx vitest run src/hosted/session/__tests__/auth-states.test.tsx` still cites a spec that allows the link

_No new tasks from Performance review._

## Unresolved decisions that may bite you later
Auto-decided in this non-interactive run; overturn before /eng-build if wrong:
- D1 (R1): inline guard instead of a `hostedOffer.ts` module.
- D2 (R2): `DEFAULT_PUBLIC_ORIGIN` becomes `https://mutaba3a.netlify.app` (also changes the landing's og:url/canonical to the live host).

## Suppressed findings (appendix)
- (4/10) `tsconfig.app.json` may already include `src/vite-env.d.ts`; if not, the app program never sees the new declaration, which is harmless either way. Verified at build by `npm run typecheck`.
- (3/10) Two stacked `.hp-help` lines may read as one block on a 320 px viewport; the adjacency margin should be enough. Visual check during QA.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, same scope)
- Architecture Review: 2 issues found
- Code Quality Review: 2 issues found
- Test Review: diagram produced, 11 gaps identified (all planned)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 2 in this review (D1, D2 auto-decided; Basel to confirm or overturn)
- Outside voice: codex not installed → native Claude subagent (in-host), completed with 7 findings; outside coverage unavailable
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 2/2 (D1 → B 10/10, D2 → A 10/10)

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | native fallback (codex not installed), `/plan-eng-review` | Independent 2nd opinion | 1 | unavailable (in-host completed, issues_found) | 7 findings, 3 overlapping, 4 new, all folded in |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 15 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** provider codex, phase plan-review, unavailable (not installed); native in-host fallback completed with 7 findings (O1–O7), dispositions above.
- **CROSS-MODEL:** native review and the in-host subagent are the same harness; model identity unknown. Overlap: O1=S2, O5=R3, O6=R1. New from the subagent: O2, O3, O4, O7.
- **VERDICT:** Eng review ISSUES OPEN (every finding mapped to T1–T7; two auto-decisions await Basel) — eng review required

**UNRESOLVED DECISIONS:**
- D1 (R1): inline typeof guard in `SignInPage.tsx` instead of a `hostedOffer.ts` module — auto-decided B, confirm or overturn
- D2 (R2): `DEFAULT_PUBLIC_ORIGIN` → `https://mutaba3a.netlify.app`, which also moves the landing's og:url/canonical to the live host — auto-decided A, confirm or overturn
