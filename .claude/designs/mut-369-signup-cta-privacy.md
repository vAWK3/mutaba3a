# MUT-369: the landing's "Create an account" CTA, and the privacy policy for self-service signup

Epic MUT-322 (pilot-ready). Story S5 of `.claude/designs/mut-331-self-service-signup.md` (§8.2, §9; ADR-159).
Blocked by MUT-368 (merged to local main 305cbe56, In Review). Run: Basel's self-service portal run, 2026-10-24,
non-interactive: every decision below is **pending Basel's confirmation**.

> **Legal text.** Every privacy-policy sentence in §4 is a draft. **Basel must approve this wording before any
> release.** It may merge to local main, because nothing is released from local main. The item sits in
> `docs/operations/before-release.md` (web) and on MUT-369.

## 1. Problem and acceptance criteria

During the pilot the landing's way in is the request form (MUT-186, now inline in Get it). At GA it must lead to the
portal's `/signup`. Signup also brings processors and lookups the privacy policy doesn't name yet: Resend (MUT-359),
Cloudflare Turnstile (MUT-366/368) and the DNS + RDAP domain check (MUT-367). MUT-418 left one more sentence (TD-219).

- AC1: while signup is open, the landing CTA opens `/signup` in the page language. While it is closed, the page is
  exactly as today.
- AC2: the privacy policy names Resend (records in the US), Cloudflare Turnstile and the RDAP lookup, in en and ar.
  Basel approves the text (**open until he does**).
- AC3: release-QA: the landing CTA spec passes in both states.
- From the run brief: MUT-418's usage-notes sentence (TD-219) goes in the same update; MUT-359's go-live (D23) waits
  for this paragraph; no prices on the landing (MUT-365 is v3); the honesty tests stay.

## 2. What exists (reuse)

| Need | Already there |
|---|---|
| "Is signup open?" | `GET /v1/self-service` → `{signup, recovery}` (MUT-368 D1). Public, no origin check, `no-store`. `signup` is true only when mail really goes out and `SELF_SIGNUP_ENABLED` is on. |
| The portal's origin in the landing | `hostedPortalUrl()` = `__PORTAL_URL__` (ADR-076 shape, derived from `config/hosts.json`, ADR-155). Empty in tests and desktop. |
| A link that names its language | `legalLanguageOf(search)` (MUT-356): `?lang=en|ar`, wins for the text, never stored. |
| The landing's CTAs | `HeroSection` (`.hero-cta-primary` → `#get-it`), `LandingHeader`'s `HeaderCta` mirror, `GetItSection` options + inline `HostedRequestForm`, `PhoneSection` hint link, FAQ a1. |
| Honesty tests | `LandingPage.test.tsx` `BANNED_CLAIMS_EN/AR` (no checkout, no "/month"), no "Buy"; `hostedOfferKeys.test.ts`. |
| Legal versioning | Terms are frozen files pinned by sha256 in `server/src/legal.ts` (MUT-324, ADR-102) with a deploy guard. **The privacy policy is not pinned**: it is ordinary copy (`landing.privacyPolicy.*`), no acceptance records it, and the terms text names no processor. So no terms version bump (D11). |
| QA | `qa/features/web/landing.yaml` + `qa/specs/web/landing.spec.ts`, auto fixtures in `qa/support/qa.ts` (PostHog, Sentry answered locally). |

## 3. Design

### 3.1 The landing reads the doors at runtime (D1)

`src/pages/landing/signupDoor.ts` (new, landing-only; nothing in `main.tsx` imports it):

- `fetchSignupOpen(portalUrl, fetchFn = fetch)`: `GET ${portalUrl}/v1/self-service` with `credentials: 'omit'`,
  `cache: 'no-store'`, no custom headers (a CORS "simple" request, so no preflight), and a 3 s timeout
  (`SIGNUP_DOOR_TIMEOUT_MS`). True only for a 200 whose JSON has `signup === true`. Any failure, timeout, other status or
  shape is false: **closed is the default**, like the portal's `CLOSED_DOORS`.
- `signupOpenOnce()`: one request per page load (module promise, like `startLandingAnalytics`); `reset…ForTests`.
- `signupHref(portalUrl, language)` → `${portalUrl}/signup?lang=<language>`.
- `useSignupUrl(language)`: null until the answer is "open", then the href. No portal URL (tests, desktop) → null and
  no request.

`LandingPage` calls `useSignupUrl(language)` once and passes `signupUrl: string | null` down to `HeroSection`,
`LandingHeader` (→ `HeaderCta`), `GetItSection`, `PhoneSection` and `FAQSection`. Null renders today's page,
byte for byte (AC1 "exactly as today").

While open:

| Place | Closed (today) | Open |
|---|---|---|
| Hero primary + the bar's mirror | "Request an account" → `#get-it` | "Create an account" → `signupUrl`, new tab (D4) |
| Hero note | "…there's no public sign-up." | "Sign up with your email address, or ask us to set an account up for your organization." |
| Get it options | Sign in, apps | **Create an account** first, then Sign in, apps |
| Get it note | "…there's no public sign-up." | the open note |
| Get it request heading | "Request an account" | "Want us to set it up for you?" (the form stays, ticket scope) |
| Phone hint link | "Request an account" → `#get-it` | "Create an account" → `signupUrl` |
| FAQ a1 | "No — accounts are set up for your organization…" | "No. You can create an account with your email address, or request one and we'll reply with an offer for your organization." |

No price, trial length or checkout word anywhere (MUT-365 deferred). The honesty regexes are unchanged; new tests run
them over the open page too.

### 3.2 The server lets the landing read the doors (D2)

`GET /v1/self-service` answers `Access-Control-Allow-Origin: *`, that route only, no
`Access-Control-Allow-Credentials`. The body is two public booleans that say nothing about any account, and without
credentials the browser sends no cookie. An allow-list was weighed: the landing has several hosts during the domain
move (mtb3a.com, www, the legacy netlify host, deploy previews), and listing them buys nothing for a public boolean.
Every other route still sends no CORS header (test). API **1.64.0-mut369** (ADR-? number at merge time).

### 3.3 The portal honours `?lang` (D5)

`HostedLanguageProvider` starts in the link's language: `linkedLanguageOf(location.search) ?? storedChoice() ??
account hint ?? Arabic`. Never stored (MUT-356's rule): the person's own switch still stores a choice, and the
account's locale is adopted after sign-in as today. `legalLanguageOf` moves to `src/lib/i18n/linkLanguage.ts` as
`linkedLanguageOf`; `src/content/legal/language.ts` re-exports it under the old name. The signup form already sends
the page language as `locale`, so the mail and `/setup` follow.

### 3.4 Privacy policy (D8–D10, §4)

Two new sections (`createAccount`, `email`) between `hostedAccounts` and `whatYouEnter`; edits to `scope`, `mobile`,
`network`, `sharing`, `usageAnalytics`; English names the product MTB3A (D10), so the brand-guard's privacy exemption
goes. "Last updated" stays at today's date; Basel sets the release date.

## 4. Privacy-policy draft (en / ar) — **Basel must approve this wording before any release**

Only changed or new text is listed; §4.0 is the mechanical rename.

**4.0 (D10)** English: every "Mutaba3a" in `landing.privacyPolicy.*` becomes "MTB3A". Arabic already says متابعة.

**4.1 `scope`** — appended to the second sentence about the website:
- EN: "Each visit to its home page also asks our servers whether sign-up is open, as described under "What reaches the network"."
- AR: «ويسأل الموقع خوادمنا في كل زيارة لصفحته الرئيسية إن كان التسجيل مفتوحًا، كما هو موضّح في قسم «ما يصل إلى الشبكة».»

**4.2 `mobile`** — first two sentences replaced:
- EN: "The mobile apps need an account. While sign-up is open you can create one yourself on the hosted portal, as described under "When you create an account"; otherwise your organization or we set one up for you."
- AR: «تتطلب تطبيقات الجوال حسابًا. عندما يكون التسجيل مفتوحًا يمكنك إنشاؤه بنفسك من البوابة المستضافة، كما هو موضّح في قسم «عند إنشاء حساب»، وإلا تُنشئه لك مؤسستك أو ننشئه نحن.»

**4.3 NEW `createAccount`** — "When you create an account" / «عند إنشاء حساب»
- EN: "While sign-up is open, you can create an account yourself on the hosted portal. You type your email address and we email you a link; your account is created only when you open that link and set a password. The sign-up and password-recovery forms first run a check with Cloudflare Turnstile to tell people from bots. Turnstile receives your IP address and details about your browser and device, and never what you type into the form. To check that your address can receive email, our servers look up its domain (the part after the @) in public DNS records, and ask the domain's registry, through its public registration records (RDAP), when the domain was registered. Only the domain name is sent in these lookups, never the rest of your address. We don't accept addresses from disposable email services. Sign-ups from personal email providers, and from domains these lookups can't confirm (for example, one registered in the last 90 days), are reviewed by our team before the account opens, and we email you the outcome."
- AR: «عندما يكون التسجيل مفتوحًا، يمكنك إنشاء حساب بنفسك من البوابة المستضافة. تكتب بريدك الإلكتروني فنرسل إليك رابطًا، ولا يُنشأ حسابك إلا عندما تفتح ذلك الرابط وتعيّن كلمة مرور. ويُجري نموذجا التسجيل واستعادة كلمة المرور أولًا فحصًا باستخدام Cloudflare Turnstile للتمييز بين الأشخاص والروبوتات. تستلم Turnstile عنوان IP الخاص بك وتفاصيل عن متصفحك وجهازك، ولا تستلم أبدًا ما تكتبه في النموذج. وللتحقق من أن بريدك يستقبل الرسائل، تبحث خوادمنا عن نطاقه (الجزء الذي بعد @) في سجلات DNS العامة، وتسأل الجهة المسؤولة عن تسجيل النطاق، عبر سجلات التسجيل العامة (RDAP)، عن تاريخ تسجيله. لا يُرسَل في عمليات البحث هذه إلا اسم النطاق، ولا يُرسَل باقي عنوانك أبدًا. لا نقبل العناوين من خدمات البريد المؤقت. أما التسجيلات من مزوّدي البريد الشخصي، أو من نطاقات لا تؤكدها عمليات البحث هذه (مثل نطاق سُجّل خلال آخر 90 يومًا)، فيراجعها فريقنا قبل فتح الحساب، ونرسل إليك النتيجة بالبريد الإلكتروني.»

**4.4 NEW `email`** — "Emails we send" / «الرسائل التي نرسلها»
- EN: "We email you only about your account: the link to finish creating it or to set a new password, a reminder that you already have an account if you try to sign up again, a notice when your password changes, the outcome of a sign-up review, and reminders about your free trial. Our emails never include amounts or your records, and we don't track whether you open them or click their links. We send them through Resend, which receives your email address, the message and what happens to it (for example, that it was delivered or bounced). Resend sends our emails from the EU (Ireland) and keeps its records of them, including your email address and their delivery, in the United States, under its data processing agreement with us. If an email to you bounces or you mark it as spam, we stop emailing that address."
- AR: «لا نراسلك إلا بشأن حسابك: رابط إكمال إنشائه أو تعيين كلمة مرور جديدة، وتذكير بأن لديك حسابًا إن حاولت التسجيل مجددًا، وإشعار عند تغيير كلمة مرورك، ونتيجة مراجعة التسجيل، وتذكيرات بشأن تجربتك المجانية. لا تتضمن رسائلنا أبدًا أي مبالغ أو سجلات، ولا نتتبّع فتحك لها أو نقرك على روابطها. نرسلها عبر Resend، التي تستلم بريدك الإلكتروني والرسالة وما يحدث لها (مثل وصولها أو ارتدادها). ترسل Resend رسائلنا من الاتحاد الأوروبي (أيرلندا)، وتحتفظ بسجلاتها عنها، ومنها بريدك الإلكتروني وحالة وصولها، في الولايات المتحدة، بموجب اتفاقية معالجة البيانات المبرمة معنا. وإذا ارتدّت رسالة إليك أو صنّفتها رسالةً مزعجة، نتوقف عن مراسلة ذلك العنوان.»

**4.5 `network`** — after the account-request sentence:
- EN: "Each time you open the website's home page, it asks our servers whether sign-up is open. That request carries nothing about you, but like any request it reaches our servers with your IP address and browser details, which go into the technical logs described under "No ads, no tracking"." And after the portal sentences: "The hosted portal's sign-up and password-recovery pages also connect to Cloudflare Turnstile for the check described under "When you create an account"."
- AR: «وفي كل مرة تفتح فيها الصفحة الرئيسية للموقع، يسأل خوادمنا إن كان التسجيل مفتوحًا. لا يحمل هذا الطلب أي شيء عنك، لكنه كأي طلب يصل إلى خوادمنا مع عنوان IP الخاص بك وتفاصيل متصفحك، فيدخل في السجلات التقنية الموضّحة في قسم «لا إعلانات، لا تتبّع».» و«وتتصل صفحتا التسجيل واستعادة كلمة المرور في البوابة المستضافة أيضًا بـ Cloudflare Turnstile لإجراء الفحص الموضّح في قسم «عند إنشاء حساب».»

**4.6 `sharing`** — after the Google Cloud sentence (D12: Cloudflare as the carrier is true since MUT-112's front door):
- EN: "Cloudflare carries the connections between you and our hosted portal and servers, and runs the Turnstile check described under "When you create an account". Resend sends our emails, as described under "Emails we send"."
- AR: «وتنقل Cloudflare الاتصالات بينك وبين بوابتنا المستضافة وخوادمنا، وتُجري فحص Turnstile الموضّح في قسم «عند إنشاء حساب». وترسل Resend رسائلنا الإلكترونية كما هو موضّح في قسم «الرسائل التي نرسلها».»

**4.7 `usageAnalytics`, the portal's sentence (TD-219 + D9)**:
- EN: "…each time you open the portal, each time you save an income, an expense or a payment received, and when it shows the free trial's reminder to add a card and whether you chose to add one or not. A note says only which of these it was, its currency, for an income whether it was already paid, and for the trial reminder whether it showed when you first signed in or on your Home page, along with…"
- AR: «…وكلما فتحتها، وكلما حفظت دخلًا أو مصروفًا أو دفعة مستلمة، وعند ظهور تذكير التجربة المجانية بإضافة بطاقة وإن اخترت إضافتها أم لا. لا تذكر الملاحظة إلا نوع ما حُفظ وعملته، وفي حالة الدخل إن كان مدفوعًا بالفعل، وفي حالة تذكير التجربة إن ظهر عند أول تسجيل دخول أو في صفحتك الرئيسية، إضافة إلى…»

## 5. Files

- New: `src/pages/landing/signupDoor.ts` (+ `__tests__/signupDoor.test.ts`), `src/lib/i18n/linkLanguage.ts`.
- Landing: `LandingPage.tsx`, `components/{HeroSection,LandingHeader,GetItSection,PhoneSection,FAQSection}.tsx`,
  `__tests__/LandingPage.test.tsx` (open/closed/honesty), `PrivacyPolicyPage.tsx` (section keys) + its test.
- Copy: `src/lib/i18n/translations/{en,ar}/landing.json`; `src/lib/i18n/__tests__/brandName.test.ts` (exemption gone).
- Portal: `src/hosted/i18n/HostedLanguageProvider.tsx` (+ test); `src/content/legal/language.ts` re-export.
- Server: `server/src/routes/self-service.ts` (header), `server/src/__tests__/routes-self-service.test.ts`,
  `API_VERSION` + `routes-m6.test.ts` + `openapi.yaml` version.
- QA: `qa/support/signupDoor.ts` (auto fixture that answers the portal origin's `/v1/self-service`, closed by default,
  so no web spec ever reaches production), `qa/support/qa.ts`, `qa/features/web/landing.yaml`,
  `qa/specs/web/landing.spec.ts`.
- Docs: `docs/analytics/README.md` (TD-219 draft now in the policy), `docs/operations/before-release.md` (web: Basel
  approves the wording; server: the CORS header ships with the API), `.claude/` knowledge files.

## 6. Tests (TDD)

- `signupDoor.test.ts`: open on `{signup:true}`; closed on `{signup:false}`, 500, bad JSON, network error, timeout;
  the request omits credentials and sends no custom header; one request per page load; no portal URL → no request;
  `signupHref` appends `?lang`.
- `LandingPage.test.tsx`: closed → hero/bar/get-it/phone/FAQ exactly as today (existing tests unchanged); open →
  "Create an account" links `<portal>/signup?lang=en` (and `?lang=ar` in Arabic), Get it lists it first, the request
  form stays, the honesty regexes pass on the open page in both languages, no "no public sign-up" text.
- `HostedLanguageProvider` test: `?lang=en` beats the Arabic default and a stored `ar` choice, is not stored; an
  unknown `?lang` is ignored.
- `routes-self-service.test.ts`: the doors GET has `Access-Control-Allow-Origin: *` and no allow-credentials;
  `POST /v1/signups` and `/v1/account-recovery` have no ACAO.
- `PrivacyPolicyPage.test.tsx` / `hostedOfferKeys.test.ts`: en and ar both name Resend (and the US), Cloudflare
  Turnstile, RDAP and the trial reminder; section order; same key set in both languages.
- `brandName.test.ts`: no exemption; English privacy says MTB3A.

Commands (Node 22): `npm run lint`, `npm run typecheck`, `npm run test:run`, `npm run build`; server typecheck, lint,
`openapi:check`, `test`.

## 7. QA scenarios (release-qa, `web` app, `qa/features/web/landing.yaml`)

| id | Steps, as the user would say them | Promised outcome |
|---|---|---|
| `signup-open` | With sign-up open, open the landing in Arabic; look at the hero, the bar and Get it; switch to English; press Create an account | Arabic: «أنشئ حسابًا» links `/signup?lang=ar`; English: "Create an account" links `/signup?lang=en`, first in Get it, with the request form still below; pressing it opens the portal's /signup in a new tab with `?lang=en`; no price words |
| `signup-closed` | With sign-up closed, and again with the server unreachable, open the landing | The page is today's: "Request an account" scrolls to the form; no "Create an account" anywhere |

The portal's `?lang` handling is covered by unit tests; the portal-selfservice app's signup flows are unchanged.

## 8. Decisions — all pending Basel's confirmation

- **D1** The CTA follows the server's `GET /v1/self-service` at runtime (MUT-368's recommendation, the run brief), not
  a landing build value (the ticket's wording). The portal origin is still the ADR-076 build value. Why: the CTA can't
  drift from the server switch, GA needs no web rebuild, and QA covers both states on one build. Cost: one small GET
  to our API per home-page visit (disclosed in the policy, §4.5) and a CORS header (D2).
- **D2** `Access-Control-Allow-Origin: *` on that one GET, no credentials. Allow-list rejected (§3.2).
- **D3** Closed until answered; a failure or a 3 s timeout reads closed. The CTA may change label once, shortly after
  load, on a GA page; nothing changes while signup is closed.
- **D4** "Create an account" opens in a new tab, like every other portal link on the landing (sr-only "opens in new tab").
- **D5** The portal starts in a link's `?lang` and doesn't store it (MUT-356's rule), beating a stored choice for that load.
- **D6** The request form stays while open, under "Want us to set it up for you?" (ticket: "for firms that want help").
- **D7** The signup CTA is not counted in landing analytics (like Sign in): the events contract stays at 2.1.0. TD.
- **D8** Resend's residency is stated as sending from the EU (Ireland) with records stored in the US under its DPA
  (ADR-159 §8.2). The run brief's shorthand "EU region" covers only the sending region; the policy says both.
- **D9** The portal sentence also names "a payment received": the portal sends `payment_recorded`, which today's
  English sentence omits (the Arabic draft in the analytics README already had it).
- **D10** This is the policy's "next real revision" (MUT-400/402 D4): English says MTB3A, and the brand guard's
  privacy exemption is removed.
- **D11** No terms version bump: the privacy policy isn't pinned or accepted, and the terms text is unchanged.
- **D12** `sharing` also names Cloudflare as the carrier for the portal and API (true since the MUT-112 front door).
- **D13** Not in this draft, flagged for Basel: Stripe (billing, MUT-362/418) isn't named in the policy either.

## 9. Not in scope

Prices or trial length on the landing (MUT-365, v3); counting the CTA (D7); phone links (MUT-371); sign-in links
carrying `?lang`; the Stripe paragraph (D13, a follow-up).

## Business / product impact

- GA's front door: once Basel turns signup on, the landing sends people straight to `/signup` with no web release.
- The privacy policy catches up with what signup and mail actually do, which gates MUT-359's mail go-live (D23).
- Low risk: closed is today's page, and the legal text can't ship before Basel approves it.
