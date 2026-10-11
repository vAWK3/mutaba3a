# MUT-43 — Portal auth states (design addendum)

- **Date:** 2026-10-11 · **Status:** draft, awaiting owner approval
- **Ticket:** MUT-43 under epic MUT-34 · **Extends:** `hosted-portal.md` §7.1, §7.5, §7.6 (approved). Where this file and the brief differ, this file wins once approved; the deltas are listed in §5.
- **Wireframe:** `mut-43-auth-states-wireframe.html` (every state below, en/ar, desktop/phone, light/dark from the OS)
- **Server side:** unchanged. Everything here consumes MUT-38's `POST /v1/sessions`, `DELETE /v1/sessions/current` and `GET /v1/me` as built.

## 1. Problem

The brief specifies the sign-in form, one failure sentence, the 429 sentence and the mid-session redirect. It leaves out what the person sees while the session is checked, when the server is down before sign-in, when the account has no profile, when a profile disappears mid-session, when sign-out itself fails, and what happens to other open tabs. Each of those is a moment where the portal could either show stale firm figures or leave someone unable to tell what went wrong. This addendum closes them.

## 2. States

| Id | State | Trigger | What the person sees | Behaviour |
|---|---|---|---|---|
| S1 | Checking session | First load; `GET /v1/me` in flight | Wordmark only. A small spinner appears after 400 ms | Never the sign-in form and never the shell, so neither flashes for a signed-in person |
| S2 | Can't reach Mutaba3a (boot) | `/v1/me` fails with a network error or 5xx | Full-page card, `role="alert"`, with Try again | Not the sign-in page: we don't know the person is signed out, and a password typed into a page that can't reach the server goes nowhere |
| S3 | Sign in | `/v1/me` → 401, or `/sign-in` opened directly | Wordmark, "Sign in", email, password with Show/Hide, Sign in button, help line, language switch | Email has focus |
| S4 | Missing input | Submit with an empty or malformed field | Inline message under the field | No request is sent. Focus moves to the first invalid field |
| S5 | Signing in | Request in flight | Button reads "Signing in…" and is disabled; fields are read-only | Blocks double submit |
| S6 | Didn't match | `401 INVALID_CREDENTIALS` | Error banner above the fields: "That email and password don't match. After 5 tries, sign-in pauses for 15 minutes." | Password cleared and focused; email kept. The same banner covers wrong password, unknown email, lockout and disabled account, because the server makes them indistinguishable |
| S7 | Too many attempts | `429 RATE_LIMITED` | "Too many attempts from this network. Try again in {minutes} minutes." | Minutes from `Retry-After`, rounded up, via `tp()` (Arabic needs all six plural forms) |
| S8 | Can't reach (sign-in) | Network error, 5xx, or any other unexpected status (`403 CROSS_SITE_REQUEST`, `422`) | "Couldn't reach Mutaba3a. Check your connection and try again." | Both fields keep their values |
| S9 | Session ended | Arrived via a mid-session 401 (`?reason=expired`) | Neutral note above the form: "You've been signed out. Sign in again to continue." | After sign-in, returns to `next` |
| S10 | Signed out | Arrived via the user menu (`?reason=signed_out`) | Neutral note: "You've signed out." | No `next`: the next person on a shared machine starts at `/` |
| — | Already signed in | `/sign-in` opened with a valid session | Nothing | Redirect to `next`, else `/` |
| S11 | No profiles | Signed in; `me.profiles` is empty | Shell without the profile nav. Empty state: "Your account isn't connected to a profile yet." + "Ask the person who set up your account to give you access." + Sign out | `/` has nowhere to redirect, so it renders this instead |
| S12 | Profile unavailable | `$profileId` not in `me.profiles`, or a profile-scoped call answers 404 and a refetch of `/v1/me` no longer lists the profile | In the shell: "This profile isn't available." + "It may have been removed from your account." + "Go to {name}" (the first remaining profile) | The switcher updates from the refetched `/v1/me`. A 404 for one record (an unknown customer) while the profile is still listed is an ordinary not-found, not S12 |
| S13 | Sign-out failed | `DELETE /v1/sessions/current` fails | Error toast: "Couldn't sign out. Check your connection and try again." The person stays where they are | The cookie is httpOnly, so the page cannot clear it. Claiming a sign-out that didn't happen would leave the next person on the machine signed in |

## 3. Session events

- **E1 Session ends mid-use.** Any 401 from any call → `queryClient.clear()` → `/sign-in?next=<current path>&reason=expired` (S9). One path covers the 2-hour idle limit, the 12-hour cap, an operator password rotation or disable, pepper rotation, and a sign-out in another browser.
- **E2 Sign out.** User menu → Sign out. No confirm dialog: it is reversible and the person asked for it. On `204`: clear the query cache, broadcast (E3), go to `/sign-in?reason=signed_out` (S10). On failure: S13.
- **E3 Other tabs.** On sign-out, post `signed_out` on `BroadcastChannel('mut-session')`. Every other portal tab clears its cache and goes to S10 at once. Without this, a forgotten second tab keeps firm figures on screen until its next request.
- **E4 Language.** The switch on the sign-in page sets this browser's language and stores it (the one thing the portal persists, per brief §7.1). After sign-in, the account's `locale` applies only if this browser has no stored choice. An explicit choice in this browser always wins.
- **`next`.** Accepted only as a same-origin relative path: it starts with `/`, not `//` or `/\`. Anything else becomes `/`.

## 4. Form mechanics

- A native `<form>` with `novalidate`; the portal does its own validation so messages are translated and consistent. Enter submits.
- Email input: `type="email"`, `inputmode="email"`, `autocomplete="username"`, `autocapitalize="none"`, `spellcheck="false"`, `dir="ltr"`.
- Password input: `autocomplete="current-password"`, `dir="ltr"`. The Show/Hide toggle is a `<button type="button">` with `aria-pressed` and `aria-controls`.
- Email and password stay left-to-right in Arabic, because an address and a password are LTR strings. Labels, banner and help line follow the page direction.
- The error banner is `role="alert"`; each input's `aria-describedby` points at its own field message and at the banner.
- No "remember me" (brief §12). No link other than the language switch. The help line is plain text, not a link.
- Layout: a centred 360 px card on the page background, the wordmark above it, the help line below it, the language switch in the top inline-end corner. At phone width the card fills the width inside 16 px gutters.
- Built from the existing tokens (`theme.css`) and the reusable `Button`, `Input` and `Card`. No new component except the sign-in page itself.

## 5. Deltas from the approved brief (each needs owner approval)

1. **S6 adds a second sentence** about the 15-minute pause. The brief has one sentence. After a lockout, the *correct* password also gets "don't match"; without the hint a person keeps trying, or concludes the account is broken. It is safe: the lockout keys on any email string, so the hint reveals nothing about which accounts exist.
2. **A help line under the form** ("Can't sign in? Ask the person who set up your account for a new password."). The brief has none, which leaves someone who has lost their password with no next step. The copy avoids every string the bundle check bans.
3. **S2 is its own full-page state.** The brief's unreachable card covers views, not boot.
4. **S11 no-profiles state.** The brief's `/` redirect assumes at least one profile.
5. **S13 keeps the person signed in when sign-out fails**, rather than pretending.
6. **E3 cross-tab sign-out** via `BroadcastChannel`.
7. **E4 language precedence** (browser choice, then account locale).
8. **Two arrival notes, S9 and S10**, told apart by `reason`. The brief has the S9 line only.

## 6. Copy (en / ar)

All under `hosted.auth.*`, parity-tested with the rest of `hosted.*`.

| Key | en | ar |
|---|---|---|
| `title` | Sign in | تسجيل الدخول |
| `email` | Email | البريد الإلكتروني |
| `password` | Password | كلمة المرور |
| `show` / `hide` | Show / Hide | إظهار / إخفاء |
| `submit` | Sign in | تسجيل الدخول |
| `submitting` | Signing in… | جارٍ تسجيل الدخول… |
| `emailRequired` | Enter your email. | أدخل بريدك الإلكتروني. |
| `emailInvalid` | Enter an email address, like name@firm.ps. | أدخل عنوان بريد إلكتروني، مثل name@firm.ps. |
| `passwordRequired` | Enter your password. | أدخل كلمة المرور. |
| `invalid` | That email and password don't match. After 5 tries, sign-in pauses for 15 minutes. | البريد الإلكتروني وكلمة المرور غير متطابقين. بعد 5 محاولات يتوقف تسجيل الدخول لمدة 15 دقيقة. |
| `rateLimited` (plural on `minutes`) | Too many attempts from this network. Try again in {minutes} minutes. | محاولات كثيرة من هذه الشبكة. حاول مجدداً بعد {minutes} دقائق. |
| `unreachable` | Couldn't reach Mutaba3a. Check your connection and try again. | تعذّر الوصول إلى متابعة. تحقّق من اتصالك وحاول مجدداً. |
| `expired` | You've been signed out. Sign in again to continue. | انتهت جلستك. سجّل الدخول مجدداً للمتابعة. |
| `signedOut` | You've signed out. | تم تسجيل خروجك. |
| `help` | Can't sign in? Ask the person who set up your account for a new password. | لا تستطيع الدخول؟ اطلب كلمة مرور جديدة ممّن أعدّ حسابك. |
| `boot.title` | Can't reach Mutaba3a right now | تعذّر الوصول إلى متابعة الآن |
| `boot.body` | Figures aren't stored on this device, so nothing is shown until the connection is back. | لا تُحفظ الأرقام على هذا الجهاز، لذلك لا يظهر شيء حتى يعود الاتصال. |
| `boot.retry` | Try again | حاول مجدداً |
| `noProfiles.title` | Your account isn't connected to a profile yet | حسابك غير مرتبط بأي ملف بعد |
| `noProfiles.body` | Ask the person who set up your account to give you access. | اطلب ممّن أعدّ حسابك أن يمنحك الوصول. |
| `unavailable.title` | This profile isn't available | هذا الملف غير متاح |
| `unavailable.body` | It may have been removed from your account. | ربما أُزيل من حسابك. |
| `unavailable.goTo` | Go to {name} | الانتقال إلى {name} |
| `signOut` | Sign out | تسجيل الخروج |
| `signOutFailed` | Couldn't sign out. Check your connection and try again. | تعذّر تسجيل الخروج. تحقّق من اتصالك وحاول مجدداً. |

The `rateLimited` Arabic shown is the `few` form; the six plural forms are written out in `ar.json`.

**Bundle check strings.** `check-bundles` bans, case-insensitively: `sign up`, `create account`, `forgot`, `reset password`, `invite`, and in Arabic `إنشاء حساب`, `نسيت`, `إعادة تعيين`, `دعوة`, `اشترك`. It deliberately does **not** ban `تسجيل`, because `تسجيل الدخول` is "sign in".

## 7. Tests this adds to the MUT-43 test plan

- Boot: S1 renders neither the form nor the shell; S2 on a network error and on a 500, and Try again refetches.
- Sign-in: S4 sends no request; S5 blocks a second submit; S6 clears and focuses the password and keeps the email; S7 reads `Retry-After` and pluralises in en and ar; S8 for a network error, a 500 and a 403.
- Arrival notes: `reason=expired` shows S9 and honours `next`; `reason=signed_out` shows S10 and drops `next`; an off-origin `next` (`//evil.example`, `https://…`, `/\evil`) becomes `/`.
- E1: any 401 clears the cache before navigating (a stale figure never renders on the sign-in route).
- E2/S13: sign-out success clears, broadcasts and navigates; a failure keeps the page and toasts.
- E3: a `signed_out` broadcast clears the cache and navigates in the receiving tab.
- E4: the account locale applies only with no stored choice.
- S11 and S12, including the "404 for a record while the profile is still listed" negative case.
- Accessibility: labels, `autocomplete` values, `dir="ltr"` on both inputs, `role="alert"` on the banner.
