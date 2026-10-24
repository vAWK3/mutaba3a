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
| Hosted API (`server/`) | `mutaba3a-api` | Unknown errors and `ApiError`s with status 500 or higher; pre-roll and post-roll crashes (MUT-148: live once `sentry_enabled`) |
| Hosted portal (`--mode hosted`) | `mutaba3a-web` (made by hand, imported) | Crashes, uncaught errors, unhandled rejections |
| Landing pages (`/`, `/download`, `/privacy`, `/terms`, lazy chunks only) | `mutaba3a-landing` | Crashes, uncaught errors, unhandled rejections; no user context, at most 5 per page load. MUT-150: live once Netlify's production context has the DSN |
| Capture app (Flutter, iOS + Android) | `mutaba3a-flutter` (made by hand, imported) | Dart, Flutter-framework and native crashes, and replies the app couldn't read (type and endpoint only). MUT-151: live in the first store release built with a DSN. The Share Extension, widgets and Siri intents report their own crashes through a Swift port of the scrubber, with no user (MUT-395, merged; their first real event is checked on the simulator and at MUT-413's release) |

**Never:** the local web app (`/app`) or desktop. They send nothing, ever (ADR-024, ADR-090).

Crash reports are **not** opt-in, unlike analytics. They contain no content, and the privacy
policy says they're sent. Data goes to Sentry's EU region (`de.sentry.io`, Frankfurt), in the
company org `barmajiyat-ltd`, which holds only `mutaba3a-…` projects for now (ADR-091 amendment 5).

Only production builds may send.

- **Web.** Only production builds get a DSN, so dev, QA and preview builds send nothing.
- **Phone.** The phone is the exception: its `.env` also feeds `make run` (the Flutter
  Makefile passes `--dart-define-from-file=.env`), so a DSN placed there reaches debug
  sessions too. Therefore the phone starts Sentry only in release builds (`kReleaseMode`) with
  an EU DSN, and fastlane passes the DSN with its own `--dart-define` rather than the shared
  `.env` (MUT-151). The lanes refuse a `.env` that holds the DSN or any Sentry token.

## The two files

| File | What it holds | Who reads it at runtime |
|---|---|---|
| `sentry-rules.json` | deny lists, allowed tags and user keys, safe and always-dropped context keys, ignored errors, required SDK options, org settings | the portal and landing may import it; the server and phone **embed** its lists in code, and a test asserts they are equal |
| `sentry-fixtures.json` | "dirty event in, clean event out" cases, one or more per surface | **tests only**: never import it into an app. It carries the marker `MUT147-SENTRY-FIXTURE-DO-NOT-BUNDLE`. `check-bundles` fails on it in every dist, and on `sntrys_`/`sntryu_` (MUT-149); `deploy.sh` runs it on `dist-hosted`, and the landing's Netlify path still skips it (TD-084) |

`scripts/__tests__/sentry-rules.test.ts` checks the contract itself:

- every expected event is clean under the rules;
- every input has something to strip;
- frames, release and environment pass through unchanged;
- both files are pinned by sha256 under their version.

Each surface's scrubber test runs the fixtures for its surface and must produce `expected`
exactly.

**The JS scrubber already exists (MUT-148).** `server/src/observability/sentry-scrub.ts` is the whole-event
`beforeSend` over the embedded `sentry-rules.ts`, free of `node:*` imports.
`scripts/__tests__/sentry-server-scrub.test.ts` runs every surface's fixtures through it, and asserts the
embedded copy equals `sentry-rules.json` field by field. The portal and landing (MUT-149/150) import it rather
than write a second one. A contract change updates `sentry-rules.ts` in the same commit, or that test fails.

## Rules every surface follows

1. **SDK options.**
   - `sendDefaultPii: false`.
   - Errors only: `tracesSampleRate`, `profilesSampleRate` and both replay rates are `0`.
   - No console breadcrumbs.
   - `includeLocalVariables: false`: frames never carry local variable values (D10).
   - The phone sets `attachScreenshot: false` and `attachViewHierarchy: false`, because the view
     hierarchy holds on-screen text: amounts and names.
   - The phone sends errors only (MUT-151): no sessions, ANR, app-hang or watchdog reports, no
     native auto-breadcrumbs, no SDK HTTP breadcrumbs or failed-request events (its own Dio
     interceptor adds method, path and status), no client reports.
   - **Native crashes skip the phone's Dart scrubber**: the iOS and Android SDKs send them on
     the next launch. They carry only the scope synced from Dart (already scrubbed crumbs, the
     allowed tags, the user id), and a server-side Advanced Data Scrubbing rule on
     `mutaba3a-flutter` is their second layer (INFRA §1).
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
   - A key is split on `_`, `-`, `.`, spaces, camelCase humps and letter–digit boundaries, then
     lowercased. So `clientName` becomes `client` + `name`, `address2Line` becomes `address` +
     `2` + `line`, and `filename` stays `filename`.
   - A key is dropped when any token is in `denyKeyTokens`. This applies in `extra`, `contexts`,
     breadcrumb `data`, tags and user, at any depth.
   - Lowercase compounds that splitting can't break apart are tokens in their own right:
     `username`, `apikey`, `accesstoken`, `sessionid`, `phonenumber`, `emailaddress`, `passwd`,
     `jwt`, `otp`, … (D11).
   - The product's own labels are deny tokens too: `client(s)`, `vendor(s)`, `mobile`, `tel`,
     `mail` (so `E-mail` goes), `title` and `reason` (so `withdrawnReason` goes) (D18).
     - **The cost.** Opaque ID keys such as `extra.clientId` are dropped too.
     - **Deliberately not a token: `user`.** It would also strip the `User-Agent` header.
   - Money and free-text fields are deny tokens: `minor` (so `grossMinor`, `netMinor` and
     `amountMinor` go), `reference`, `label` and `metadata` (1.1.0).
   - Plurals are listed too, because whole-token matching doesn't strip an `s`: the field
     names (`phones`, `addresses`, `labels`, `references`, …) and the lowercase compounds
     (`phonenumbers`, `emailaddresses`, `apikeys`, `accesstokens`, `firstnames`, …). Short
     forms such as `tel`, `otp` and `jwt` have none.
   - Never touched: stack frames (except their `vars`, which are always dropped), `sdk`,
     `release` and `environment`.
4. **Contexts.**
   - `safeContextKeys` are kept even though they hold a deny token. These are the SDK's
     `os.name`, `browser.name`, `runtime.name` and `app.app_name`, with their versions.
   - `alwaysDropContextKeys` are always dropped:
     - `device.name`, which is often a person's name, as in "Basel's iPhone";
     - `flutter_error_details.context` and `.information`, where sentry_flutter puts the
       FlutterError's free text (widget descriptions with their field values). No deny token is
       in those keys, and context values are not text-scanned.
5. **User and tags.**
   - User context is `{ id }` only, an internal opaque UUID. Never an email address, username or
     IP address.
   - Tags must be in `allowedTags`: `surface`, `request_id`, `route` (the route template, never the
     raw path), `locale`, `release`, `environment`, `app_build`.
   - **Phone only: `scrub_failed`.** If the phone's scrubber throws, it sends a report built from
     scratch instead (level, release, the allowed tags, exception types and frames, and
     `scrub_failed: true`), never the event's text, so a broken scrubber shows up rather than
     every report vanishing (MUT-151 D14).
6. **Breadcrumbs.**
   - No `console` breadcrumbs.
   - HTTP breadcrumbs (fetch, xhr, Dio) keep `method`, path-only `url` and `status_code`.
   - Navigation breadcrumbs keep path-only `from` and `to`.
   - UI clicks keep the selector, never the text.
7. **Messages.**
   - **Where.** Exception values, the event message (a plain string, `message.formatted` or
     `logentry.formatted`) and breadcrumb messages. In each, every labelled value whose key holds
     a deny token is replaced with `[Filtered]` (quoted values keep their quotes: `"[Filtered]"`).
   - **Structured messages.** The fields in `messageDropFields` (`params`) are dropped from
     `message` and `logentry`: they hold the raw values a template was filled with. The template
     itself is kept, because it holds only placeholders.
   - **Forms covered (D4, D15).** `key=value`, `key = value`, `key: value`, JSON or JS
     `"key": value` / `'key':value`, compact (`JSON.stringify`) or spaced, `util.inspect`'s
     `'key' => value` (Map, URLSearchParams), and Dart's `Invalid argument (key): value` /
     `RangeError (key): value`.
   - **The shared pattern.** All surfaces use the contract's `labelledValuePattern` (key in group 1
     or 3, value in group 2 or 4). It has two branches:
     - **Quoted keys.** The key is followed by `:` or `=>`. The value is either:
       - a quoted string;
       - a nested object or array (`{…`, `[…`, also after the `util.inspect` prefixes listed
         under bare keys, as in `'client-names': Set(2) {`), which runs to the end of the line
         and on through every following indented line, so everything under a sensitive container
         key goes,
         compact (`{"emails":["a@b","c@d"]}`) or pretty-printed (`JSON.stringify(x, null, 2)`,
         `util.inspect`). Every later indented line goes with it, harmless siblings included: in
         pretty-printed JSON, `"status": "draft"` after a sensitive `"emails": [` is filtered too;
       - a quoted string cut off by truncation, which runs to the end of the line;
       - otherwise, text up to the next `,`, `;`, `}`, `]` or whitespace.
     - **Bare keys.** The key is followed by `=`, `:` and a space, or ` = `; never `==` or
       `===`, so assertion text such as `'key == null'` is left alone. A `)` may sit between the
       key and the separator, for Dart's `Invalid argument (amountMinor): -1200`. The value is:
       - a quoted string;
       - a container: `{` or `[`, optionally after a `util.inspect` prefix (`Set(2) {`,
         `Map(1) {`, a class name as in `Client {`, or `[Object: null prototype] {`). It runs to
         the end of the line and on through the indented lines below it, so one-line nesting
         (Dart's `Map.toString`, `{client: {id: c1, display: John Smith}}`) and multi-line
         `util.inspect` output are both covered;
       - otherwise, text to the end of its clause (`;`, `}`, `]`, `)` or a line break). A
         parenthetical inside it, as in `Acme (Pty) Ltd`, doesn't end it. So
         `Authorization: Bearer <token>`, `name: John Smith` and `amount=1,234.56` filter the
         whole value.
     - **Over-redaction.** Filtering to the end of the clause also hides the text after a
       sensitive label: `amount=5 currency=ILS` becomes `amount=[Filtered]`. Safety wins over
       debug detail.
     - **Rescanning.** The marker `[Filtered]` is itself a complete value, so a scrubbed message
       rescans as clean.
   - **Order.** For each exception value, message and breadcrumb message:
     1. truncate to `maxMessageLength`;
     2. keep the first line for `firstLineOnlyExceptionTypes`;
     3. cut the query and fragment off every http(s) URL in the text (`urlInTextPattern`,
        replace with group 1; D19);
     4. scan for labelled values.

     The contract test's reference scrub follows this order and must reproduce every fixture's
     expected exception text.
   - **The scan.** Scan from the left. After a label whose key is *not* sensitive, continue from
     the start of its value, so in `Error: failed amount=5` the harmless `Error:` can't hide
     `amount=`. After a sensitive one, continue after the value.
   - **Bounded cost.**
     - **The cap.** Every surface truncates an exception value or message to
       `maxMessageLength` (8,192 characters) *before* scrubbing, and keys are bounded to 64
       characters. Rescanning after harmless labels is quadratic, so the cap is what bounds it.
     - **Measured worst case.** About 20–35 ms in Node; the contract test times it with a
       generous budget. In Dart (`dart run` on a Mac) the same worst case took 150–300 ms, so
       the phone truncates to **2,048** characters instead (MUT-151, ADR-091 amendment 10): about
       25 ms in its own worst case, under a 100 ms test guard.
     - **SDK default.** Sentry's JS SDK already truncates values to 250 characters by default.
   - **First line only.** An exception keeps only its first line when a
     `firstLineOnlyExceptionTypes` pattern matches its type **or the start of its value**:
     `^Prisma`, because the rest can echo the query input, and `^FormatException`, because Dart
     prints the unparsable source text below the message. The value check matters on the phone:
     an obfuscated release build renames the type, but the value still starts with
     `FormatException:`.
   - **Known limits.** This catches only *labelled* values. Not caught:
     - an unlabelled name in free text (so surface code never interpolates user values into
       thrown messages);
     - double-encoded JSON (`\"email\":\"…\"`);
     - keys in non-Latin scripts (an Arabic label such as المبلغ);
     - keys longer than 64 characters;
     - a bare `key:value` with no space after the colon (the space is required so URLs and times
       like `12:30` are left alone);
     - a quoted value broken across lines;
     - a `;` inside an unquoted value, which ends it: Dart prints map values unquoted, so
       `{note: Paid half; rest from Ahmad Saleh}` keeps `rest from Ahmad Saleh`;
     - bracketed keys in form-encoded text, as in `client[name]=John` (nothing in the server or
       portal encodes bodies this way today).

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

**Quota (D6, amended 2026-10-22: no per-key caps).**

- **The shared quota.** The plan's monthly error quota is shared by all four projects, and three
  of the DSNs are public (the landing and portal JavaScript, and the phone binary). The origin
  allow-list doesn't stop a script.
- **No daily caps on the free plan.** Per-key rate limits are a paid-plan feature: on the first
  apply Sentry ignored them and the provider failed (ADR-091 amendment 8). The keys are uncapped.
- **What's left.** Spike protection on every project, and the $0 pay-as-you-go budget, so overage
  is dropped and never billed.
- **The risk (TD-200).** One abused or crash-looping surface can use up the month's quota and hide
  the other surfaces' errors until it resets. The API's errors still reach Cloud Logging.

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
| portal | `MUTABA3A_SENTRY_DSN` in the git-ignored `deploy.env`, exported by the Makefile into `npm run build:hosted` (`server/scripts/deploy.sh` step 1); the build refuses a DSN off the org's ingest host (MUT-149) | `SENTRY_AUTH_TOKEN` from the operator shell, else Keychain `release-kit` / `barmajiyat/SENTRY_AUTH_TOKEN`, passed by `make release server` to deploy.sh only; a DSN without it stops the release |
| landing | `MUTABA3A_LANDING_SENTRY_DSN` in Netlify's **production context only** (MUT-150; never `VITE_`) | `SENTRY_AUTH_TOKEN` in Netlify's build env, **scoped to the Production deploy context and marked "Contains secret values"**, so deploy-preview and branch builds (which run PR code) can never read it |
| capture-app | `MUTABA3A_SENTRY_DSN`, passed by the fastlane release lanes with their own `--dart-define` from the login Keychain (service `release-kit`, account `barmajiyat/MUTABA3A_SENTRY_DSN`; never the shared `.env`, which `make run` reads too). The lanes check it against the app's EU pattern before building. The SDK starts only under `kReleaseMode` | `SENTRY_AUTH_TOKEN` from the Keychain (`barmajiyat/SENTRY_AUTH_TOKEN`) or the fastlane shell env; `sentry_dart_plugin` uploads the dSYMs, Dart debug files and R8 mapping per build |

DSNs come from `terraform output -json dsn` in `server/infrastructure/sentry`.

**Landmines.**

- **Never put a token in a build variable.** The portal's DSN is a `MUTABA3A_*` define; a
  token must never become one. `check-bundles` fails on any `sntrys_` or `sntryu_` string and
  on the fixtures' marker (MUT-149), and `deploy.sh` runs it on `dist-hosted`; Netlify runs it on `dist-web`
  (MUT-150).
- **The Flutter `.env` is compiled into the app.** fastlane and the Makefile pass it with
  `--dart-define-from-file`, so every value in it ships inside the binary. A
  `SENTRY_AUTH_TOKEN` placed there ships to every phone. Keep it in the Keychain; the lanes
  refuse to build when `.env` holds a token or the DSN (MUT-151).
- **Two different tokens, two different names** (D8).
  - **Upload token.** `SENTRY_AUTH_TOKEN`: an org auth token (`sntrys_…`) with release and
    upload scopes only. It goes wherever builds run.
  - **Admin token.** `SENTRY_ADMIN_TOKEN`: a personal (user) auth token (`sntryu_…`) from the
    2FA-enabled owner account. It's for `terraform apply` and the settings script, and needs
    project, team, alert and org write, which an org token can't carry. It's handed to one
    command at a time, never exported as `SENTRY_AUTH_TOKEN`, so a later build in the same shell
    can't pick it up.
  - **Wrong-org guard.** A personal token reaches every org its owner belongs to. So the
    settings script refuses an org holding any project outside its allow-list, `mutaba3a-…` and
    `e33-…` (D16, amendment 9). The settings are org-wide: E33's projects get them too.
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

**Published with MUT-148 (D5, 2026-10-22).** The shared changes above, in a server-only form, because the portal
didn't send yet: `noTracking.body` says "Our servers send error reports when something breaks on our side…", and
the `errorReports` sentence is EN "Our servers send a report when a request fails on our side." AR «ترسل خوادمنا
تقريرًا عندما يفشل طلب بسبب خلل من جهتنا.» MUT-149 replaces both with the full wording below, and each later
surface adds itself to `noTracking.body`'s list.

**Published with MUT-149 (2026-10-23)**, with `noTracking.body` naming "Our servers, the hosted portal, and the iPhone and Android apps" (MUT-151's phone sentences kept).

**`errorReports` sentence.**

- EN: "Our servers send a report when a request fails on our side, and the hosted portal sends one when a page crashes in your browser."
- AR: «ترسل خوادمنا تقريرًا عندما يفشل طلب بسبب خلل من جهتنا، وترسل البوابة المستضافة تقريرًا عندما تتعطّل صفحة في متصفحك.»

**`network.body`.** Add: EN "The hosted portal also sends the error reports described under "Error reports" to Sentry." AR «وترسل البوابة المستضافة أيضًا تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» إلى Sentry.»

### Landing page (MUT-150)

**Published with MUT-150 (2026-10-24).** `noTracking.body` names the website first: EN "Our website,
our servers, the hosted portal, and the iPhone and Android apps send error reports…", AR «يرسل موقعنا
وخوادمنا والبوابة المستضافة وتطبيقا iPhone وAndroid تقارير أعطال…». The free apps' "never" stays.

**`errorReports` sentence** (eng D8: "crashes or hits an error", not "fails to load", which the
website mostly can't report).

- EN: "Our website sends a report when one of its pages crashes or hits an error. The website's reports include no account at all, and the free web app you open from the website never sends one."
- AR: «ويرسل موقعنا تقريرًا عندما تتعطّل إحدى صفحاته أو تواجه خطأً، ولا تتضمن تقارير الموقع أي حساب على الإطلاق، ولا يرسل تطبيق الويب المجاني الذي تفتحه من الموقع أي تقرير أبدًا.»

The intro names the website as covered (review D2): EN "This policy covers Mutaba3a's website, its hosted web
portal and its iPhone and Android apps.", AR «تغطي هذه السياسة موقع متابعة، وبوابتها المستضافة على الويب، وتطبيقيها…».

**`network.body`.** The website's PostHog sentence becomes one sentence for both (review D2): EN "The website also sends the error reports described under "Error reports" to Sentry and the anonymous visit counts described under "Anonymous usage counts" to PostHog." AR «ويرسل الموقع أيضًا تقارير الأعطال الموضّحة في قسم «تقارير الأعطال» إلى Sentry، وإحصاءات الزيارات المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة» إلى PostHog.»

### Phone app (MUT-151)

**Published with MUT-151 (2026-10-22, deploy before the first store release built with a DSN).** The
sentences below, and `noTracking.body` now names the phones: EN "Our servers and the iPhone and
Android apps send error reports when something breaks…", AR «ترسل خوادمنا وتطبيقا iPhone وAndroid
تقارير أعطال عند حدوث خلل…».

**`errorReports` sentence.**

- EN: "The iPhone and Android apps send a report when the app crashes or hits an error it can't recover from. They never attach screenshots or what's on your screen."
- AR: «يرسل تطبيقا iPhone وAndroid تقريرًا عندما يتعطّل التطبيق أو يواجه خطأً لا يستطيع تجاوزه. ولا يرفقان أبدًا لقطات شاشة أو ما يظهر على شاشتك.»

**`network.body`.** In the mobile sentence, add Sentry beside Mutaba3a's servers (keep any PostHog
clause): EN "…connect to Mutaba3a's servers, to Sentry for error reports, to the private storage
that holds your receipts…". AR «…تتصل بخوادم متابعة، وبـ Sentry لتقارير الأعطال، وبالتخزين الخاص الذي يحفظ إيصالاتك…».

## Store disclosures (MUT-151)

The phone's reports carry the signed-in account's internal id (MUT-151 D10), so the crash data is
linked to identity in both stores' terms.

**Apple App Store › App Privacy.** Diagnostics › *Crash Data* and *Other Diagnostic Data*.
Purpose: App Functionality. Linked to identity: **Yes**. Used for tracking: **No**.

**Google Play › Data safety.**

- Category: *App info and performance › Crash logs* and *Diagnostics*, and *Personal info ›
  User IDs* (the internal account id the reports carry).
- Collected: **Yes**. Shared: **No** (Sentry processes it for us).
- Collection is **required**: not optional.
- Purpose: *App functionality*.
- Encrypted in transit: **Yes**.

## Setup and operations

One-time setup, `terraform apply`, the settings script and the read-back are in
`server/DEPLOYMENT.md` §1.5. The current state is in `.claude/INFRA.md` §1, "Error reporting".
