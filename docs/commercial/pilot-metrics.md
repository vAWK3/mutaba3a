# Mutaba3a hosted pilot: success bars and the exit interview

> **Status:** bars signed off by Basel on 2026-10-20 (MUT-330 comment 12221, epic MUT-322). Internal document.
> **When they're measured:** across the 10 pilot users, at the end of the 3-month pilot (`pilot-offer.md`).
> **Weekly tracking:** `pilot-reviews.md`, every Monday.

## 1. The GA go/no-go bars

| Measure | Bar | Where the number comes from |
|---|---|---|
| **Activation** | at least **8 of 10** record a first income or expense within 7 days of setup | the operator count, query 2, `activated` (§2) |
| **Weekly use** | at least **6 of 10** have entries in at least **3 of the last 4 weeks** | the operator count, query 2, `weeks_with_entries_of_last_4` ≥ 3, with `as_of` set to the pilot's last day |
| **Paid conversion** | at least **7 of 10** still paying at the end of the pilot | the Stripe dashboard (§2) |
| **Willingness to pay** | at least **40%** answer "very disappointed" to the Sean Ellis question | the exit interview (§3) |
| **Support load** | at most **0.5 tickets per user per week** | the support inbox (§2) |

**The verdict:**
- All five bars met: **GO** for GA.
- One bar missed: **extend the pilot.**
- Two or more bars missed: **no-go.**

The bars are counts out of 10. If the cohort isn't 10 people when the first user is onboarded, Basel sets the bars again before that.

## 2. How each number is taken

**Activation and weekly use: the operator count.**
- The query is in the runbook: `server/DEPLOYMENT.md` §6a. It runs read-only, and its output is never sent anywhere (ADR-024).
- "Setup" is when the person sets their password through the setup link.
- An entry is an expense, a Received payment or an Owed entry. It counts in the week it was logged.
- Pilot users appear as codes (`P01`…`P10`). The list of who is who stays off the repository (runbook §6a).

**PostHog dashboard 1031822** ("Acquisition and activation", EU project 304889) is a cross-check only. It sees only people who opted in, so it undercounts. It also can't tell pilot users from anyone else who opted in. Use it for the trend and the surface split (portal or phone), never as the number of record. Two tiles follow the bars:
- **"Pilot activation: opt-in → first entry within 7 days"**: a funnel from `analytics_opted_in` to the action "Recorded an entry". It starts at opt-in, not at setup.
- **"Pilot weekly use: weeks with an entry, last 4"**: cumulative stickiness over four 7-day periods. PostHog labels each bar "day", but each bar is one 7-day period. The bar at 3 is the one to read.

The action **"Recorded an entry"** (170934) is any of `income_recorded`, `expense_recorded` or `payment_recorded`.

**Paid conversion: Stripe.**
- A user counts as **still paying** when they have paid the **month-3 invoice** and haven't asked to leave.
- A yearly payer counts as paying unless they've asked to leave.
- This is measured at the end of the pilot, not at the end of the 12-month founder lock, which runs well past it.

**Support load: the support inbox.**
- A ticket is a new email thread from a pilot user that asks for help or reports a problem.
- Replies in the same thread aren't new tickets. Neither are feedback calls, or feedback sent by email when nobody asked for help.
- Support load = tickets ÷ (pilot users × weeks of the pilot). At the end, that's the whole pilot. In the weekly review, it's the last 4 weeks.

**Willingness to pay: the exit interview.**
- Ask every pilot user, including anyone who has left.
- The share is the "very disappointed" answers out of everyone who answered.

## 3. The exit interview (30 minutes)

This is the end-of-pilot call in `pilot-offer.md` §4. Run it in the person's language. Take notes, and don't record the call unless they agree.

**Rules for the interviewer:**
- Ask about what they did, not what they would do.
- Don't defend the product, and don't explain how a feature works unless they ask.
- When they mention a problem, ask for the last time it happened.

| Time | Part | Questions |
|---|---|---|
| 0–3 | Opening | Thanks, the call takes 30 minutes, and nothing you say is wrong. We want to know what to keep and what to fix. |
| 3–10 | How they used it | Walk me through the last time you opened Mutaba3a. What were you doing? Which device do you use most, and why? How did you track this before? |
| 10–18 | What worked and what didn't | What did you use most? What was harder than it should be? Was there something you expected to find and didn't? What did you stop using? |
| 18–24 | Money and value | What made it worth paying for, or not? If the price went up after the founder period, what would you do? What would you use instead? |
| 24–28 | Others | Who else do you know who has this problem? What would you tell them about Mutaba3a? |
| 28–30 | **The Sean Ellis question, always last** | "How would you feel if you could no longer use Mutaba3a?" **Very disappointed / Somewhat disappointed / Not disappointed (it isn't really useful).** Read the three answers out, and write down the one they choose, word for word. |

Close with thanks and what happens next: their price and records stay the same either way.

### المقابلة الختامية (30 دقيقة)

هذه هي مكالمة نهاية التجربة. نجريها بلغة المستخدم.

| الوقت | الجزء | الأسئلة |
|---|---|---|
| 0–3 | البداية | شكرًا لك. تستغرق المكالمة 30 دقيقة، ولا توجد إجابة خاطئة. نريد أن نعرف ما نُبقيه وما نُصلحه. |
| 3–10 | كيف استخدمته | حدّثني عن آخر مرة فتحت فيها متابعة. ماذا كنت تفعل؟ أي جهاز تستخدم أكثر، ولماذا؟ كيف كنت تتابع هذا من قبل؟ |
| 10–18 | ما نجح وما لم ينجح | ما الذي استخدمته أكثر؟ ما الذي كان أصعب مما يجب؟ هل بحثت عن شيء ولم تجده؟ ما الذي توقفت عن استخدامه؟ |
| 18–24 | المال والقيمة | ما الذي جعله يستحق الدفع، أو لم يجعله كذلك؟ لو ارتفع السعر بعد فترة المؤسسين، ماذا ستفعل؟ ماذا كنت ستستخدم بدلًا منه؟ |
| 24–28 | الآخرون | من تعرف ممن لديهم المشكلة نفسها؟ ماذا ستقول لهم عن متابعة؟ |
| 28–30 | **سؤال شون إليس، دائمًا في النهاية** | «كيف ستشعر لو لم يعد بإمكانك استخدام متابعة؟» **بخيبة أمل كبيرة / بخيبة أمل بسيطة / لن أشعر بخيبة أمل (فهو ليس مفيدًا لي حقًا).** اقرأ الإجابات الثلاث، واكتب الإجابة التي يختارها كما قالها. |

نختم بالشكر، ونوضّح أن سعره وسجلاته تبقى كما هي في كل الأحوال.
