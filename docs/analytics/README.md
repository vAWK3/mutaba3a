# Product analytics (PostHog)

What Mutaba3a may count, where, and how we describe it to people. Decision: **ADR-090**.
Epic: MUT-152. The event list, with each event's emitters and meaning, is
[`events.json`](./events.json). This page never copies it.

## Who sends

| Surface | Consent | Story |
|---|---|---|
| Landing pages (`/`, `/hosted`, `/privacy`, `/download`) | None needed: cookieless, nothing stored on the device | MUT-154 |
| Hosted portal | Off until the signed-in person turns it on | MUT-155 |
| Phone app (iOS, Android) | Off until the signed-in person turns it on | MUT-157 |
| The free local app (`/app` in the browser, desktop) | **Never sends** (ADR-024) | — |
| Hosted API server | **Never sends** (MUT-156 closed) | — |

Errors and crashes go to Sentry (epic MUT-146), never to PostHog.

## Rules every surface follows

1. **Only what `events.json` lists, enforced in code.** Each surface runs a guard that drops any
   event or property the contract doesn't list, and has tests proving it: posthog-js
   `before_send`, and the Flutter SDK's equivalent hook. The guard is **required**.
   - The SDK's own `$` properties are limited too.
     - **Landing:** may keep PostHog's URL, UTM, referrer and device-type properties. Drop
       `$referrer` and `$referring_domain` when the referrer is this site's local app (`/app…`),
       so nothing about the local app reaches PostHog.
     - **Portal and phone:** send **no** URL, path, referrer, screen name, `$initial_*`, `$set`
       or `$set_once` properties. Portal URLs carry profile and client IDs
       (`/p/$profileId/clients/$customerId`). Keep only the shared properties and the OS,
       OS version, device type and SDK version.
2. **Anonymous.**
   - Never call `identify()`, `alias()` or `group()`.
   - Register no super properties beyond the three shared ones.
   - No person profiles.
   - No location: the project's GeoIP transformation is off, and every event also sends
     `$geoip_disable: true`.
   - IPs are discarded at ingestion.
   - No email, name, account, profile, client or Malafat identifier anywhere. No amounts, no
     free text. A currency code is allowed.
3. **A random install ID, and nothing else that lasts.**
   - Created when the person opts in. Kept only on that device.
   - On the portal it lives in `localStorage` (`persistence: 'localStorage'`), never in a
     cookie: the portal shares its origin with the API, so a cookie would travel with every
     signed-in request.
   - Opting out, signing out and switching account reset it completely, so `$device_id` rotates
     too: posthog-js `reset(true)`, and the Flutter SDK's full reset. Opting in again starts a
     fresh ID that can't be linked to the old one.
4. **Off by default, and the SDK doesn't start before consent.** On the portal and the phone,
   the SDK isn't initialised until the person opts in, so not even feature-flag or
   remote-config requests are made. Feature flags and remote config stay off afterwards too.
5. **Opting out sends one last note, in this order:**
   1. capture `analytics_opted_out`;
   2. flush, which sends that note together with anything still queued from while they were
      opted in (it was collected with consent);
   3. opt out;
   4. reset.

   On a phone that is offline, the queue waits for the next connection, and nothing new is
   captured meanwhile. Tests prove this order (MUT-155, MUT-157).
6. **Consent belongs to the signed-in person, not the device.** Signing out or switching account
   clears the opt-in, the random ID and the "already asked" flag, and sends nothing. The next
   person is asked fresh.
7. **SDK features off:**
   - autocapture, including exception autocapture
   - session replay, heatmaps and surveys
   - console-log capture and web vitals
   - feature flags and remote config
   - page-leave events (`capture_pageleave: false`)
   - automatic pageviews, except on the landing page
   - the SDK's own opt-in event (use the contract's `analytics_opted_in`, not `$opt_in`)
   - screen-view observers and app-lifecycle events on the phone
8. **Production only, and a kill switch.**
   - Keys come from configuration, never source:
     - Landing and portal builds: `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` (`https://eu.i.posthog.com`).
     - Phone: `--dart-define=POSTHOG_KEY=…` and `POSTHOG_HOST`.
   - On Netlify the key is set for the **production** context only, never for deploy previews
     or branch deploys. QA and preview builds have no key.
   - A build or app with no key sends nothing and throws nothing.
   - The `phc_` key is a public ingest key, but it still lives in env.
9. **The landing page is cookieless.**
   - `cookieless_mode: 'always'`. The project's cookieless tracking must stay on, or PostHog
     silently drops every landing event (INFRA §1).
   - Visits on the same day from the same browser and network share a hashed ID; visits on
     different days can't be linked.
10. **Where the SDK starts on the landing page.** Only inside the lazily loaded landing page
    chunks. Never in `LandingProviders` or `src/main.tsx`: those are shared with `/app`, so the
    SDK would ship inside the local app. `test:bundles` proves this (MUT-154).
11. **No joining.**
    - Nobody joins PostHog data with the hosted database, server logs or Malafat's data, and
      nobody exports person-level rows. Timestamps alone could link a random ID to an account,
      so "not linked to your account" depends on this rule.
    - Only the people Basel grants can open the project (INFRA §1).

## Opt-in experience (portal and phone)

- **Ask once per signed-in person.** On the phone, ask after sign-in. On the portal, ask on the
  first visit after sign-in. Two equal buttons: turn it on, or not now. "Not now" means off; that
  person isn't asked again on that device until they sign out.
- **A Settings toggle with the same label** as the turn-on button changes it at any time.
- **Suggested copy**, so the portal and the phone read the same:

| | English | Arabic |
|---|---|---|
| Title | Share anonymous usage? | مشاركة بيانات استخدام مجهولة؟ |
| Body | Help us see which parts of Mutaba3a people use. We never send amounts, names or anything you type, and it isn't linked to your account. You can turn it off any time in Settings. | ساعدنا على معرفة أجزاء متابعة التي يستخدمها الناس. لا نرسل أبدًا أي مبالغ أو أسماء أو أي شيء تكتبه، ولا ترتبط هذه البيانات بحسابك. يمكنك إيقافها في أي وقت من الإعدادات. |
| Turn on (and the Settings toggle) | Share anonymous usage | مشاركة الاستخدام المجهول |
| Decline | Not now | ليس الآن |

## Changing the contract

1. **Bump `version` in `events.json`.**
   - minor: a new event, property or enum value.
   - major: a rename or removal.
2. **Add a sha256 row** for the new version to `PINNED_VERSIONS` in
   `scripts/__tests__/analytics-taxonomy.test.ts`. Rows are append-only, so the test fails until
   the version changes with the content.
3. **Copy the file to Flutter.** The Flutter repo keeps a byte-identical copy at
   `test/fixtures/analytics/events.json` with that version's sha256 in its fixtures README. A
   parity test checks the Dart event constants against it (the brand-token pattern). Copy the
   file and the hash in the same change (MUT-157).
4. **A removal must reach every surface before the privacy policy says so.**
5. **A rename breaks the funnels** saved in PostHog. Update them too.

## Privacy policy wording (publish with each surface)

The public privacy policy only describes what is live (MUT-153 P3). Each surface story publishes
its own pieces below and bumps the policy's "Last updated" date. The first story to ship also makes
the shared changes. Keys refer to `landing.privacyPolicy.*` in
`src/lib/i18n/translations/{en,ar}/landing.json`.

**Coordination with Sentry (MUT-146).** Its stories edit `noTracking`, `network` and `sharing`
too. Whichever story ships second applies its change on top of the other's text: keep the other
story's sentences, never restore the "before" text quoted here.

The "No tracking" claims in the landing hero and privacy band stay as they are. They describe the
free app, which sends nothing. ADR-090 defines tracking as following a person across sites, apps
or devices, or for advertising.

### Shared changes (the first surface to ship)

**`intro`.** Name the hosted portal alongside the apps.

- EN: "This policy covers Mutaba3a's apps for Mac, Windows, the browser, iPhone, and Android, and the hosted portal you sign in to in a browser. They handle your data in different ways, so we explain each one. It does not cover any other product."
- AR: «تغطي هذه السياسة تطبيقات متابعة على Mac وWindows والمتصفح وiPhone وAndroid، والبوابة المستضافة التي تسجّل الدخول إليها من المتصفح. تتعامل هذه التطبيقات مع بياناتك بطرق مختلفة، لذا نشرح كلًّا منها. ولا تغطي أي منتج آخر.»

**`scope.body`.** Replace its last sentence.

- EN after: "None of our apps use ads or tracking. The free apps on Mac, Windows, and in the browser, which need no account, never send usage data, and we never sell your data."
- AR after: «لا يستخدم أي من تطبيقاتنا إعلانات أو تتبّعًا، ولا ترسل تطبيقاتنا المجانية على Mac وWindows والمتصفح، التي لا تحتاج إلى حساب، أي بيانات استخدام، ولا نبيع بياناتك أبدًا.»

**`noTracking`.**

- Title, EN: "No ads, no tracking". AR: «لا إعلانات، لا تتبّع».
- Body: replace the first sentence. The replacement keeps today's crash-reporting words; MUT-146's
  stories change those words when Sentry ships.
  - EN: "None of Mutaba3a's apps use advertising, crash reporting, or tracking that follows you across sites or apps, and the free apps on Mac, Windows, and in the browser use no analytics at all. The anonymous usage counts we do keep are described under "Anonymous usage counts"."
  - AR: «لا يستخدم أي من تطبيقات متابعة الإعلانات أو تقارير الأعطال أو أي تتبّع يلاحقك عبر المواقع أو التطبيقات، ولا تستخدم تطبيقاتنا المجانية على Mac وWindows والمتصفح أي أدوات تحليل على الإطلاق. أما إحصاءات الاستخدام المجهولة التي نحتفظ بها فموضّحة في قسم «إحصاءات استخدام مجهولة».»

**`sharing.body`.** Add after the Netlify sentence.

- EN: "PostHog, hosted in the EU, processes the anonymous usage counts described under "Anonymous usage counts" for us."
- AR: «وتعالج PostHog، المستضافة في الاتحاد الأوروبي، لصالحنا إحصاءات الاستخدام المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة».»

**New section `usageAnalytics`.** Add it to `SECTION_KEYS` right after `noTracking`. The body is
the opening paragraph, then each live surface's sentence, then the closing paragraph.

- Title, EN: "Anonymous usage counts". AR: «إحصاءات استخدام مجهولة».
- Opening:
  - EN: "The free apps on Mac, Windows, and in the browser never send usage data. Where we do count usage, we use PostHog, hosted in the EU. We never send amounts, names, notes, contact details, your location, or anything you type, and nothing we send is linked to your account."
  - AR: «لا ترسل تطبيقاتنا المجانية على Mac وWindows والمتصفح أي بيانات استخدام أبدًا. وحيث نحصي الاستخدام، نستخدم PostHog المستضافة في الاتحاد الأوروبي. لا نرسل أبدًا أي مبالغ أو أسماء أو ملاحظات أو بيانات اتصال أو موقعك أو أي شيء تكتبه، ولا يرتبط أي شيء نرسله بحسابك.»
- Closing:
  - EN: "These counts are used only to understand which parts of Mutaba3a people use. They're never used for advertising, and no one but PostHog, which processes them for us, receives them."
  - AR: «نستخدم هذه الإحصاءات فقط لنفهم أي أجزاء متابعة يستخدمها الناس، ولا نستخدمها أبدًا للإعلانات، ولا يستلمها أحد غير PostHog التي تعالجها لصالحنا.»

### Landing page (MUT-154)

**`usageAnalytics` sentence.**

- EN: "Our website counts page visits and which buttons are pressed, without cookies and without storing anything on your device. To tell visits apart for a single day, PostHog combines your IP address and browser details into a code that changes every day and keeps neither, so a visit can't be linked to you or to visits on other days."
- AR: «يحصي موقعنا زيارات الصفحات والأزرار التي تُضغط، دون ملفات تعريف ارتباط ودون تخزين أي شيء على جهازك. ولتمييز الزيارات خلال يوم واحد، تجمع PostHog عنوان IP الخاص بك وتفاصيل متصفحك في رمز يتغيّر كل يوم ولا تحتفظ بأي منهما، فلا يمكن ربط الزيارة بك ولا بزيارات في أيام أخرى.»

**`scope.body`.** Replace its sentence about the request form.

- EN before: "The one thing our website can send us is the hosted-account request form, and only if you fill it in and press Send."
- EN after: "Our website sends us what you type in the hosted-account request form, only if you fill it in and press Send, and it counts visits anonymously, as described under "Anonymous usage counts"."
- AR after: «يرسل إلينا موقعنا ما تكتبه في نموذج طلب الحساب المستضاف، فقط إذا ملأته وضغطت إرسال، ويحصي الزيارات دون أن يتعرّف عليك، كما هو موضّح في قسم «إحصاءات استخدام مجهولة».»

**`network.body`.** Add after the request-form sentence.

- EN: "The website also sends the anonymous visit counts described under "Anonymous usage counts" to PostHog."
- AR: «ويرسل الموقع أيضًا إحصاءات الزيارات المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة» إلى PostHog.»

### Hosted portal (MUT-155)

**`usageAnalytics` sentence.**

- EN: "The hosted portal asks you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, it sends a short note each time you open the portal and each time you save an income, an expense, or a payment, saying only which of these it was, its currency, and for an income whether it was already paid. It also sends the portal's version, its language, and your browser's type. Notes are sent under a random ID kept only in your browser, not linked to your account, and replaced when you sign out. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID."
- AR: «تسألك البوابة المستضافة مرة واحدة إن كنت تريد مشاركة استخدام مجهول، وتبقى المشاركة متوقفة ما لم تفعّلها. إن فعّلتها، ترسل البوابة ملاحظة قصيرة كلما فتحتها وكلما حفظت دخلًا أو مصروفًا أو دفعة، لا تذكر إلا نوع ما حُفظ وعملته، وفي حالة الدخل إن كان مدفوعًا بالفعل، إضافة إلى إصدار البوابة ولغتها ونوع متصفحك. وتُرسَل الملاحظات تحت معرّف عشوائي محفوظ في متصفحك فقط، غير مرتبط بحسابك، ويُستبدل عند تسجيل خروجك. وإن أوقفتها من الإعدادات، نرسل ملاحظة أخيرة تفيد بأنك أوقفتها، ثم نتوقف ونحذف المعرّف العشوائي.»

**`network.body`.** Add a portal sentence.

- EN: "The hosted portal connects to Mutaba3a's servers and, if you turned on anonymous usage, to PostHog."
- AR: «وتتصل البوابة المستضافة بخوادم متابعة، وبـ PostHog إن فعّلت مشاركة الاستخدام المجهول.»

### Phone app (MUT-157)

**`usageAnalytics` sentence.**

- EN: "The iPhone and Android apps ask you once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, they send a short note when you first turn it on and each time you add a client or save an income, an expense, or a payment. The note says only which of these it was, its currency, and for an income whether it was already paid, along with the app's version, its language, and your phone's operating system. Notes are sent under a random ID kept only on your phone, not linked to your account, and replaced when you sign out. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID."
- AR: «يسألك تطبيقا iPhone وAndroid مرة واحدة إن كنت تريد مشاركة استخدام مجهول، وتبقى المشاركة متوقفة ما لم تفعّلها. إن فعّلتها، يرسل التطبيق ملاحظة قصيرة عند تفعيلها أول مرة وكلما أضفت عميلًا أو حفظت دخلًا أو مصروفًا أو دفعة. لا تذكر الملاحظة إلا نوع ما حُفظ وعملته، وفي حالة الدخل إن كان مدفوعًا بالفعل، إضافة إلى إصدار التطبيق ولغته ونظام تشغيل هاتفك. وتُرسَل الملاحظات تحت معرّف عشوائي محفوظ على هاتفك فقط، غير مرتبط بحسابك، ويُستبدل عند تسجيل خروجك. وإن أوقفتها من الإعدادات، نرسل ملاحظة أخيرة تفيد بأنك أوقفتها، ثم نتوقف ونحذف المعرّف العشوائي.»

**`network.body`.** Replace the mobile sentence. Keep any Sentry sentence already there.

- EN before: "The mobile apps connect only to Mutaba3a's servers and to the private storage that holds your receipts, always over encrypted connections."
- EN after: "The mobile apps connect to Mutaba3a's servers, to the private storage that holds your receipts, and, if you turned on anonymous usage, to PostHog, always over encrypted connections."
- AR after: «أما تطبيقات الجوال فتتصل بخوادم متابعة وبالتخزين الخاص الذي يحفظ إيصالاتك، وبـ PostHog إن فعّلت مشاركة الاستخدام المجهول، ودائمًا عبر اتصالات مشفّرة.»

## Store disclosures (MUT-157)

**Apple App Store › App Privacy.**

- *Usage Data › Product Interaction*: Analytics. Linked to identity: **No**. Used for tracking: **No**.
- *Identifiers › Device ID*: the random install ID. Analytics. Linked to identity: **No**. Used
  for tracking: **No**.
- No App Tracking Transparency prompt: nothing is linked across apps or companies.

**Google Play › Data safety.**

- *App activity › App interactions*, and *Device or other IDs* (the random install ID).
- Collected: **Yes**. Shared: **No** (PostHog processes it for us).
- Collection is **optional**: users can choose.
- Purpose: *Analytics*.
- Encrypted in transit: **Yes**.
- Deletion: opting out or signing out deletes the ID from the device.

## Open items for Basel

- **Retention.** How long PostHog keeps events (your plan's default unless you set one). Set one
  before the first surface ships, and add it to the `usageAnalytics` closing paragraph.
- **Apple "Financial Info".** A currency code plus whether an income was paid may count as
  *Financial Info › Other Financial Info* on Apple's label. Declaring it, as "not linked" and
  "Analytics", is the safe reading. Decide before MUT-157 submits.
- **Project access.** Restrict project 304889 to the people who need it (PostHog › Project
  settings › Access control). The MCP can't set this, and it may need a paid plan (INFRA §1).
