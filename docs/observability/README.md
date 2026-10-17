# Error reporting (Sentry)

ADR-091, epic MUT-146. This folder is the one rulebook for what Mutaba3a's error reports may
contain. MUT-147 set it up. The surface stories wire it in:

- MUT-148: API server
- MUT-149: hosted portal
- MUT-150: landing pages
- MUT-151: phone app

## Who sends

| Surface | Sentry project | Sends |
|---|---|---|
| Hosted API (`server/`) | `mutaba3a-api` | Unknown errors and `ApiError`s with status 500 or higher |
| Hosted portal (`--mode hosted`) | `mutaba3a-portal` | Crashes, uncaught errors, unhandled rejections |
| Landing pages (`/`, `/download`, `/privacy`, lazy chunks only) | `mutaba3a-landing` | The same as the portal, with no user context |
| Capture app (Flutter, iOS + Android) | `mutaba3a-capture-app` | Dart, Flutter-framework and native crashes |

**Never:** the local web app (`/app`) or desktop. They send nothing, ever (ADR-024, ADR-090).

Crash reports are **not** opt-in, unlike analytics. They contain no content, and the privacy
policy says they're sent. Data goes to Sentry's EU region (`de.sentry.io`, Frankfurt), in a
Mutaba3a-only org.

Only production builds get a DSN, so dev, QA and preview builds send nothing.

## The two files

| File | What it holds | Who reads it at runtime |
|---|---|---|
| `sentry-rules.json` | deny lists, allowed tags and user keys, safe and always-dropped context keys, ignored errors, required SDK options, org settings | the portal and landing may import it; the server and phone **embed** its lists in code, and a test asserts they are equal |
| `sentry-fixtures.json` | "dirty event in, clean event out" cases, one or more per surface | **tests only**: never import it into an app. It carries the marker `MUT147-SENTRY-FIXTURE-DO-NOT-BUNDLE`, and `check-bundles` fails if that marker appears in a bundle |

`scripts/__tests__/sentry-rules.test.ts` checks the contract itself:

- every expected event is clean under the rules;
- every input has something to strip;
- frames, release and environment pass through unchanged;
- both files are pinned by sha256 under their version.

Each surface's scrubber test runs the fixtures for its surface and must produce `expected`
exactly.

## Rules every surface follows

1. **SDK options.**
   - `sendDefaultPii: false`.
   - Errors only: `tracesSampleRate`, `profilesSampleRate` and both replay rates are `0`.
   - No console breadcrumbs.
   - The phone sets `attachScreenshot: false` and `attachViewHierarchy: false`, because the view
     hierarchy holds on-screen text: amounts and names.
2. **Requests.**
   - Never sent: request bodies, cookies or query strings. `request.url` keeps the path only.
   - Headers in `denyHeaders` are removed: `authorization`, `cookie`, `set-cookie`, `x-api-key`,
     `idempotency-key`, `x-forwarded-for`, …
3. **Keys are matched as whole tokens.**
   - A key is split on `_`, `-`, `.`, spaces and camelCase humps, then lowercased. So
     `clientName` becomes `client` + `name`, and `filename` stays `filename`.
   - A key is dropped when any token is in `denyKeyTokens`. This applies in `extra`, `contexts`,
     breadcrumb `data`, tags and user, at any depth.
   - Never touched: stack frames, `sdk`, `release` and `environment`.
4. **Contexts.**
   - `safeContextKeys` are kept even though they hold a deny token. These are the SDK's
     `os.name`, `browser.name`, `runtime.name` and `app.app_name`, with their versions.
   - `alwaysDropContextKeys` are always dropped: `device.name`, which is often a person's name,
     as in "Basel's iPhone".
5. **User and tags.**
   - User context is `{ id }` only, an internal opaque UUID. Never an email address, username or
     IP address.
   - Tags must be in `allowedTags`: `surface`, `request_id`, `route` (the route template, never the
     raw path), `locale`, `release`, `environment`, `app_build`.
6. **Breadcrumbs.**
   - No `console` breadcrumbs.
   - HTTP breadcrumbs (fetch, xhr, Dio) keep `method`, path-only `url` and `status_code`.
   - UI clicks keep the selector, never the text.
7. **Messages.**
   - In exception values and messages, a `key=value` pair whose key holds a deny token becomes
     `key=[Filtered]`.
   - This catches only *labelled* values. An unlabelled name in free text is not caught, so
     surface code never interpolates user values into thrown messages. The org's server-side
     scrubber (below) is the backstop for emails and card numbers.
8. **Never reported.**
   - The server reports only unknown errors and `ApiError`s with status `serverReportsStatusAtLeast`
     (500) or higher.
   - `ignoredErrors` lists each surface's offline, cancellation and browser-noise errors. A
     pattern is matched against `<exception type>: <exception value>` of the top exception.
   - Chunk-load errors **are** reported: they mean a bad deploy.
9. **Ignored-error patterns use a regex subset that JavaScript and Dart read the same way.**
   - Not allowed: inline flags (`(?i)`), lookbehind, named groups, `\p{…}`, backreferences.
   - For case-insensitive matching, set `"ignoreCase": true` on the entry.
10. **Source maps and debug symbols** are uploaded at build time and deleted from the output.
    They're never served.

The org also runs Sentry's own server-side scrubber, as a second layer. That means Require Data
Scrubber, the default scrubbers, Prevent storing IP addresses, and sensitive fields equal to
`denyKeyTokens`. `scripts/sentry-org-settings.ts` applies and checks them, because Terraform can't.

## Changing the contract

1. Edit the file or files.
2. Bump `version` in both files.
3. Add a row to `PINNED_VERSIONS` in `scripts/__tests__/sentry-rules.test.ts` with both sha256s.
   Never edit an existing row.
4. Copy both files byte-for-byte into the Flutter app, and update its parity row there (MUT-151).
5. Run `scripts/sentry-org-settings.ts --apply` if `denyKeyTokens` or `orgSettings` changed.

## Where each DSN and token lives

| Surface | DSN | Upload token |
|---|---|---|
| api | Secret Manager → Cloud Run env `SENTRY_DSN`. MUT-148 reads it from this module's state with `terraform_remote_state`, so deploys need no Sentry token | none needed (source ships in the image) |
| portal | `VITE_SENTRY_DSN` in the **hosted** build env (`server/scripts/deploy.sh` step 1) | `SENTRY_AUTH_TOKEN` in the operator shell for `make release server` (`deploy.env` holds no secrets, and `release.env` is the desktop signing file; MUT-149 decides whether deploy.sh reads a git-ignored file) |
| landing | `VITE_SENTRY_DSN` in Netlify's **production context only** | `SENTRY_AUTH_TOKEN` in Netlify's build env |
| capture-app | `SENTRY_DSN` in the Flutter `.env` (a DSN is public by design) | `SENTRY_AUTH_TOKEN` in the **fastlane shell env** |

DSNs come from `terraform output -json dsn` in `server/infrastructure/sentry`.

**Landmines.**

- **Never `VITE_` a token.** Vite inlines every `VITE_`-prefixed variable into the browser
  bundle. Only DSNs may be `VITE_`. `check-bundles` fails on any `sntrys_` or `sntryu_` string
  (MUT-149/150).
- **The Flutter `.env` is compiled into the app.** fastlane and the Makefile pass it with
  `--dart-define-from-file`, so every value in it ships inside the binary. A
  `SENTRY_AUTH_TOKEN` placed there ships to every phone. Keep it in the shell env (MUT-151).
- **Two different tokens.**
  - **Upload token.** An org auth token (`sntrys_…`) with release and upload scopes only. It goes
    wherever builds run.
  - **Admin token.** For `terraform apply` and the settings script; it needs project, team,
    alert and org write. It stays in the operator's shell and is never stored.

## Privacy policy wording (publish with each surface)

Draft from MUT-147 (2026-10-17). Basel signs it off before the first surface publishes. Keys refer to
`landing.privacyPolicy.*` in `src/lib/i18n/translations/{en,ar}/landing.json`. The policy only
describes what's live (ADR-090 P3), so each surface story publishes its own sentence and bumps
"Last updated".

**Coordination with analytics (MUT-152).** Its stories edit `noTracking`, `network` and `sharing`
too. Apply these changes on top of whatever is there: keep the other story's sentences, and never
restore older text.

### Shared changes (the first surface to ship)

**`noTracking.body`.** Remove "crash reporting" from the first sentence's list of things the apps
don't use, then add:

- EN: "Our servers, the hosted portal, our website, and the iPhone and Android apps send error reports when something breaks, as described under "Error reports". The free apps on Mac, Windows, and in the browser never send them."
- AR: «ترسل خوادمنا والبوابة المستضافة وموقعنا وتطبيقا iPhone وAndroid تقارير أعطال عند حدوث خلل، كما هو موضّح في قسم «تقارير الأعطال». أما تطبيقاتنا المجانية على Mac وWindows والمتصفح فلا ترسلها أبدًا.»

**`sharing.body`.** Add after the Google Cloud sentence:

- EN: "Sentry, hosted in the EU, receives the error reports described under "Error reports" and stores them for us."
- AR: «وتستلم Sentry، المستضافة في الاتحاد الأوروبي، تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» وتحفظها لصالحنا.»

**New section `errorReports`.** Add it to `SECTION_KEYS` right after `noTracking` (after
`usageAnalytics` if that has shipped). The body is the opening paragraph, then each live surface's
sentence.

- Title: EN "Error reports". AR «تقارير الأعطال».
- Opening:
  - EN: "When something breaks, we want to know before you have to tell us. An error report says where in our code the problem happened, which version you were using, your language, and your device's operating system, browser, and model. It never includes amounts, names, notes, contact details, request contents, your IP address, or anything you type. If a report includes an account at all, it is a random internal ID. Reports are stored by Sentry in the EU."
  - AR: «عندما يحدث خلل، نريد أن نعرف قبل أن تضطر لإخبارنا. يذكر تقرير العطل مكان المشكلة في الكود، والإصدار الذي كنت تستخدمه، ولغتك، ونظام تشغيل جهازك ومتصفحه وطرازه. ولا يتضمن أبدًا أي مبالغ أو أسماء أو ملاحظات أو بيانات اتصال أو محتوى الطلبات أو عنوان IP الخاص بك أو أي شيء تكتبه. وإن تضمّن التقرير حسابًا أصلًا، فهو معرّف داخلي عشوائي. وتحفظ Sentry التقارير في الاتحاد الأوروبي.»

### Hosted service and portal (MUT-148, MUT-149)

**`errorReports` sentence.**

- EN: "Our servers send a report when a request fails on our side, and the hosted portal sends one when a page crashes in your browser."
- AR: «ترسل خوادمنا تقريرًا عندما يفشل طلب بسبب خلل من جهتنا، وترسل البوابة المستضافة تقريرًا عندما تتعطّل صفحة في متصفحك.»

**`network.body`.** Add: EN "The hosted portal also sends the error reports described under "Error reports" to Sentry." AR «وترسل البوابة المستضافة أيضًا تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» إلى Sentry.»

### Landing page (MUT-150)

**`errorReports` sentence.**

- EN: "Our website sends a report when one of its pages fails to load or crashes. These reports include no account at all, and the free web app you open from the website never sends one."
- AR: «يرسل موقعنا تقريرًا عندما تفشل إحدى صفحاته في التحميل أو تتعطّل. لا تتضمن هذه التقارير أي حساب على الإطلاق، ولا يرسل تطبيق الويب المجاني الذي تفتحه من الموقع أي تقرير أبدًا.»

**`network.body`.** Add after the request-form sentence: EN "Our website also sends the error reports described under "Error reports" to Sentry." AR «ويرسل الموقع أيضًا تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» إلى Sentry.»

### Phone app (MUT-151)

**`errorReports` sentence.**

- EN: "The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from. They never attach screenshots or what's on your screen."
- AR: «يرسل تطبيقا iPhone وAndroid تقريرًا عندما يتعطّل التطبيق أو يواجه خطأً لا يستطيع تجاوزه. ولا يرفقان أبدًا لقطات شاشة أو ما يظهر على شاشتك.»

**`network.body`.** In the mobile sentence, add Sentry beside Mutaba3a's servers (keep any PostHog
clause): EN "…connect to Mutaba3a's servers, to Sentry for error reports, to the private storage
that holds your receipts…". AR «…تتصل بخوادم متابعة، وبـ Sentry لتقارير الأعطال، وبالتخزين الخاص الذي يحفظ إيصالاتك…».

## Store disclosures (MUT-151)

**Apple App Store › App Privacy.** Diagnostics › *Crash Data* and *Other Diagnostic Data*.
Purpose: App Functionality. Linked to identity: **No**. Used for tracking: **No**.

**Google Play › Data safety.**

- Category: *App info and performance › Crash logs* and *Diagnostics*.
- Collected: **Yes**. Shared: **No** (Sentry processes it for us).
- Collection is **required**: not optional.
- Purpose: *App functionality*.
- Encrypted in transit: **Yes**.

## Setup and operations

One-time setup, `terraform apply`, the settings script and the read-back are in
`server/DEPLOYMENT.md` §1.5. The current state is in `.claude/INFRA.md` §1, "Error reporting".
