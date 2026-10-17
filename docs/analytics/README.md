# Product analytics (PostHog)

What Mutaba3a may count, where, and how we describe it to people. Decision: **ADR-090**.
Epic: MUT-152. The event list is [`events.json`](./events.json). This page never copies it.

## Who sends what

| Surface | Sends | Consent |
|---|---|---|
| Landing page (`/`, `/hosted`, `/privacy`, `/download`) | `$pageview`, `landing_cta_clicked` | None needed: cookieless, nothing stored on the device, no lasting ID (MUT-154) |
| Hosted portal | `portal_opened`, opt-in / opt-out | Off until the person turns it on (MUT-155) |
| Phone app (iOS, Android) | first open, opt-in / opt-out, client / income / expense / payment saved | Off until the person turns it on (MUT-157) |
| Local web app (`/app`), desktop | **Nothing, ever** (ADR-024) | — |
| Hosted API server | **Nothing** (MUT-156 closed) | — |

Errors and crashes go to Sentry (epic MUT-146), never to PostHog.

## Rules every surface follows

1. **Only what `events.json` lists.** Event names, property names, property types and enum values
   come from the contract. Each surface's tests prove that what it sends is a subset of it. In
   posthog-js, a `before_send` that drops anything not in the contract is the recommended guard.
2. **Anonymous.**
   - Never call `identify()`.
   - No person profiles (`person_profiles: 'identified_only'`, never identified).
   - No email, name, account, profile, client or Malafat identifier anywhere.
   - No amounts and no free text. A currency code is allowed.
3. **A random install ID.** It is created on the device when the person opts in, is stored only on
   that device, and is deleted when they opt out. Opting in again creates a new one, so later
   counts can't be linked to earlier ones.
4. **Off by default** on the portal and the phone. Nothing (not even `app_first_opened`) is sent
   before opt-in.
5. **Opting out sends one last `analytics_opted_out`** under the current ID, then stops sending and
   deletes the ID (MUT-153 D5). Events already sent stay in PostHog, under an ID nobody holds.
6. **SDK features off:**
   - autocapture, including exception autocapture
   - session replay
   - heatmaps
   - surveys
   - console-log capture
   - web vitals
   - automatic pageviews, except on the landing page
7. **Kill switch.** A build or app with no key sends nothing and throws nothing.
8. **Keys come from configuration, never source.**
   - Landing and portal builds: `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST` (`https://eu.i.posthog.com`).
   - Phone: `--dart-define=POSTHOG_KEY=…` and `POSTHOG_HOST`.

   The `phc_` key is a public ingest key, but it still lives in env.
9. **The landing page uses `cookieless_mode: 'always'`.** The project's cookieless server hash mode
   must be on, or PostHog silently drops every landing event (INFRA §1).
   - Country is not available on cookieless events while PostHog issue #48660 is open: the IP is
     stripped before GeoIP runs. MUT-154 decides whether to live with that.

## Opt-in experience (portal and phone)

- **Ask once.** On the phone, ask after the first sign-in. On the portal, ask on the first visit
  after sign-in. Two equal buttons: turn it on, or not now. "Not now" means off, and the prompt
  never comes back.
- **A Settings toggle**, labelled the same as the prompt, changes it at any time.
- **Suggested copy**, so the portal and the phone read the same:

| | English | Arabic |
|---|---|---|
| Title | Share anonymous usage? | مشاركة بيانات استخدام مجهولة؟ |
| Body | Help us see which parts of Mutaba3a people use. We never send amounts, names or anything you type, and it isn't linked to your account. You can turn it off any time in Settings. | ساعدنا على معرفة أجزاء متابعة التي يستخدمها الناس. لا نرسل أبدًا أي مبالغ أو أسماء أو أي شيء تكتبه، ولا ترتبط هذه البيانات بحسابك. يمكنك إيقافها في أي وقت من الإعدادات. |
| Turn on | Share anonymous usage | مشاركة الاستخدام المجهول |
| Decline | Not now | ليس الآن |
| Settings toggle | Share anonymous usage | مشاركة بيانات استخدام مجهولة |

## Changing the contract

- **Bump `version` in `events.json`.**
  - minor: a new event, property or enum value.
  - major: a rename or removal.
- **Then update the copies.** The Flutter repo keeps a byte-identical copy at
  `test/fixtures/analytics/events.json` with a sha256 row in its fixtures README. A parity test
  checks the Dart event constants against it (the same pattern as the brand tokens). Copy the file
  and update the hash in the same change (MUT-157).
- **A rename breaks the funnels** built on the old name in PostHog. Update the saved insights too.

## Privacy policy wording (publish with each surface)

The public privacy policy only describes what is live (MUT-153 P3). Each surface story publishes
its own pieces below and bumps the policy's "Last updated" date. The first story to ship also makes
the shared changes. Keys refer to `landing.privacyPolicy.*` in
`src/lib/i18n/translations/{en,ar}/landing.json`.

The "No tracking" claims in the landing hero and privacy band stay as they are. They describe the
free app, which sends nothing, and ADR-090 defines tracking as following a person.

### Shared changes (the first surface to ship)

**`scope.body`.** Replace its last sentence.

- EN, before: "None of our apps use analytics, ads, or tracking, and we never sell your data."
- EN, after: "None of our apps use ads or tracking, the Mac, Windows, and browser apps never send usage data, and we never sell your data."
- AR, before: «لا يستخدم أي من تطبيقاتنا أدوات تحليل أو إعلانات أو تتبّع، ولا نبيع بياناتك أبدًا.»
- AR, after: «لا يستخدم أي من تطبيقاتنا إعلانات أو تتبّعًا، ولا ترسل تطبيقات Mac وWindows والمتصفح أي بيانات استخدام، ولا نبيع بياناتك أبدًا.»

**`noTracking`.**

- Title, EN: "No ads, no tracking". AR: «لا إعلانات، لا تتبّع».
- Body: replace the first sentence only. Keep the rest, and keep whatever the crash-reporting
  clause says at the time (Sentry, MUT-146, owns that clause).
  - EN: "None of Mutaba3a's apps use advertising or tracking that follows you across sites or apps, and the Mac, Windows, and browser apps use no analytics at all. The anonymous usage counts we do keep are described under "Anonymous usage counts"."
  - AR: «لا يستخدم أي من تطبيقات متابعة إعلانات أو تتبّعًا يلاحقك عبر المواقع أو التطبيقات، ولا تستخدم تطبيقات Mac وWindows والمتصفح أي أدوات تحليل على الإطلاق. أما إحصاءات الاستخدام المجهولة التي نحتفظ بها فموضّحة في قسم «إحصاءات استخدام مجهولة».»

**`sharing.body`.** Add after the Netlify sentence.

- EN: "PostHog, hosted in the EU, receives the anonymous usage counts described under "Anonymous usage counts"."
- AR: «وتستلم PostHog، المستضافة في الاتحاد الأوروبي، إحصاءات الاستخدام المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة».»

**New section `usageAnalytics`.** Add it to `SECTION_KEYS` right after `noTracking`. The body is
the opening paragraph, then each live surface's sentence, then the closing paragraph.

- Title, EN: "Anonymous usage counts". AR: «إحصاءات استخدام مجهولة».
- Opening:
  - EN: "The Mac, Windows, and browser apps never send usage data. Where we do count usage, we use PostHog, hosted in the EU, and we never send what you enter: no amounts, names, notes, or contact details, and nothing linked to your account."
  - AR: «لا ترسل تطبيقات Mac وWindows والمتصفح أي بيانات استخدام أبدًا. وحيث نحصي الاستخدام، نستخدم PostHog المستضافة في الاتحاد الأوروبي، ولا نرسل أبدًا ما تُدخله: لا مبالغ ولا أسماء ولا ملاحظات ولا بيانات اتصال، ولا شيء مرتبط بحسابك.»
- Closing:
  - EN: "These counts are used only to understand which parts of Mutaba3a people use. They're never used for advertising or shared with anyone else."
  - AR: «نستخدم هذه الإحصاءات فقط لنفهم أي أجزاء متابعة يستخدمها الناس، ولا نستخدمها أبدًا للإعلانات ولا نشاركها مع أي جهة أخرى.»

### Landing page (MUT-154)

**`usageAnalytics` sentence.**

- EN: "Our website counts page visits and which buttons are pressed without cookies and without storing anything on your device, so a visit can't be linked to you or to a later visit. PostHog uses your IP address only to count the visit and doesn't keep it."
- AR: «يحصي موقعنا زيارات الصفحات والأزرار التي تُضغط دون ملفات تعريف ارتباط ودون تخزين أي شيء على جهازك، فلا يمكن ربط الزيارة بك ولا بزيارة لاحقة. تستخدم PostHog عنوان IP الخاص بك لإحصاء الزيارة فقط ولا تحتفظ به.»

**`network.body`.** Add after the request-form sentence.

- EN: "The website also sends the anonymous visit counts described under "Anonymous usage counts" to PostHog."
- AR: «ويرسل الموقع أيضًا إحصاءات الزيارات المجهولة الموضّحة في قسم «إحصاءات استخدام مجهولة» إلى PostHog.»

If MUT-154 adds a coarse country, add "and the country you're visiting from" / «والبلد الذي تزور منه»
after "which buttons are pressed".

### Hosted portal (MUT-155)

**`usageAnalytics` sentence.**

- EN: "The hosted portal asks once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, it sends a short note each time you open the portal, under a random ID kept only in your browser and not linked to your account. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID."
- AR: «تسألك البوابة المستضافة مرة واحدة إن كنت تريد مشاركة استخدام مجهول، وتبقى المشاركة متوقفة ما لم تفعّلها. إن فعّلتها، ترسل البوابة ملاحظة قصيرة كلما فتحتها، تحت معرّف عشوائي محفوظ في متصفحك فقط وغير مرتبط بحسابك. وإن أوقفتها من الإعدادات، نرسل ملاحظة أخيرة تفيد بأنك أوقفتها، ثم نتوقف ونحذف المعرّف العشوائي.»

### Phone app (MUT-157)

**`usageAnalytics` sentence.**

- EN: "The iPhone and Android apps ask once whether you want to share anonymous usage, and it's off unless you turn it on. If you do, they send a short note the first time you open the app and each time you save a client, an income, an expense, or a payment. The note says only which of these it was, its currency, and for an income whether it was already paid. It's sent under a random ID kept only on your phone and not linked to your account. If you turn it off in Settings, we send one last note saying you turned it off, then stop and delete the random ID."
- AR: «يسألك تطبيقا iPhone وAndroid مرة واحدة إن كنت تريد مشاركة استخدام مجهول، وتبقى المشاركة متوقفة ما لم تفعّلها. إن فعّلتها، يرسل التطبيق ملاحظة قصيرة عند فتحه أول مرة وكلما حفظت عميلًا أو دخلًا أو مصروفًا أو دفعة. لا تذكر الملاحظة إلا نوع ما حُفظ وعملته، وفي حالة الدخل إن كان مدفوعًا بالفعل. وتُرسَل تحت معرّف عشوائي محفوظ على هاتفك فقط وغير مرتبط بحسابك. وإن أوقفتها من الإعدادات، نرسل ملاحظة أخيرة تفيد بأنك أوقفتها، ثم نتوقف ونحذف المعرّف العشوائي.»

**`network.body`.** Replace the mobile sentence.

- EN, before: "The mobile apps connect only to Mutaba3a's servers and to the private storage that holds your receipts, always over encrypted connections."
- EN, after: "The mobile apps connect only to Mutaba3a's servers, to the private storage that holds your receipts, and, if you turned on anonymous usage, to PostHog, always over encrypted connections."
- AR, after: «أما تطبيقات الجوال فلا تتصل إلا بخوادم متابعة وبالتخزين الخاص الذي يحفظ إيصالاتك، وبـ PostHog إن فعّلت مشاركة الاستخدام المجهول، ودائمًا عبر اتصالات مشفّرة.»

## Store disclosures (MUT-157)

**Apple App Store › App Privacy.**

- Data type: *Usage Data › Product Interaction*.
- Purpose: *Analytics*.
- Linked to the user's identity: **No**.
- Used for tracking: **No**.
- No other data type changes. No App Tracking Transparency prompt: nothing is linked across apps
  or companies.

**Google Play › Data safety.**

- Data type: *App activity › App interactions*.
- Collected: **Yes**. Shared: **No** (PostHog processes it for us).
- Collection is **optional**: users can choose.
- Purpose: *Analytics*.
- Encrypted in transit: **Yes**.

## Open items for Basel

- **Retention.** How long PostHog keeps events (your plan's default unless you set one). If you set
  a period, add it to the `usageAnalytics` closing paragraph.
