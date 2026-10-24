# MUT-175 — Portal Reports: design brief (Phase 1)

> The plan, with every decision behind this brief, is `mut-175-reports-plan.md`: B1–B9, eng D1–D6, design DR1–DR30 and DS1–DS5. This brief does not reopen any of them. It adds what the build needs: the API contract, the component list, the QA scenarios and **the en + ar copy table that Basel signs off before UI code (DR28, DT1)**.
> Tests brief: `mut-175-reports-tests.md`.

## Problem and acceptance criteria

The portal has no reports, and MUT-292 can't retire the web Insights page until it does (MUT-322 GA gate). The ACs are plan §7, ACs 1–8, as recorded on the ticket (comment 12500).

## API contract — `GET /v1/summaries/activity`

`summaryRoutes` → in `PORTAL_ROUTES`, so local mode runs the same code (ADR-097). Security: session or device session only (as `/v1/summaries/expenses`). Scopes: `summaries:read` **and** `expenses:read` (S1).

Query: `from`, `to` (inclusive ISO dates; `to` ≥ `from`, else 422 `END_BEFORE_START`; at most 13 months apart, else 422 `RANGE_TOO_LONG`), `bucket=day|month` (default `day`).

```
{
  from, to, bucket, asOf,                       // asOf = the organization's today
  dataSince: IsoDate | null,                    // earliest POSTED payment / expense in the read window
  earlierData: boolean,                         // records exist before the read window (then the stage is 3)
  buckets: [{ start: IsoDate, currencies: [{ currency, received, spent }] }],  // zero-filled across [from, to]
  currencies: [{ currency, received, spent,
                 byCategory: [{ categoryId|null, total, count }],              // summarizeExpenses
                 byCustomer: [{ customerId|null, total, count }] }],           // received per client
  history: [{ month: 'YYYY-MM', currencies: [{ currency, received, spent,
                 byCategory: [...], byCustomer: [...] }] }],                   // 12 months ending with `to`'s month
  daysToPaid: { overall: { median, n } | null, byCustomer: [{ customerId, median, n }] }   // D2: median, n ≥ 3
}
```

The read window is the first day of the month 11 months before `to`'s month, through `to`. Received counts POSTED payments by `receivedOn`; REVERSED payments never count. Amounts are decimal strings in the currency's exponent, as in every summary. Currencies are never summed (ADR-004).

## Components (portal)

| Piece | Where | Reuse |
|---|---|---|
| Period math, stage, combine, alignment | `src/hosted/data/reports.ts` (pure) | `weekStart` from `expenseGroups.ts` |
| Insights + teaser | `src/hosted/data/reportInsights.ts` (pure) | — |
| Queries (one profile; All-profiles fan-out with per-profile status) | `src/hosted/data/reportQueries.ts` | `useFxRates`, `useOrganizationSummary` |
| Page | `src/hosted/pages/views/ReportsPage.tsx` | `QueryView` |
| `HeroFigures` (count-up, ≈ popover), `InsightList` (+ teaser), `ReportControls` (period, ‹ ›, switch) | `src/hosted/components/reports/` | `.hp-popover`, `useSpringScale` |
| Chart | `DayBars` extended in place: an optional second series, opt-in | D5 characterization tests first |
| Lists | `CategoryBars` gains optional `meta` and plain (non-button) rows | — |
| Route + search | `reportsRoute`, `parseReports` (`period`, `at`, `scope`) | single filters object |
| Nav | `SECTIONS` gets Reports after Overview (MUT-426 moves it to the corner icon) | — |
| Analytics | `report_viewed {period, scope, stage}`, taxonomy v2.2.0 | MUT-153 opt-in |

## QA scenarios (Phase 5)

`qa/features/portal/reports.yaml` + `qa/specs/portal/reports.spec.ts`, tags `@portal.reports.<id>`:

| id | Steps (as the user would say them) | Promise |
|---|---|---|
| first-run | Open Reports on a profile with no records | One block: "Your reports start with your first payment or expense" + the two capture actions |
| first-month | Log a payment and an expense this month, open Reports | Received headline, Spent, Kept, Owed line, chart, teaser naming the unlock month |
| third-month | Profile with records since 3 months back, open Reports | "Lately" lists up to 3 insights (mover, concentration, days to paid, best month …) |
| converted-breakdown | ILS + USD received, tap the ≈ figure | The popover lists the exact amount per currency and the ECB date |
| period-step | Switch Week / Month / Year, step ‹ and › | Caption and figures follow; Next is off at the current period |
| all-profiles-switch | Two profiles, turn on All profiles | Combined line, "Of which {profile}", URL keeps `?scope=all` |
| arabic | Open Reports in Arabic | RTL, Arabic copy, mirrored chart |
| signed-out | Local mode, open Reports | Same page, no network for the report |

## Copy table (DR28) — **awaiting Basel's sign-off**

All keys live under `hosted.reports.*` unless the key starts with `hosted.`. Plural keys (marked ⓟ) use `tp`: English `one`/`other`, Arabic `zero`/`one`/`two`/`few`/`many`/`other`. Amounts are always `<bdi>`. "Billed" appears nowhere (B2). Months and dates are formatted at runtime with `Intl` in the reader's language.

### Shell and controls

| Key | English | Arabic |
|---|---|---|
| `hosted.shell.nav.reports` | Reports | التقارير |
| `title` | Reports | التقارير |
| `period.label` | Period | الفترة |
| `period.week` / `.month` / `.year` | Week / Month / Year | أسبوع / شهر / سنة |
| `period.yearLocked` | Unlocks in {month} | يُتاح في {month} |
| `step.previous.week` / `.month` / `.year` | Previous week / Previous month / Previous year | الأسبوع السابق / الشهر السابق / السنة السابقة |
| `step.next.week` / `.month` / `.year` | Next week / Next month / Next year | الأسبوع التالي / الشهر التالي / السنة التالية |
| `scope.switch` | All profiles | كل الملفات |

### Hero

| Key | English | Arabic |
|---|---|---|
| `hero.received` | Received | المستلَم |
| `hero.spent` | Spent | المصروف |
| `hero.kept` | Kept | المتبقي |
| `hero.keptNegative` | Spent more than came in | أنفقت أكثر مما دخل |
| `hero.soFar` | {period} · so far | {period} · حتى الآن |
| `hero.weekRange` | {from} – {to} | {from} – {to} |
| `hero.converted` | ≈ {amount} | ≈ {amount} |
| `hero.breakdownOpen` | Show the exact amount in each currency | اعرض المبلغ الدقيق بكل عملة |
| `hero.breakdownTitle` | Exact amounts | المبالغ الدقيقة |
| `hero.rateFooter` | ECB · {date} · today's rate | البنك المركزي الأوروبي · {date} · سعر اليوم |
| (reused) `hosted.groups.detail.rateLine`, `.peg` | 1 {from} = {rate} {to} · USD peg | (existing) |
| `owed.label` | Owed to you now | المستحق لك الآن |
| `owed.open` | Open Owed to you | افتح المستحق لك |

### All profiles (DS1–DS5)

| Key | English | Arabic |
|---|---|---|
| `combined.profiles` ⓟ | one: {count} profile · other: All {count} profiles | two: الملفين · few: {count} ملفات · many: {count} ملفًا · other: {count} ملف (zero/one → other) |
| `combined.line` | {profiles} combined · other currencies at today's rate | مجموع {profiles} · العملات الأخرى بسعر اليوم |
| `combined.listTitle` | Profiles in this report | الملفات في هذا التقرير |
| `combined.share` | Of which {profile}: ≈ {amount} | منها «{profile}»: ≈ {amount} |
| `combined.partial` | {loaded} of {total} profiles · {profile} couldn't load | {loaded} من {total} · تعذّر تحميل «{profile}» |
| `combined.forbidden` | {profile} isn't included: you can't see its payments | «{profile}» غير مشمول: لا يمكنك رؤية دفعاته |
| `combined.retry` | Retry | إعادة المحاولة |
| `noAccess.title` | You can't see this profile's payments | لا يمكنك رؤية دفعات هذا الملف |
| `noAccess.body` | Ask an owner. | اطلب ذلك من أحد المالكين. |

### Insights ("Lately", DR16/DR19/DR20)

| Key | English | Arabic |
|---|---|---|
| `insights.heading` | Lately | مؤخرًا |
| `insights.singleCurrency` | In {currency} only: today's rates aren't available | بـ{currency} فقط: أسعار اليوم غير متاحة |
| `insights.recap.base` | In {month}: {received} received, {spent} spent. | في {month}: استلمت {received} وأنفقت {spent}. |
| `insights.recap.topCategory` | Most spending went to {category}. | ذهب معظم الإنفاق إلى {category}. |
| `insights.recap.topClient` | {client} paid the most. | دفع {client} أكثر من غيره. |
| `insights.mover.up` | {category}: {amount} in {month}, {delta} more than {previous}. | {category}: {amount} في {month}، أكثر بـ{delta} من {previous}. |
| `insights.mover.down` | {category}: {amount} in {month}, {delta} less than {previous}. | {category}: {amount} في {month}، أقل بـ{delta} من {previous}. |
| `insights.trend.up` | Received in {month}: {amount}, {delta} more than {previous}. | المستلَم في {month}: {amount}، أكثر بـ{delta} من {previous}. |
| `insights.trend.down` | Received in {month}: {amount}, {delta} less than {previous}. | المستلَم في {month}: {amount}، أقل بـ{delta} من {previous}. |
| `insights.average` | Over the last 3 months you received about {amount} a month. | في آخر 3 أشهر استلمت نحو {amount} شهريًا. |
| `insights.best` | Your best month in the last year was {month}: {amount} received. | أفضل شهر لك في السنة الأخيرة كان {month}: استلمت {amount}. |
| `insights.concentration` | {client} paid {percent} of what you received in the last 3 months. | دفع {client} {percent} مما استلمته في آخر 3 أشهر. |
| `insights.daysToPaid` ⓟ | one: Clients typically pay in full {count} day after you log what they owe. · other: … {count} days … | zero: يسدّد العملاء عادةً كامل المستحق في يوم تسجيله نفسه. · one: … بعد يوم واحد من تسجيله. · two: … بعد يومين من تسجيله. · few: … بعد {count} أيام من تسجيله. · many: … بعد {count} يومًا من تسجيله. · other: … بعد {count} يوم من تسجيله. (prefix: يسدّد العملاء عادةً كامل المستحق) |
| `insights.daysToPaidSameDay` | Clients typically pay in full the same day you log what they owe. | يسدّد العملاء عادةً كامل المستحق في يوم تسجيله نفسه. |

### Teaser (B8, DR17, DR24, DS5)

| Key | English | Arabic |
|---|---|---|
| `teaser.stage1` | Your first monthly recap arrives in {month}. | يصلك أول ملخص شهري في {month}. |
| `teaser.stage2` | Trends, your best month and how fast clients pay unlock in {month}. | تُتاح الاتجاهات وأفضل أشهرك وسرعة دفع العملاء في {month}. |
| `teaser.scope` | {profile} started in {month}; insights unlock in {unlock}. | بدأ «{profile}» في {month}، وتُتاح الرؤى في {unlock}. |
| `teaser.seeAll` | See insights across all profiles | اعرض الرؤى عبر كل الملفات |

### Empty and loading states (DR6–DR8)

| Key | English | Arabic |
|---|---|---|
| `firstRun.title` | Your reports start with your first payment or expense | تبدأ تقاريرك مع أول دفعة أو مصروف |
| `firstRun.body` | Log what came in or what you spent, and this page fills in day by day. | سجّل ما دخل أو ما أنفقت، وتمتلئ هذه الصفحة يومًا بعد يوم. |
| (reused) `hosted.income.add`, `hosted.expenses.record` | + Add income · Record expense | (existing) |
| `empty.period` | Nothing logged in {period} | لا شيء مسجّل في {period} |
| `empty.goTo` | Go to {period} | انتقل إلى {period} |
| `loading` | Loading reports | جارٍ تحميل التقارير |

### Chart and lists (DR13, DR22, DR23, DR26, DR30)

| Key | English | Arabic |
|---|---|---|
| `chart.days` | Day by day | يومًا بيوم |
| `chart.months` | Month by month | شهرًا بشهر |
| `chart.labelDays` | Received and spent per day. Arrow keys move between days. | المستلَم والمصروف لكل يوم. تنقّل بين الأيام بمفاتيح الأسهم. |
| `chart.labelMonths` | Received and spent per month. Arrow keys move between months. | المستلَم والمصروف لكل شهر. تنقّل بين الأشهر بمفاتيح الأسهم. |
| `chart.bar` | {date}: received {received}, spent {spent} | {date}: المستلَم {received}، المصروف {spent} |
| `chart.selected` | {date} · Received {received} · Spent {spent} | {date} · المستلَم {received} · المصروف {spent} |
| `chart.beforeStart` | before you started | قبل أن تبدأ |
| `lists.whereItWent` | Where it went | أين ذهب المال |
| `lists.noSpending` | No spending in {period} | لا مصاريف في {period} |
| (reused) `hosted.groups.detail.uncategorized` | Uncategorized | بدون تصنيف |
| `lists.whoPaid` | Who paid | من دفع |
| `lists.noClient` | Not linked to a client | غير مرتبط بعميل |
| `lists.typically` ⓟ | one: typically {count} day · other: typically {count} days | zero: عادةً في اليوم نفسه · one: عادةً خلال يوم · two: عادةً خلال يومين · few: عادةً خلال {count} أيام · many: عادةً خلال {count} يومًا · other: عادةً خلال {count} يوم |
| `lists.typicallySameDay` | typically the same day | عادةً في اليوم نفسه |
| `lists.biggestChange` | biggest change | أكبر تغيّر |

## i18n, cost, infra

- i18n: every string above in both files, with the key-parity test. RTL is mirrored per the existing `DayBars` contract; ‹ › follow reading order.
- Cost: one request per profile per period (cached 30 s); no new infrastructure. Server reads stay in memory (TD-221 if a profile's year passes ~10k rows).
- No env vars, no infra changes.
