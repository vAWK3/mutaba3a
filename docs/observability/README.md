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

Only production builds may send.

- **Web.** Only production builds get a DSN, so dev, QA and preview builds send nothing.
- **Phone.** The phone is the exception: its `.env` also feeds `make run` (the Flutter
  Makefile passes `--dart-define-from-file=.env`), so a DSN placed there reaches debug
  sessions too. Therefore the phone starts Sentry only in release builds (`kReleaseMode`),
  and fastlane passes the DSN with its own `--dart-define` rather than the shared `.env`
  (MUT-151).

## The two files

| File | What it holds | Who reads it at runtime |
|---|---|---|
| `sentry-rules.json` | deny lists, allowed tags and user keys, safe and always-dropped context keys, ignored errors, required SDK options, org settings | the portal and landing may import it; the server and phone **embed** its lists in code, and a test asserts they are equal |
| `sentry-fixtures.json` | "dirty event in, clean event out" cases, one or more per surface | **tests only**: never import it into an app. It carries the marker `MUT147-SENTRY-FIXTURE-DO-NOT-BUNDLE`. MUT-149/150 add a `check-bundles` rule that fails on it (and on `sntrys_`/`sntryu_`); it doesn't exist yet. `check-bundles` doesn't run on any ship path until TD-084 is fixed, so those tickets need TD-084 too |

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
   - `includeLocalVariables: false`: frames never carry local variable values (D10).
   - The phone sets `attachScreenshot: false` and `attachViewHierarchy: false`, because the view
     hierarchy holds on-screen text: amounts and names.
   - The server builds its Prisma client with `errorFormat: 'minimal'` (`serverPrismaErrorFormat`),
     so a validation error never prints the query input (D4).
2. **Requests and URLs.**
   - Never sent: the whole request fields in `requestDropFields` (`data`, `cookies`,
     `query_string`, `fragment`, `env`), and the `Referer` header, which carries the previous
     page's full URL (D17).
   - **Every URL-bearing field keeps the path only**, with no query string and no `#fragment`
     (`urlFields`: `request.url` and breadcrumb `data.url`, `data.from`, `data.to`). The portal's
     `/setup#…` link carries a one-time setup token in its fragment, and the browser SDK records
     that URL in a navigation breadcrumb (D3).
   - Headers in `denyHeaders` are removed: `authorization`, `cookie`, `set-cookie`, `x-api-key`,
     `idempotency-key`, `x-forwarded-for`, …
3. **Keys are matched as whole tokens.**
   - A key is split on `_`, `-`, `.`, spaces and camelCase humps, then lowercased. So
     `clientName` becomes `client` + `name`, and `filename` stays `filename`.
   - A key is dropped when any token is in `denyKeyTokens`. This applies in `extra`, `contexts`,
     breadcrumb `data`, tags and user, at any depth.
   - Lowercase compounds that splitting can't break apart are tokens in their own right:
     `username`, `apikey`, `accesstoken`, `sessionid`, `phonenumber`, `emailaddress`, `passwd`,
     `jwt`, `otp`, … (D11).
   - Never touched: stack frames (except their `vars`, which are always dropped), `sdk`,
     `release` and `environment`.
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
   - Navigation breadcrumbs keep path-only `from` and `to`.
   - UI clicks keep the selector, never the text.
7. **Messages.**
   - In exception values and messages, every labelled value whose key holds a deny token is
     replaced with `[Filtered]` (quoted values keep their quotes: `"[Filtered]"`).
   - **Forms covered (D4, D15).** `key=value`, `key = value`, `key: value`, and JSON or JS
     `"key": value` / `'key':value`, compact (`JSON.stringify`) or spaced.
   - **The shared pattern.** All surfaces use the contract's `labelledValuePattern` (key in group 1
     or 3, value in group 2 or 4). It has two branches:
     - **Quoted keys.** The value is a quoted string or runs to the next `,`, `;`, `}`, `]` or
       whitespace.
     - **Bare keys.** The value is a quoted string, or runs to the end of its clause (`;`, `}`,
       `]`, `)` or a line break). So `Authorization: Bearer <token>` and `name: John Smith`
       filter the whole value, and so does `amount=1,234.56`.
     - **Over-redaction.** Filtering to the end of the clause also hides the text after a
       sensitive label: `amount=5 currency=ILS` becomes `amount=[Filtered]`. Safety wins over
       debug detail.
     - **Rescanning.** The marker `[Filtered]` is itself a complete value, so a scrubbed message
       rescans as clean.
   - **The scan.** Scan from the left. After a label whose key is *not* sensitive, continue from
     the start of its value, so in `Error: failed amount=5` the harmless `Error:` can't hide
     `amount=`. After a sensitive one, continue after the value.
   - **Bounded cost.** Every surface truncates an exception value or message to
     `maxMessageLength` (8,192 characters) *before* scrubbing, and keys are bounded to 64
     characters. Rescanning after harmless labels can otherwise go quadratic; with the cap the
     worst case is about 20 ms, and the contract test times it. Sentry's JS SDK already
     truncates values to 250 characters by default.
   - **Prisma.** An exception whose type matches `firstLineOnlyExceptionTypes` (`^Prisma`) keeps
     only its first line, because the rest can echo the query input.
   - **Known limits.** This catches only *labelled* values. Not caught:
     - an unlabelled name in free text (so surface code never interpolates user values into
       thrown messages);
     - double-encoded JSON (`\"email\":\"…\"`);
     - keys in non-Latin scripts (an Arabic label such as المبلغ);
     - a quoted value broken across lines.

     The org's server-side scrubber (below) is the backstop for distinctive values such as API
     keys.
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

The org also runs Sentry's own server-side scrubber, as a second layer, plus settings that decide
who can see an event. `scripts/sentry-org-settings.ts` applies and checks them (Terraform can't),
and refuses an org outside the EU region before writing anything (D5).

- **`orgSettings`.** Require Data Scrubber, the default scrubbers, Prevent storing IP addresses,
  Enhanced Privacy on (alert emails carry no event content), shared issues off (no public event
  links) and 2FA required (D7).
- **Safe fields.** Always none: a safe field switches the scrubber off for that key.
- **Sensitive fields.** `orgSensitiveFields`, a **curated** list, never `denyKeyTokens`.
  - **Why curated.** Sentry's server-side scrubber removes any value that merely *contains* a
    sensitive field, so a short token like `ip` or `name` would wipe ordinary error text
    ("description", "filename").
  - **What's on it.** Only long, distinctive entries (`password`, `pepper`, `mut_live_`,
    `mutaba3a_session`, `amountminor`, …). The contract test proves none of them occurs in any
    text the fixtures keep (D2).
  - **Hand-added fields.** `--apply` keeps sensitive fields added by hand.

**Quota (D6).**

- **The shared quota.** The plan's monthly error quota is shared by all four projects, and three
  of the DSNs are public (the landing and portal JavaScript, and the phone binary). The origin
  allow-list doesn't stop a script.
- **Daily caps.** So each key is capped **per day**: api 60, capture-app 60, portal 20 and
  landing 20. Together that's 160 a day, under the 5,000 a month over 31 days.
- **What that buys.** One abused or crash-looping surface loses the rest of its own day, but can
  never use up the month and blind the API.
- **Guard.** Terraform refuses caps whose sum would overrun `monthly_event_quota`.

## Changing the contract

1. Edit the file or files.
2. Bump `version` in both files.
3. Add a row to `PINNED_VERSIONS` in `scripts/__tests__/sentry-rules.test.ts` with both sha256s.
   Never edit a row once its version has merged.
4. Copy both files byte-for-byte into the Flutter app, and update its parity row there (MUT-151).
5. Run `scripts/sentry-org-settings.ts --apply` if `orgSensitiveFields` or `orgSettings` changed.

`contracts-ci.yml` runs the contract tests whenever these files change, because web-ci skips
`docs/**`. `.gitattributes` keeps them LF on every checkout, so the pinned hashes hold everywhere.

## Where each DSN and token lives

| Surface | DSN | Upload token |
|---|---|---|
| api | Secret Manager → Cloud Run env `SENTRY_DSN`. MUT-148 reads it from this module's state with `terraform_remote_state`, so deploys need no Sentry token | none needed (source ships in the image) |
| portal | `VITE_SENTRY_DSN` in the **hosted** build env (`server/scripts/deploy.sh` step 1) | `SENTRY_AUTH_TOKEN` in the operator shell for `make release server` (`deploy.env` holds no secrets, and `release.env` is the desktop signing file; MUT-149 decides whether deploy.sh reads a git-ignored file) |
| landing | `VITE_SENTRY_DSN` in Netlify's **production context only** | `SENTRY_AUTH_TOKEN` in Netlify's build env, **scoped to the Production deploy context and marked "Contains secret values"**, so deploy-preview and branch builds (which run PR code) can never read it |
| capture-app | `SENTRY_DSN` passed by the fastlane release lanes with their own `--dart-define` (not the shared `.env`, which `make run` reads too); the SDK starts only under `kReleaseMode` | `SENTRY_AUTH_TOKEN` in the **fastlane shell env** |

DSNs come from `terraform output -json dsn` in `server/infrastructure/sentry`.

**Landmines.**

- **Never `VITE_` a token.** Vite inlines every `VITE_`-prefixed variable into the browser
  bundle. Only DSNs may be `VITE_`. MUT-149/150 add a `check-bundles` rule failing on any `sntrys_` or `sntryu_` string,
  run on the ship paths once TD-084 is fixed.
- **The Flutter `.env` is compiled into the app.** fastlane and the Makefile pass it with
  `--dart-define-from-file`, so every value in it ships inside the binary. A
  `SENTRY_AUTH_TOKEN` placed there ships to every phone. Keep it in the shell env (MUT-151).
- **Two different tokens, two different names** (D8).
  - **Upload token.** `SENTRY_AUTH_TOKEN`: an org auth token (`sntrys_…`) with release and
    upload scopes only. It goes wherever builds run.
  - **Admin token.** `SENTRY_ADMIN_TOKEN`: a personal (user) auth token (`sntryu_…`) from the
    2FA-enabled owner account. It's for `terraform apply` and the settings script, and needs
    project, team, alert and org write, which an org token can't carry. It's handed to one
    command at a time, never exported as `SENTRY_AUTH_TOKEN`, so a later build in the same shell
    can't pick it up.
  - **Wrong-org guard.** A personal token reaches every org its owner belongs to. So the
    settings script refuses an org holding any project that isn't `mutaba3a-…` (D16).
  - **Where the settings script sends it.** Only to `https://sentry.io` or
    `https://<region>.sentry.io`.

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
