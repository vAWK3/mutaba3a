# MUT-186: the `/hosted` offer page and its request form

Ticket: MUT-186 (Story, epic MUT-185). Blocks MUT-187, MUT-188 and MUT-172. Status at planning: Backlog, no blockers.

## 1. Problem and acceptance criteria

Free users can't learn what hosted gives them or how to ask for it. This ticket adds a public page on the web build that makes the case for hosted, then collects a request that Netlify Forms emails to Basel. Basel replies with a price by hand.

Acceptance criteria, from the ticket:

| # | Criterion | Proven by |
|---|---|---|
| AC1 | `/hosted` is reachable on the web build outside `/app`, in EN and AR with RTL | `HostedOfferPage.test.tsx` (renders under `LandingProviders`; `dir="rtl"` in AR); `main.tsx` route; QA `@web.landing.hosted` |
| AC2 | The page covers only shipped benefits. Each app shows "coming soon" until its store URL is configured. No claims about reports or self-service profiles | page test + the honesty test (forbidden strings) |
| AC3 | The page says Basel helps move existing data by hand, and never promises automatic migration | honesty test |
| AC4 | The form has exactly the listed fields, and the required ones are validated | `hostedRequest.test.ts` (validate); the page test (errors shown) |
| AC5 | Submissions go through Netlify Forms: a static definition Netlify can detect, a honeypot field, and an email to Basel | `vite-config.test.ts` (emitted `__forms.html`); `hostedRequest.test.ts` (encode and POST); email notification is a **manual Netlify setting** (§9) |
| AC6 | The success state reads "we'll be in touch with an offer" | page test |
| AC7 | The error state offers a retry, and the button is disabled while sending | page test |
| AC8 | No price, no checkout, no account creation | honesty test |
| AC9 | The privacy policy covers the form data, Netlify, and what the data is used for | `PrivacyPolicyPage.test.tsx` |
| AC10 | Tests cover the form states, validation, and the EN/AR copy | all of the above + a key-parity test |

## 2. Where it goes

It follows the existing marketing-page pattern: PATTERNS.md, "Marketing pages render only landing chrome, and are tested under `LandingProviders`". `/privacy` is the closest page built the same way.

| File | Change |
|---|---|
| `src/main.tsx` | Add a fourth web-only lazy page: `path === HOSTED_OFFER_URL` → `<LandingProviders><HostedOfferPage/></LandingProviders>`. Gated by `__BUILD_MODE__ === "web"`, like `/privacy`. Desktop is being retired until v2 (Basel, 2026-10-14), so this ticket does no desktop work beyond following the existing gate. |
| `src/content/download-config.ts` | Add `HOSTED_OFFER_URL = '/hosted'` beside `WEB_APP_URL`. Add `MOBILE_APP_LINKS = { ios: { available: boolean, url: string \| null }, android: { available: boolean, url: string \| null } }`. `/hosted` reads only `available` (9A: no store links on this page); `url` is for MUT-173 and the welcome email. MUT-172, MUT-173 and MUT-187 import these from here (D1). |
| `src/pages/landing/hostedRequest.ts` (new) | **Constants** (D1: the form's own contract lives with the form's code): `HOSTED_REQUEST_FORM_NAME = 'hosted-request'`, `NETLIFY_FORMS_PATH = '/__forms.html'`, `HONEYPOT_FIELD = 'company-website'`, `PROFESSIONS`, `DEVICES`, and the `HOSTED_REQUEST_FIELDS` list. **Pure logic, no React:** `validateHostedRequest(values) → errors`; `encodeHostedRequest(values) → URLSearchParams` (adds `form-name`, joins devices into one `devices` value, trims, sends the honeypot empty); and `submitHostedRequest(values, fetchImpl = fetch) → Promise<'ok' \| 'error'>`, which POSTs `application/x-www-form-urlencoded` to `NETLIFY_FORMS_PATH`. Any non-2xx response, a thrown error, or an abort after `SUBMIT_TIMEOUT_MS = 15000` (the AbortController + setTimeout pattern from `useLatestRelease.ts:80`, D5) gives `'error'`. The module imports nothing from React or the DOM, so `vite.config.ts` can import it. |
| `src/pages/landing/HostedOfferPage.tsx` + `.css` (new) | `LandingHeader homeHref="/"` + `<main>` + `LandingFooter`. One idea per section (brief L7): a hero (headline, subline, an anchor button to the form), then benefits, then the band about moving your data, then the form section. Uses the `LandingPage.css` container and section tokens and Brand v2 tokens only. `useDocumentTitle`. |
| `src/pages/landing/components/HostedRequestForm.tsx` (new) | Controlled form with a status of `idle → sending → success \| error`. Fields use `Input`, `Textarea` and `Select` from `components/ui/Input` (they import only their CSS, so the landing chunk stays free of app state). Devices are checkboxes in a `fieldset`/`legend`. The honeypot is a visually hidden input with `tabIndex={-1}` and `autoComplete="off"`. Submit is a button styled with `Button.css` classes (PATTERNS: the landing uses classes, not `Button`). On an invalid submit it shows each field's error through `aria-describedby`/`aria-invalid` and moves focus to the first invalid field. `sending` disables the button. Under the submit button, a one-line notice reads "We use these details only to reply with an offer." with a "Privacy policy" link to `/privacy` (D3). `success` replaces the form with a `role="status"` message. `error` keeps the values, shows a `role="alert"`, and the button becomes "Try again". |
| `src/pages/landing/components/index.ts` | Export `HostedRequestForm`. |
| `vite.config.ts` | Add a web-only plugin `netlifyForms()`, importing its constants from `src/pages/landing/hostedRequest.ts`. Its `generateBundle` emits `__forms.html`: a static `<form name="hosted-request" data-netlify="true" netlify-honeypot="company-website" hidden>` with one input per `HOSTED_REQUEST_FIELDS` entry. The file carries `<meta name="robots" content="noindex">`, and `__forms.html` joins `PWA_WORKBOX.globIgnores` so no install precaches it (D2). Netlify's deploy step parses it and registers the form. It is web only (desktop has no Netlify), and it goes in `generateBundle` because `public/` and `index.html` are shared with desktop. |
| `src/lib/i18n/translations/{en,ar}.json` | New `landing.hostedOffer.*` keys (hero, benefits ×5, migration band, form labels, placeholders, errors, states, and "coming soon"). Also a new `landing.privacyPolicy.hostedRequest.{title,body}` and an updated `landing.privacyPolicy.updated`. |
| `src/pages/landing/PrivacyPolicyPage.tsx` | Add `'hostedRequest'` to `SECTION_KEYS` before `'contact'`. |
| `qa/features/web/landing.yaml` + `qa/specs/web/landing.spec.ts` | Add `@web.landing.hosted`: open `/hosted` in EN and AR, check axe, submit an empty form and see the errors, submit a valid form with `page.route('**/__forms.html')` stubbed to 200 and see success, then stubbed to 500 and see the error and retry. |

Nothing in `server/`, the hosted portal, the router, Dexie or the service worker changes. The PWA's `navigateFallbackAllowlist` is `/^\/app/`, so `/hosted` always comes from the network, like `/privacy`.

## 3. How a submission reaches Basel

1. At build time, `vite build --mode web` emits `dist-web/__forms.html`.
2. On deploy, Netlify's post-processing finds that file's form and registers `hosted-request` with its fields.
3. On submit, `fetch('/__forms.html', { method: 'POST', body: 'form-name=hosted-request&name=…' })`. POSTing to the real static file sidesteps the SPA's `/* → /index.html 200` rewrite, which can swallow form POSTs sent to `/`. Netlify stores the submission and filters it through its spam filter and the honeypot.
4. Netlify sends an email to Basel. The recipient is set in the Netlify UI, because netlify.toml cannot set it.

Data stored: only what the visitor types in, plus a hidden `language` field (`ar`/`en`) so Basel replies in the visitor's language. Basel approved the hidden field (D4). It extends the ticket's field list by this one field.

## 4. Copy rules (the honesty test pins these)

Benefits are limited to what has shipped:
1. Log income and expenses from your iPhone in seconds. The page shows availability only and never links a store (9A): visitors have no account yet, and the app is sign-in only.
2. Android shows a "coming soon" chip while `MOBILE_APP_LINKS.android.available` is false.
3. Your records on every device: the browser portal plus the phone, not one browser's storage.
4. Sign-in protects your records. If a laptop dies, nothing is lost with it.
5. Connected to Malafat, for lawyers and accountants.

Then the migration band (8A, "we" voice): "Already using the free app? Your records come with you." / "We'll move them into your hosted account with you, by hand. Nothing to type again."

The honesty test fails if the rendered page, in EN or AR, contains any of these:
- a currency amount or the words price/pricing/checkout/subscribe
- "reports"
- "create your own profiles"
- "automatic"/"sync" in the migration sense
- "backup" (until Basel confirms hosted backups as a promise)
- a signup or create-account action

## 5. Reuse analysis (COMPONENT_REGISTRY)

| Need | Reused | New |
|---|---|---|
| Page chrome | `LandingHeader`, `LandingFooter`, `LandingProviders`, `LandingPage.css` tokens | — |
| Fields | `Input`, `Textarea`, `Select` (`components/ui/Input`) | — |
| Button look | `Button.css` classes | — |
| Title | `useDocumentTitle` | — |
| Store-link config | the `download-config.ts` shape | `MOBILE_APP_LINKS` (MUT-173 reuses it) |
| Validation | Hand-written pure validator. `react-hook-form` and `zod` would add weight to the landing chunk for 2 required fields; the portal drawers use them because they have 10+ fields and edit flows. | `hostedRequest.ts` |

## 6. Error states

| State | What the visitor sees |
|---|---|
| Name or email empty, or email malformed | An inline error under the field; focus moves to the first invalid field; nothing is sent |
| Sending | The button is disabled and reads "Sending…" |
| Netlify answers 2xx | The form is replaced by a `role="status"` message: "Thanks, we'll be in touch with an offer" |
| Non-2xx, network error, offline, or no answer within 15 s (D5) | `role="alert"`: "Couldn't send. Check your connection and try again." The values are kept and the button reads "Try again" |
| Honeypot filled (a bot) | Sent anyway; Netlify drops it silently. The bot sees success |
| Running in `vite dev` (no Netlify) | The POST 404s and the error state shows. That is expected locally; the QA spec stubs the route |

## 7. i18n and RTL

Every string uses a key under `landing.hostedOffer.*` in both `en.json` and `ar.json`. A key-parity test asserts that both dictionaries have the same `landing.hostedOffer` key set. The layout uses logical properties only (`margin-inline`, `padding-inline-start`). The email and phone inputs carry `dir="ltr"`, so Latin text and digits read correctly inside an RTL page.

## 8. Cost

- Netlify Forms free tier: 100 submissions a month, then a paid add-on. Expected volume is far below that.
- No new runtime dependency. One small lazy chunk (an estimated few KB of JS plus the CSS), loaded only on `/hosted`.
- No server, GCP or database cost.

## 9. Infra: manual Netlify steps

netlify.toml cannot configure these. Record them in `.claude/INFRA.md`.

1. Site → Forms → **Enable form detection**, once, before the deploy that adds `__forms.html`. Otherwise the form is never registered.
2. Site → Forms → `hosted-request` → **Form notifications** → email Basel.
3. After the first deploy, submit once from production and confirm the email arrives. Claude cannot do this step; it depends on Basel's deploy (no auto-push or auto-deploy).

## 10. Open questions for the owner

1. ~~The hidden `language` field~~: resolved, include it (D4).
2. ~~App Store URL~~: moot for this page (9A). `/hosted` needs only `available` flags: ios `true`, android `false` until the listing is live.

## 11. Test plan (written first)

| File | Cases |
|---|---|
| `src/pages/landing/__tests__/hostedRequest.test.ts` | validate: name and email required; whitespace-only counts as empty; bad email rejected; optional fields may be empty; a valid set returns no errors. encode: includes `form-name`; trims values; joins devices; sends the honeypot as empty; includes `language` (D4); emits exactly `form-name` plus `HOSTED_REQUEST_FIELDS`, with no extra keys. submit: POSTs to `NETLIFY_FORMS_PATH` with the urlencoded header; 200 → ok; 500 → error; a thrown error → error; no response within `SUBMIT_TIMEOUT_MS` → error, with the fetch aborted (fake timers, D5). |
| `src/pages/landing/__tests__/HostedOfferPage.test.tsx` | Renders under `LandingProviders`. Shows the 5 benefits and the migration band. Shows the Android "coming soon" chip when `available` is false and hides it when true (`vi.mock` the config); asserts **no** apps.apple.com / play.google.com anchor on the page (9A). An empty submit shows two errors, focuses name and does not call fetch. Sending disables the button. Success shows the status message. A failure shows the alert, keeps the values, and a retry posts again. The notice under the button links to `/privacy` (D3). In AR, `dir="rtl"` and Arabic copy. **Honesty**: no forbidden strings in EN or AR. |
| `src/pages/landing/__tests__/hostedOfferKeys.test.ts` | `landing.hostedOffer` key parity between EN and AR, and no empty strings. |
| `src/pages/landing/__tests__/PrivacyPolicyPage.test.tsx` | The new `hostedRequest` section renders and names Netlify. |
| `scripts/__tests__/vite-config.test.ts` | `netlifyForms()` emits `__forms.html` containing `data-netlify="true"`, the form name, the honeypot attribute, a noindex robots meta (D2), and an input for every `HOSTED_REQUEST_FIELDS` entry. `PWA_WORKBOX.globIgnores` contains `__forms.html` (D2). The desktop config doesn't include the plugin. |
| `qa/specs/web/landing.spec.ts` | `@web.landing.hosted` as in §2. |

Verification, run under Node 22 (TD-054):

```bash
npm run lint && npm run typecheck && npm run test:run && npm run build:web && npm run test:bundles
```

`test:bundles` proves the desktop bundle contains no `/hosted` page code.

## 12. Knowledge updates on completion

- CHANGELOG
- COMPONENT_REGISTRY: `HostedOfferPage`, `HostedRequestForm`, `hostedRequest.ts`, the `download-config.ts` additions
- PATTERNS: add `/hosted` to the instances of the marketing-pages pattern, plus a new "Netlify Forms in a shared-index SPA: a build-emitted static definition and a POST to the static file" pattern
- INFRA: the Netlify manual steps
- TEST_PLAN
- No new ADR. The front-door decision is recorded on MUT-185 and in memory; ADR-037 is untouched.

## 13. Design decisions (/plan-design-review, 2026-10-14)

Wireframe: `.claude/designs/mut-186-hosted-offer-wireframe.html`. It is a proposal; only the decisions listed here are approved.

### Page structure (1A)

```
┌ LandingHeader (brand + language toggle; no CTA, like /privacy) ─────────┐
│ 1 HERO        headline · one sentence · [Request an account] · no-price  │
│               line                  visual anchor: same balance, laptop + phone │
│ 2 COMPARISON  "Free or hosted": 7-row table, Free app | Hosted (tinted)   │
│ 3 BAND        migration promise (inverted, reuses landing-privacy-band)  │
│ 4 FORM #request  title · lead · fields · button · privacy notice         │
└ LandingFooter ──────────────────────────────────────────────────────────┘
```

- **1A, comparison table (approved).** The middle of the page is a two-column table, not a benefits list. The rows are:
  1. Where your records live
  2. Devices
  3. Phone app (iOS, with Android marked "coming soon" until configured)
  4. If your laptop is lost
  5. Malafat
  6. Account
  7. Price ("Free" vs "An offer for what you need")

  The Hosted column carries the lavender tint. A real `<table>` with `<th scope="row">` row headers. On phones (≤640px) each row stacks as label, then Free, then Hosted, each value captioned with its column name. This replaces the "Benefits to cover" list as the way AC2's benefits are shown; the honesty rules in §4 apply to every cell.

### Form states (2A, approved)

| State | What the visitor sees |
|---|---|
| Idle | The form; the submit button reads "Send request"; the privacy notice sits under the button (D3) |
| Invalid | Inline rose-ink error under each bad field, with `aria-invalid` and `aria-describedby`; focus moves to the first invalid field. Copy: "Enter your name." / "Enter an email address like name@example.com." (the example address is wrapped in an LTR isolate) |
| Sending | The button is disabled and reads "Sending…". Fields stay editable but are not re-sent. |
| Error | A rose alert directly above the submit button (moved during the build from "above the form", which sat off-screen when a visitor at the button saw it fail), `role="alert"`: "Couldn't send. Check your connection and try again. Your answers are still here." The button reads "Try again". |
| **Success (2A)** | The form is replaced by a mint panel, `role="status"`, and focus moves to its heading. Contents: **"Request sent."** / "Thanks, {name}. We'll reply to {email} with an offer." ({email} in an LTR isolate) / a **"Wrong email? Edit and send again"** link that brings the form back with its values kept / **"Keep using the free app meanwhile"**, linking to `WEB_APP_URL`. |

### Hero copy (3A, approved)

- **H1:** EN "Your records, on every device." / AR "سجلّاتك، على كل أجهزتك."
- **Sub:** EN "The free app keeps everything on this one device. Hosted keeps it on our servers, behind your sign-in, so your phone and your laptop show the same numbers." / AR "التطبيق المجاني يحفظ كل شيء على هذا الجهاز وحده. أما الحساب المستضاف فيحفظه على خوادمنا، خلف تسجيل دخولك، فيعرض هاتفك وحاسوبك الأرقام نفسها."
- **Button:** "Request an account" / "اطلب حسابًا", an in-page link to `#request`.
- **Under the button:** "No price list. Tell us what you need and we'll send you an offer." / "لا توجد قائمة أسعار. أخبرنا بما تحتاجه ونرسل لك عرضًا."

The full EN/AR strings for the comparison, the band and the form are in the wireframe's `T` dictionary and are the starting copy for `landing.hostedOffer.*`. The honesty test (§4) still applies to all of them.

### Journey storyboard

```
STEP | VISITOR DOES                        | FEELS                          | SUPPORTED BY
1    | Arrives from the free app or a link | curious, wary ("an account?")  | 3A hero names the trade
2    | Scans the comparison                | weighing the trade             | 1A table
3    | Reads the band                      | relief: "my data comes along"  | band copy (§4)
4    | Fills the form                      | "what will it cost me?"        | 3A no-price line; optional fields marked
5    | Sends                               | anticipation                   | 2A confirmation
6    | Waits for the offer                 | "when will I hear?"            | 4A "within 2 working days", shown before and after sending
```

### Reply expectation (4A, approved)

- Form lead: EN "Tell us about your work. We'll reply by email within 2 working days with an offer." / AR "أخبرنا عن عملك، ونردّ عليك بالبريد الإلكتروني خلال يومَي عمل بعرض."
- The success panel (2A) repeats it: "Thanks, {name}. We'll reply to {email} within 2 working days with an offer."
- The number lives only in these strings, so changing it is a copy edit. **This is an operational promise Basel keeps by hand.**

### Hero visual anchor (5A, approved)

- **New static mock** `HostedDevicesMock` in `src/pages/landing/components/mocks/`, `aria-hidden="true"` (decorative; the headline carries the meaning).
- **Laptop frame** (browser chrome dots, 72% of the column) and a **phone frame** overlapping its inline-end corner. Both show the same sample client's "Owed now" balance in Plex Mono tabular figures, with names from `sampleData.ts` and money formatted through `useMockFormat`, like the other landing mocks.
- **Caption:** "Logged on the phone, there on the laptop." / "تسجّله على الهاتف، فتجده على الحاسوب."
- **Desktop:** the hero is a two-column grid (copy 1.05fr, anchor 1fr), with the copy start-aligned, not centred.
- **≤640px:** single column, only the phone frame, centred under the button, no caption.
- **Motion:** none new. The page follows MUT-77's landing contract: content visible by default, and no reveal without IntersectionObserver or under reduced motion.

### Token and class map (6A, approved)

| Element | Tokens / classes |
|---|---|
| Hero H1 | `--font-heading` (`--font-heading-ar` under `:lang(ar)`), `clamp(40px, 5vw, var(--text-display))`, `--text` |
| Section h2s (comparison, form) | `.landing-section-headline` plus a new `.landing-section-headline--start` modifier (start-aligned); the band keeps `.landing-privacy-title` (centred) |
| Hero sub, leads | `--text-headline` (hero) / `--text-body`, colour `--text-secondary` |
| Primary button (hero, submit) | Button.css classes `btn btn-primary` (filled, `--on-accent`, `--focus-ring-on-fill`) |
| Comparison section | Background `--surface`; rules `--table-border`; Hosted header `--accent-subtle` bg + `--on-accent-subtle` text; Hosted cells `color-mix(--accent-subtle 35%)` with `--text` |
| Migration band | Reuse `.landing-privacy-band`, `.landing-privacy-title`, `.landing-privacy-body` (no new band class) |
| Fields | `Input`, `Textarea`, `Select` from `components/ui/Input` (`--input-*` tokens) |
| Error alert, field errors | `--badge-overdue-bg` / `--badge-overdue-text` |
| Success panel | `--badge-paid-bg` / `--badge-paid-text` |
| Links (notice, success) | `--link`, `--link-hover`, `--link-visited` |
| "Coming soon" chip | `--badge-neutral-bg` / `--badge-neutral-text` |

No new values enter the token files.

### Device checkboxes (7A, approved)

- A `fieldset` with the legend "Where do you want to use it? (optional)".
- Each option is a `<label>` pill wrapping a native checkbox. The pill is `min-height: 44px` with `padding-inline: 14px`, a `--border` outline, `--surface` background and pill radius. The checkbox uses `accent-color: var(--accent-solid)`.
- A checked pill (`:has(:checked)`) gets an `--accent-subtle` background, and `:focus-within` shows the focus ring on the pill.
- The pills sit in a wrapping flex row with a 10px gap.
- This styling is landing-only CSS, not a shared component.

### Voice (8A, approved)

The page speaks as "we" throughout, like the rest of the landing page. The migration band reads: "Already using the free app? Your records come with you." / "We'll move them into your hosted account with you, by hand. Nothing to type again." In Arabic: "تستخدم التطبيق المجاني؟ سجلّاتك تنتقل معك." / "ننقلها معك إلى حسابك المستضاف يدويًا. لا حاجة لإدخال أي شيء من جديد." §4 is updated to match.

### App store links (9A, approved)

`/hosted` shows app availability only, with no store anchors. Every visitor here is account-less, and the apps are sign-in only, so a store link would lead to a sign-in wall. The "Phone app" Hosted cell reads "iPhone app for logging income and expenses in seconds", plus an "Android coming soon" chip while `android.available` is false. Store URLs belong in the welcome email Basel sends with the account, and in MUT-173 for existing customers. This changes ticket AC2's wording; a comment on MUT-186 records it.

### Design implementation additions (from 2A, 5A, 6A, 7A)

- `src/pages/landing/components/mocks/HostedDevicesMock.tsx` (new, 5A), exported from the mocks index.
- `.landing-section-headline--start` modifier in `LandingPage.css` (6A).
- `HostedRequestForm`'s success panel has an "edit and send again" path that returns to the form with values kept (2A). The page test asserts it.
- The device pills' CSS lives in `HostedOfferPage.css` (7A).

### As built (MUT-186 build, 2026-10-14)

- **Added during the build:** `hostedOfferDevRoute()` in `vite.config.ts`. In dev, Vite served `/hosted` from the portal's root `hosted.html`; production is unaffected, because the web build has no `hosted.html`. Covered in `vite-config.test.ts`.
- **Changed from the approved states table (2A row "Error"):** the failure alert sits directly above the submit button, not above the form. In the browser it was off-screen for a visitor at the button.
- **Not done as planned:** no `qa/features/web/landing.yaml`. No landing spec is catalogued yet, so this is TD-130 instead of a one-feature area.
- **Found by axe in QA:** in-text links on the page are underlined (`link-in-text-block`).
- **/qa-reconcile (Basel's answers, 2026-10-14):**
  - Honeypot renamed to `bot-field` and hidden with `hidden`.
  - `request-id` field added.
  - Length limits added.
  - Trailing slash accepted.
  - `/hosted` gets its own link-preview HTML (`hosted-offer.html`).
  - Privacy copy completed, with 12-month retention.
  - Spam handled with operator steps now; Turnstile is MUT-197. reCAPTCHA was declined: Google keys plus a third-party script on a no-tracking page.
  - Fields sent are now `HOSTED_REQUEST_FIELDS` + `request-id`, with `bot-field` as the honeypot.

---

# Eng review (/plan-eng-review, 2026-10-14)

Target: `.claude/designs/mut-186-hosted-offer-page.md`. The original plan text is above; the edits made after review answers are marked with their D number.

## Scope record

feature answers: none proposed. Desktop is out of scope per Basel (2026-10-14, chat: "skip desktop for now, we're going to retire it until v2"). That is a scope fact, not a cut from this review.
structure: B, Smaller arrangement (D1, answered 2026-10-14)
accepted scope: 12 files. No `hosted-offer-config.ts`. `HOSTED_OFFER_URL` and `MOBILE_APP_LINKS` go in `src/content/download-config.ts`. The form constants live in `src/pages/landing/hostedRequest.ts`, and `vite.config.ts` imports them from there.
pending remedies: none

## Decision ledger

### R1: static form file hygiene
Finding: A1, P2, confidence 8/10. vite.config.ts:105 `globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"]` would precache the emitted `__forms.html`, and that file has no robots directive. Reviewer: Claude (plan-eng-review).
Plan baseline: the original proposal emits `__forms.html` with only the hidden form (design §2, vite.config.ts row).
Runtime evidence: `globIgnores` is currently `["og-*.png"]` (vite.config.ts:107), and no robots meta exists anywhere in the repo (grep found none).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 `__forms.html` hygiene | precached, indexable | add `__forms.html` to `globIgnores` and emit `<meta name="robots" content="noindex">`; the vite-config test asserts both | leave as is |
Question D2:
D2: Keep the hidden Netlify form file out of the service worker and out of search results?
ELI10: Netlify needs a hidden HTML file listing the form's fields. As planned, the offline service worker would download it on every install, and Google could index it as an empty page. Two lines fix both: tell the service worker to skip it, and mark it noindex.
Stakes if we pick wrong: A blank "hosted-request" page shows up in search results for the brand, and every install caches a file nobody opens.
Recommendation: A because it costs two lines plus two test assertions and removes both side effects.
Completeness: A=10/10, B=6/10
Header: Form file hygiene
Options:
A) Skip SW + noindex (recommended)
Add `__forms.html` to PWA_WORKBOX.globIgnores and emit a noindex robots meta in it. vite-config.test.ts asserts both. human ~20min / CC ~3min. No ongoing maintenance.
B) Leave as planned
Emit the bare hidden form. The file is precached by every install and indexable. human/CC 0.

State: approved
Actual answer: A) Skip SW + noindex (AskUserQuestion D2, 2026-10-14)
Accepted scope: Add `"__forms.html"` to PWA_WORKBOX.globIgnores. The emitted `__forms.html` carries `<meta name="robots" content="noindex">`. vite-config.test.ts asserts both.
History: none

### R2: privacy notice at the submit button
Finding: A2, P2, confidence 7/10. Design §2 HostedRequestForm row: the form collects name, email and phone, but there is no notice next to submit. Reviewer: Claude (plan-eng-review).
Plan baseline: the original proposal covers data use only in the /privacy section (AC9).
Runtime evidence: there is no form anywhere on the landing pages today (grep found only the privacy page).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 form-file hygiene | approved A (D2) | unchanged | unchanged |
| R2 notice by submit | none | one line under the button: "We use these details only to reply with an offer. Privacy policy" with a link to /privacy, EN+AR; the page test asserts the link | none (privacy page only) |
Question D3:
D3: Add a one-line privacy notice under the submit button?
ELI10: People give their name, email and phone here. A short line under the button says the details are used only to reply with an offer, and links to the privacy policy. It's the usual small reassurance on a contact form, and it costs one i18n key pair.
Stakes if we pick wrong: Visitors hesitate to hand over a phone number with no word on what happens to it, and the policy is two clicks away.
Recommendation: A because it builds the trust the page is selling, for one string.
Completeness: A=10/10, B=7/10
Header: Submit notice
Options:
A) Add notice + link (recommended)
One line under the submit button: "We use these details only to reply with an offer." plus a "Privacy policy" link to /privacy. EN and AR keys; the page test asserts the link target. human ~20min / CC ~3min.
B) Privacy page only
No notice on the form. Data use is explained only in the /privacy section that AC9 adds. human/CC 0.

State: approved
Actual answer: A) Add notice + link (AskUserQuestion D3, 2026-10-14)
Accepted scope: One line under the submit button, "We use these details only to reply with an offer.", plus a "Privacy policy" link to /privacy. EN and AR keys. The page test asserts the link target.
History: none

### R3: hidden `language` field
Finding: Owner question from design §10.1. The ticket's field list has no language, but Basel replies by hand and the page runs in two languages. Reviewer: Claude (plan-eng-review).
Plan baseline: the original proposal (§3) adds a hidden `language` field (`ar`|`en`) from the active locale, flagged as beyond the ticket's field list.
Runtime evidence: `useLanguage()` already exposes the active language on landing pages (LandingProviders → LanguageProvider).
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 form-file hygiene | approved A (D2) | unchanged | unchanged |
| R2 submit notice | approved A (D3) | unchanged | unchanged |
| R3 hidden language field | proposed, not approved | include `language` (ar/en) in HOSTED_REQUEST_FIELDS, the static form and encode; tests assert it | ticket fields only |
Question D4:
D4: Send the visitor's page language with each request?
ELI10: The page works in Arabic and English. A hidden field would tell you which one the visitor was reading, so your offer goes back in their language without guessing from their name. The visitor types nothing extra. It goes one step beyond the field list in the ticket, so it's your call.
Stakes if we pick wrong: You reply in English to someone who only reads Arabic, or the other way round, at the moment you're trying to win them.
Recommendation: A because it's free for the visitor and it removes a guess from every reply.
Completeness: A=10/10, B=8/10
Header: Language field
Options:
A) Include language (recommended)
A hidden `language` field (ar/en) from the active locale, declared in HOSTED_REQUEST_FIELDS and the static form. The encode test asserts it, and the ticket's field list is noted as extended. human ~15min / CC ~2min.
B) Ticket fields only
Exactly the ticket's fields. You infer the language from the message or the name. human/CC 0.

State: approved
Actual answer: A) Include language (AskUserQuestion D4, 2026-10-14)
Accepted scope: A hidden `language` field (ar/en) from the active locale, declared in HOSTED_REQUEST_FIELDS and in the static form. The encode test asserts it. The ticket's field list is extended by this one hidden field.
History: none

### R4: submit timeout
Finding: C1, P2, confidence 8/10. Design §2 hostedRequest.ts row: "Any non-2xx response or a thrown error gives 'error'". A request that hangs never settles, so the button stays on "Sending…" for good. Reviewer: Claude (plan-eng-review).
Plan baseline: the original proposal sets no timeout on `submitHostedRequest`.
Runtime evidence: src/hooks/useLatestRelease.ts:80 already applies the repo's pattern, `const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);`.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 form-file hygiene | approved A (D2) | unchanged | unchanged |
| R2 submit notice | approved A (D3) | unchanged | unchanged |
| R3 language field | approved A (D4) | unchanged | unchanged |
| R4 submit timeout | none (can hang forever) | abort after `SUBMIT_TIMEOUT_MS = 15000` ms using the useLatestRelease AbortController pattern; abort → `'error'`; a fake-timer test asserts it | none |
Question D5:
D5: Give up on a stuck submission after 15 seconds and show the retry state?
ELI10: On a bad connection the request can just hang. The plan only handles a server error or a dropped connection, so a hang leaves the button spinning forever and the visitor never sees "Try again". The app already handles this elsewhere: the release check gives up after a set time. Doing the same here turns a hang into the normal retry state.
Stakes if we pick wrong: A visitor on a weak mobile connection stares at "Sending…" forever and leaves, and you never learn they were interested.
Recommendation: A because it reuses an existing pattern and closes the one way the form can trap a visitor.
Completeness: A=10/10, B=7/10
Header: Submit timeout
Options:
A) 15s timeout (recommended)
`submitHostedRequest` aborts after SUBMIT_TIMEOUT_MS = 15000 (a named constant), copying useLatestRelease's AbortController + setTimeout pattern. An abort resolves to 'error', which shows the existing retry state. A fake-timer unit test asserts it. human ~30min / CC ~5min.
B) No timeout
Keep the plan as is. A hung request leaves the button on "Sending…" until the browser gives up, which can take minutes. human/CC 0.

State: approved
Actual answer: A) 15s timeout (AskUserQuestion D5, 2026-10-14)
Accepted scope: `submitHostedRequest` aborts after `SUBMIT_TIMEOUT_MS = 15000`, copying useLatestRelease's AbortController + setTimeout pattern. An abort resolves to `'error'`, which shows the retry state. A fake-timer unit test asserts it.
History: none

Approval readiness: PASS. Scope comes from D1; the approved choices are R1 (D2), R2 (D3), R3 (D4) and R4 (D5). Each one cites its own AskUserQuestion answer from 2026-10-14.

## Review findings and dispositions

- **Scope Challenge:** No issues found. Scope accepted as-is with the smaller arrangement (D1); no scope reduction.
- **Architecture:** A1 `[P2] (8/10) vite.config.ts:105`: the service worker would precache `__forms.html`, which is also indexable. Accepted (D2). A2 `[P2] (7/10)` design §2: no data notice at the submit button. Accepted (D3). The owner's open question on the hidden language field was accepted (D4).
- **Code quality:** C1 `[P2] (8/10)` design §2 hostedRequest.ts row: a hung POST never settles. Accepted (D5).
- **Tests:** coverage diagram produced; 0 gaps after D2 to D5. The QA artifact is at `~/.gstack/projects/vAWK3-mutaba3a/basel-main-eng-review-test-plan-20261014-125300.md`.
- **Performance:** No issues found.

## NOT in scope

- **Desktop (Tauri) builds.** Basel is retiring desktop until v2, so beyond the existing `__BUILD_MODE__ === 'web'` gate there's no desktop work.
- **`initDatabase()` running on marketing pages** (`src/main.tsx`, before the path switch). This is pre-existing and also true of `/`, `/privacy` and `/download`. Fixing it is a separate change.
- **A landing-page link to `/hosted`.** MUT-172 (landing CTA) and MUT-187 (in-app CTA) add the entry points.
- **Lead storage on our server, a CRM, or analytics on submissions.** Netlify Forms was chosen at intake; analytics belongs to MUT-152/154.
- **A sign-in link to the portal on `/hosted`.** That is MUT-187/188 territory.

## What already exists

- `LandingProviders`, `LandingHeader`, `LandingFooter` and the `LandingPage.css` tokens: reused as-is (PATTERNS "Marketing pages render only landing chrome").
- `Input`, `Textarea` and `Select` (`components/ui/Input`) and the `Button.css` classes: reused.
- `src/content/download-config.ts`: extended rather than duplicated (D1).
- The `socialMeta()` web-only Vite plugin: the template for `netlifyForms()`.
- The `useLatestRelease.ts:80` AbortController timeout: copied for D5. It isn't extracted into a shared helper, because there are only two callers with different result shapes, which fails the shared-code rubric.

## Diagram: submission flow

```
visitor ── fills form ──> validateHostedRequest ──invalid──> inline errors, focus first field
                                   │ valid
                                   v
                    status=sending (button disabled)
                                   │
            submitHostedRequest: POST /__forms.html (urlencoded, form-name, language, honeypot)
                 │ 2xx                 │ non-2xx / throw            │ 15 s, no answer
                 v                     v                             v
          status=success         status=error  <──── abort ──────────┘
       (role=status thanks)   (role=alert, values kept, "Try again")
                 │
   Netlify: spam filter + honeypot → stores → emails Basel (UI-configured, §9)
```

## Failure modes

| Path | Realistic failure | Covered by | Visitor sees |
|---|---|---|---|
| Static definition | Field renamed in React, not in `HOSTED_REQUEST_FIELDS` → Netlify drops it | Single source of truth + encode "exact keys" test + vite-config test | Nothing; the field would be lost silently, which these tests prevent |
| Form detection | Detection left off in the Netlify UI → POST 404 | Manual §9 step 1 + the post-deploy check | The error state with retry (not silent) |
| Email notification | Notification not set up → submissions only in the dashboard | Manual §9 step 2 | Success; **Basel** misses the lead. This is operational, not code, and the post-deploy check catches it |
| Hung request | Weak mobile network | D5 timeout + test | The error state after 15 s |
| Spam | Bot fills honeypot | Netlify drops it | n/a |

Critical gaps: 0. No path is untested, unhandled and silent all at once. The email-notification risk is operational and is covered by the §9 manual check.

## Worktree parallelization strategy

Sequential implementation, no parallelization opportunity: one module (`src/pages/landing` plus its config), and `vite.config.ts` depends on `hostedRequest.ts`.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P2, human: ~20min / CC: ~3min)** — vite.config.ts — Keep `__forms.html` out of the SW precache and out of search results
  - Surfaced by: Architecture A1, vite.config.ts:105 globPatterns includes html
  - Files: vite.config.ts, scripts/__tests__/vite-config.test.ts
  - Verify: `npm run test:run -- scripts/__tests__/vite-config.test.ts`
- [ ] **T2 (P2, human: ~20min / CC: ~3min)** — HostedRequestForm — Add the privacy notice + /privacy link under the submit button
  - Surfaced by: Architecture A2
  - Files: src/pages/landing/components/HostedRequestForm.tsx, en.json, ar.json, HostedOfferPage.test.tsx
  - Verify: `npm run test:run -- src/pages/landing`
- [ ] **T3 (P2, human: ~15min / CC: ~2min)** — hostedRequest.ts — Send the hidden `language` field
  - Surfaced by: the owner question in design §10.1 (D4)
  - Files: src/pages/landing/hostedRequest.ts, HostedRequestForm.tsx, hostedRequest.test.ts
  - Verify: `npm run test:run -- src/pages/landing/__tests__/hostedRequest.test.ts`
- [ ] **T4 (P2, human: ~30min / CC: ~5min)** — hostedRequest.ts — Abort a stuck POST after 15 s and resolve to `'error'`
  - Surfaced by: Code quality C1
  - Files: src/pages/landing/hostedRequest.ts, hostedRequest.test.ts
  - Verify: `npm run test:run -- src/pages/landing/__tests__/hostedRequest.test.ts`

_No new tasks from Scope Challenge, Tests or Performance._

## Unresolved decisions

None. The App Store URL (§10.2) is a fact to supply, not a design decision: `MOBILE_APP_LINKS.ios.url` ships as `null` ("coming soon") until Basel provides it.

## Completion summary

- Step 0: Scope Challenge — scope accepted as-is (smaller arrangement, D1)
- Architecture Review: 2 issues found
- Code Quality Review: 1 issue found
- Test Review: diagram produced, 0 gaps identified
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed to user
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: codex, unavailable (CLI not installed; native fallback lacks a task-output tool)
- Parallelization: 1 lane, 0 parallel / 1 sequential
- Lake Score: 4/4 (D2 to D5 each picked the 10/10 option)

## Appendix: suppressed findings

- `(confidence: 5/10) tsconfig.node.json`: its `lib: ["ES2023"], "types": ["node"]` means `hostedRequest.ts`, which `vite.config.ts` imports, must avoid DOM-only types. Node's types cover `fetch`/`URLSearchParams`/`AbortController`, and `build:web` (`tsc -b`) checks the node program. Verify at build; no plan change.
- `(confidence: 4/10)` Input max lengths: Netlify accepts large bodies; a 2000-character `message` cap would be cosmetic. Not raised.

---

# Design review (/plan-design-review, 2026-10-14)

Target: this plan. The design system is the Brand v2 kit (`docs/brand/README.md`); there is no DESIGN.md. Visuals are an HTML wireframe (Basel's preference), `.claude/designs/mut-186-hosted-offer-wireframe.html`, now marked approved. The outside design voice was skipped by choice (Codex is not installed). The decisions are recorded in §13 above.

## Passes

| Pass | Before | After | Decisions | Remaining gap |
|---|---|---|---|---|
| 1 Information architecture | 4 | 9 | 1A comparison table | none |
| 2 Interaction states | 7 | 9 | 2A personal confirmation | none (the edit-and-resend path is tested) |
| 3 Journey and emotional arc | 4 | 9 | 3A hero names the trade, 4A 2-working-day reply | the reply promise is operational, kept by Basel |
| 4 AI-slop risk (Persuade) | 5 | 9 | 5A two-screen anchor | the mock must track the real client screen, like the other landing mocks |
| 5 Design system alignment | 4 | 9 | 6A token and class map | one new modifier class |
| 6 Responsive and a11y | 7 | 9 | 7A 44px pill checkboxes | none; the anchor jump is already covered by LandingPage.css:165 |
| 7 Unresolved decisions | — | — | 8A "we" voice, 9A no store links | none |

Litmus (Persuade):
- brand in the first screen: YES
- one visual anchor: YES (5A)
- scannable by headlines alone: YES
- one job per section: YES
- cards necessary: no cards used
- motion: the MUT-77 contract is inherited, nothing new
- premium without shadows: YES

Hard rejections: none.

## NOT in scope (design)

- **Testimonials or social proof.** There are no customers to quote yet, and inventing quotes would break the honesty rules.
- **A price or a plan table.** Basel quotes by hand (MUT-185).
- **A header CTA on /hosted.** The `/privacy` pattern applies, and the hero button plus the anchor jump are enough.
- **A new motion moment.** The landing's restrained-motion contract (MUT-77) is inherited.
- **A shared checkbox component for the app.** The 7A pills are landing-only CSS.

## What already exists (design)

- `LandingHeader`, `LandingFooter`, the skip link, `LandingPage.css` sections and container, and the `scroll-padding-top` anchor offset
- `.landing-privacy-band` (reused as the migration band)
- the landing mock vocabulary (`landing-mock-*`, `sampleData.ts`, `useMockFormat`), which `HostedDevicesMock` builds on
- `Input`, `Textarea` and `Select`, and the `Button.css` classes
- the AAA-tested badge pairs (paid = mint, overdue = rose, neutral)

## TODOS.md

No items proposed. Every approved fix is in the implementation tasks below.

## Design implementation tasks

- [ ] **DT1 (P2, human: ~3h / CC: ~20min)** — HostedOfferPage — Build the free-vs-hosted comparison table with its phone stacking
  - Surfaced by: Pass 1, 1A
  - Files: src/pages/landing/HostedOfferPage.tsx, HostedOfferPage.css, en.json, ar.json
  - Verify: page test (7 rows, `th scope=row`, Hosted column); QA spec at 390px
- [ ] **DT2 (P2, human: ~1.5h / CC: ~10min)** — HostedRequestForm — Build the personal success panel, edit-and-resend and the free-app link
  - Surfaced by: Pass 2, 2A
  - Files: src/pages/landing/components/HostedRequestForm.tsx, HostedOfferPage.test.tsx
  - Verify: `npm run test:run -- src/pages/landing` (success shows the name and email; edit restores the values; the link targets WEB_APP_URL)
- [ ] **DT3 (P2, human: ~30min / CC: ~5min)** — copy — Add the hero, reply-time and "we"-voice strings in EN and AR
  - Surfaced by: Pass 3/7, 3A, 4A, 8A
  - Files: en.json, ar.json
  - Verify: key-parity test; honesty test
- [ ] **DT4 (P2, human: ~3h / CC: ~20min)** — mocks — Build HostedDevicesMock (laptop + phone, same balance)
  - Surfaced by: Pass 4, 5A
  - Files: src/pages/landing/components/mocks/HostedDevicesMock.tsx, mocks index, HostedOfferPage.css
  - Verify: page test (aria-hidden; phone only at ≤640 via the QA spec); axe in QA
- [ ] **DT5 (P2, human: ~45min / CC: ~5min)** — styles — Apply the 6A token map and the `.landing-section-headline--start` modifier
  - Surfaced by: Pass 5, 6A
  - Files: LandingPage.css, HostedOfferPage.css
  - Verify: `landingCss.test.ts` + axe contrast in QA (light and dark)
- [ ] **DT6 (P2, human: ~30min / CC: ~5min)** — form — Build the 44px device pills with a :focus-within ring
  - Surfaced by: Pass 6, 7A
  - Files: HostedRequestForm.tsx, HostedOfferPage.css
  - Verify: QA spec measures pill height ≥ 44px
- [ ] **DT7 (P2, human: ~20min / CC: ~3min)** — config — Add `available` flags to MOBILE_APP_LINKS; no store anchors on /hosted
  - Surfaced by: Pass 7, 9A
  - Files: src/content/download-config.ts, HostedOfferPage.test.tsx
  - Verify: the page test asserts no apps.apple.com / play.google.com anchors

## Design completion summary

```
  +====================================================================+
  |         DESIGN PLAN REVIEW — COMPLETION SUMMARY                    |
  +====================================================================+
  | System Audit         | No DESIGN.md (Brand v2 kit used); UI scope   |
  | Step 0               | 5/10; all 7 passes; HTML wireframe           |
  | Pass 1  (Info Arch)  | 4/10 → 9/10 after fixes                     |
  | Pass 2  (States)     | 7/10 → 9/10 after fixes                     |
  | Pass 3  (Journey)    | 4/10 → 9/10 after fixes                     |
  | Pass 4  (AI Slop)    | 5/10 → 9/10 after fixes                     |
  | Pass 5  (Design Sys) | 4/10 → 9/10 after fixes                     |
  | Pass 6  (Responsive) | 7/10 → 9/10 after fixes                     |
  | Pass 7  (Decisions)  | 2 resolved, 0 deferred                      |
  +--------------------------------------------------------------------+
  | NOT in scope         | written (5 items)                           |
  | What already exists  | written                                     |
  | TODOS.md updates     | 0 items proposed                            |
  | Approved Mockups     | 1 HTML wireframe, approved                  |
  | Decisions made       | 9 added to plan (1A–9A)                     |
  | Decisions deferred   | 0                                           |
  | Overall design score | 4/10 → 9/10                                 |
  +====================================================================+
```

Plan is design-complete. Run /design-review after implementation for visual QA.

## Approved Mockups

| Screen/Section | Mockup Path | Direction | Notes |
|----------------|-------------|-----------|-------|
| /hosted (all sections, EN/AR, light/dark, phone, 5 form states) | /Users/basel/Work/elMokhtbr/Mutaba3a/mini-crm/.claude/designs/mut-186-hosted-offer-wireframe.html | Start-aligned hero with a two-screen balance anchor; comparison table; inverted band; single-column form | Fonts load only when opened from disk in a browser; the toolbar is a review aid, not design |

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Outside Review | codex via `/plan-eng-review` | Independent 2nd opinion | 24 | unavailable | CLI not installed; no outside coverage |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 23 | issues_open | 3 issues, 0 critical gaps (all resolved: D2–D5) |
| Design Review | `/plan-design-review` | UI/UX gaps | 5 | clean | score: 4/10 → 9/10, 9 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | — |

- **OUTSIDE COVERAGE:** codex, plan-review phase: unavailable (not installed). Design outside voices: skipped by user choice.
- **VERDICT:** DESIGN CLEARED. Eng review is logged issues_open, but its 3 findings were all resolved by answer (D2–D5) with nothing open. The design decisions add a mock component, a success edit path and an `available` flag, all inside the eng plan's architecture, so no eng re-run is needed.

NO UNRESOLVED DECISIONS
