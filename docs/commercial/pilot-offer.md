# Mutaba3a hosted pilot: the offer

> **Status:** ready for Basel's sign-off (MUT-323 AC1, epic MUT-322). Internal document: none of it goes on the website. MUT-171/185 keep prices off the site until billing exists (MUT-332).
> **Seller:** Barmajiyat Ltd (UK).
> **Decided 2026-10-19:**
> - prices, currencies, the 12-month lock and yearly pricing;
> - support by email within 2 working days;
> - closing an account: 30 days, then deletion;
> - lapsed payment means read-only + export;
> - Malafat firms pay through Malafat.
>
> **Decided 2026-10-20** (MUT-323 comment 12220):
> - the pilot runs 3 months;
> - feedback calls in week 2 and at the end;
> - Stripe subscriptions created by hand in the dashboard from day one;
> - the VAT wording: "Prices exclude VAT; VAT is added where the law requires it.";
> - firms pay the Freelancer price until firm books v1 ships, then move to the Firm founder price (§2).
>
> The rate per country is open in MUT-355. It blocks the first invoice, not this sign-off. §6 lists what else is open.

## 1. Who the pilot is for

Ten paying users, in two groups:

- **Freelancers** who need to know who owes them money across more than one business.
- **Small firms** (lawyers, accountants, 2–10 people) whose owner wants the firm's money and their personal money in one place, kept apart.

The pilot is for **owners only**. A firm's staff can't be invited yet; that comes with firm roles (MUT-305/306).

**Malafat firms are not part of this offer.** Their Money access comes as a Malafat add-on on their Malafat bill (MAL-870). If one asks through /hosted, send them to Malafat instead.

## 2. Prices

Founder prices, monthly, excluding VAT:

| Tier | Monthly | Yearly (2 months free) |
|---|---|---|
| **Freelancer** | ₪39 / $10 | ₪390 / $100 |
| **Firm**, per firm | ₪299 / $80 | ₪2,990 / $800 |

- Customers in Israel pay in **ILS**; everyone else (Jordan, the Gulf, elsewhere) pays in **USD**.
- **The founder price stays locked for 12 months** from the day the account opens, whatever the list price becomes.
- **A yearly plan costs 10× the monthly price.**
- **VAT:** say exactly this: "Prices exclude VAT; VAT is added where the law requires it." Don't name a rate. The rate for each customer country is MUT-355 (Barmajiyat Ltd's accountant), which must be settled before the first invoice. Stripe Tax takes this over in MUT-332.
- **Pilot length:** the pilot runs **3 months**. After that the founder price continues until its 12 months are up.
- **Firms during the pilot:** until firm books v1 ships, the Firm tier has nothing the Freelancer tier lacks (staff invites come later, MUT-305/306). So a firm joins at the **Freelancer price** (₪39 / $10). When firm books v1 ships, tell the firm first, then move it to the **Firm founder price** (₪299 / $80), locked for 12 months from that day.

## 3. What each tier includes

The table lists **only what has shipped** (the same rule as the /hosted copy). Anything on the roadmap goes in "Coming". Don't promise a date for it.

| | Freelancer | Firm |
|---|---|---|
| Hosted account, signed in on every device | ✓ | ✓ |
| Web portal + iPhone app + Android app | ✓ | ✓ |
| Your own profiles (personal + businesses), up to 6 | ✓ | ✓ |
| Income: received, owed and payments | ✓ | ✓ |
| Clients and matters / projects | ✓ | ✓ |
| Expenses with categories and receipt photos | ✓ | ✓ |
| Trip and expense groups | ✓ | ✓ |
| Currencies: ILS, USD, EUR, JOD, AED, SAR, QAR, BHD, OMR, each kept in its own currency, with reference conversion rates | ✓ | ✓ |
| Arabic and English, Arabic by default | ✓ | ✓ |
| Firm books v1–v2 when they ship: receipts library, vendors, VAT on expenses | | ✓ |
| **Coming, no date promised:** roles and invites for staff, bills and what the firm owes, staff reimbursements, month close, VAT summary, accountant pack (CSV / XLSX + receipts) | | Coming |

**Hold before sending:**
- **The Gulf currencies** are only claimable once MUT-329's release is live. Until then the list is ILS, USD, EUR and JOD.
- **Download all my records** (MUT-325) isn't shipped yet. Until it is, promise that "we export your records for you on request".

## 4. What the pilot promises

- **Support:** email only, a reply within 2 working days. No WhatsApp or phone support.
- **Moving in:** if you used the free app, we move your records into the hosted account with you, by hand. This promise already exists on /hosted.
- **Feedback:**
  - a 20-minute call in week 2, and a 30-minute call at the end of the pilot (the exit interview in `pilot-metrics.md` §3);
  - anything else by email, whenever you like.
- **Your data is yours:**
  - **Before MUT-325 ships:** you can ask for your records at any time, and we send them to you as a file.
  - **Once MUT-325 ships:** you download them yourself.
- **If you stop paying:** your account becomes read-only. You can still see and download everything. Nothing is deleted because a payment lapsed.
- **If you close your account:** you have **30 days** to change your mind, and then everything is deleted. Backups clear 14 days after that.
- **Where the data lives:** Google Cloud in Tel Aviv (`me-west1`), backed up daily and kept for 14 days. The terms (MUT-324) say this in full.
- **What we're not:** we're not your accountant. Mutaba3a doesn't file taxes or issue legal e-invoices.

## 5. How pilot users are invoiced

Use **Stripe from day one, with no code**. Subscriptions are created by hand in the Stripe dashboard:

1. Open the **Mutaba3a** Stripe account in the Barmajiyat Ltd Organization.
2. Create two Products, **Freelancer** and **Firm**. Give each four prices: monthly and yearly, in ILS and in USD.
3. Create the customer's subscription from the Stripe dashboard, with "email invoice" collection. Stripe emails a hosted invoice page, and the customer pays by card.
4. Set the statement descriptor to `MUTABA3A`.
5. **Link the subscription to the person** (MUT-332 §5):
   - On the Customer, set metadata `mutaba3a_user_id` = the person's user id (from the admin listing).
   - On a Firm subscription, also set `mutaba3a_organization_id`.
   - Use the catalog's lookup keys (`freelancer_founder_monthly_ils` …) when creating the Prices.
   - Give the subscription a schedule: 12 months at the founder price. The phase that moves it to the list price is added once the GA list prices exist (MUT-332 D4).
   - MUT-360's webhook then picks the subscription up with no migration. Once it's switched on (pilot runbook §1.7), a payer shows as paid on `GET /v1/me` with no step from the operator beyond the metadata, and a nightly reconcile repairs anything a webhook missed.

Why Stripe from day one, when the pilot could be invoiced by hand:
- The subscriptions already exist when MUT-332's code lands, so there is nothing to migrate.
- Card changes and receipts are handled by Stripe.
- MUT-332 later connects the same subscriptions to the server's entitlements.

The account itself is still provisioned by hand (pilot runbook, MUT-327).

## 6. Still open

- **The VAT rate per customer country:** MUT-355, for Barmajiyat Ltd's accountant. It blocks the first invoice, not this sign-off. Until then the wording in §2 is all we say.
- **The reply address** *(default)*: replies go from the address the request emails' reply-to points at (see the reply template).
- **Copy that waits on other tickets:**
  - the Gulf currencies, until MUT-329's release is live;
  - "download your records yourself", until MUT-325 ships;
  - the terms link, until MUT-324's /terms is live.

---

# برنامج متابعة المستضافة التجريبي: العرض

> **الحالة:** مسودة بانتظار موافقة باسل (MUT-323). وثيقة داخلية لا يُنشر منها شيء على الموقع.
> **البائع:** Barmajiyat Ltd (المملكة المتحدة).

## ١. لمن البرنامج

عشرة مستخدمين يدفعون:

- **المستقلون** الذين يريدون معرفة من يدين لهم بالمال عبر أكثر من عمل.
- **المكاتب الصغيرة** (محامون ومحاسبون، من شخصين إلى عشرة) التي يريد صاحبها أموال المكتب وأمواله الشخصية في مكان واحد، كلٌّ على حدة.

البرنامج **لأصحاب الحسابات فقط**. دعوة الموظفين تأتي مع أدوار المكتب لاحقًا.

**مكاتب ملفات (Malafat) خارج هذا العرض:** تحصل على المتابعة المالية كإضافة ضمن فاتورة ملفات.

## ٢. الأسعار

سعر المؤسسين، شهريًا، قبل ضريبة القيمة المضافة:

| الباقة | شهريًا | سنويًا (شهران مجانًا) |
|---|---|---|
| **المستقل** | ‏39 ₪ / ‏10 $ | ‏390 ₪ / ‏100 $ |
| **المكتب**، لكل مكتب | ‏299 ₪ / ‏80 $ | ‏2,990 ₪ / ‏800 $ |

- الدفع **بالشيكل** داخل إسرائيل، و**بالدولار** لبقية الدول.
- **السعر ثابت 12 شهرًا** من يوم فتح الحساب.
- السعر السنوي يعادل **10 أشهر**.
- **ضريبة القيمة المضافة:** نقول هذا بالضبط: «الأسعار لا تشمل ضريبة القيمة المضافة، وتُضاف الضريبة حيث يفرضها القانون.» لا نذكر نسبة. نسبة كل بلد يحددها محاسب الشركة في MUT-355 قبل أول فاتورة.
- **مدة التجربة:** **3 أشهر**. بعدها يستمر سعر المؤسسين حتى تكتمل أشهره الاثنا عشر.
- **المكاتب خلال التجربة:** يدفع المكتب **سعر باقة المستقل** (‏39 ₪ / ‏10 $) حتى تصدر النسخة الأولى من دفاتر المكتب. عندها نُبلغه أولًا، ثم ينتقل إلى سعر المؤسسين لباقة المكتب (‏299 ₪ / ‏80 $)، ثابتًا 12 شهرًا من ذلك اليوم.

## ٣. ما تشمله كل باقة

نذكر فقط ما هو متاح اليوم:

- **الباقتان معًا:**
  - حساب مستضاف على كل أجهزتك، مع البوابة على الويب وتطبيقَي الآيفون والأندرويد.
  - حتى 6 ملفات شخصية وتجارية.
  - الدخل المستلم والمستحق والدفعات، والعملاء والقضايا.
  - المصاريف مع صور الإيصالات، ومجموعات المصاريف للرحلات.
  - تسع عملات، كلٌّ يبقى بعملته. **قبل الإرسال:** لا نذكر عملات الخليج إلا بعد إطلاق MUT-329؛ وحتى ذلك الحين القائمة: الشيكل والدولار واليورو والدينار الأردني.
  - العربية والإنجليزية، والعربية هي الأساس.
- **باقة المكتب تضيف:** دفاتر المكتب عند صدورها: مكتبة الإيصالات، والمورّدين، وضريبة القيمة المضافة على المصاريف.
- **قادم دون موعد محدد:** أدوار الموظفين، والفواتير المستحقة على المكتب، وإغلاق الشهر، وملف المحاسب.

## ٤. ما نَعِد به خلال التجربة

- **الدعم:** بالبريد الإلكتروني فقط، والرد خلال يومَي عمل.
- **نقل سجلاتك:** ننقل سجلاتك من التطبيق المجاني معك، يدويًا.
- **رأيك:** مكالمة مدتها 20 دقيقة في الأسبوع الثاني، وأخرى مدتها 30 دقيقة في نهاية التجربة. وما عدا ذلك بالبريد متى شئت.
- **بياناتك لك:** نرسلها لك ملفًا متى طلبت، وقريبًا تنزّلها بنفسك.
- **إذا توقف الدفع:** يصبح الحساب للقراءة فقط، ويبقى التنزيل متاحًا، ولا يُحذف شيء.
- **إذا أغلقت حسابك:** أمامك **30 يومًا** للتراجع، ثم يُحذف كل شيء، وتُمحى النسخ الاحتياطية بعد 14 يومًا أخرى.
- **مكان البيانات:** خوادم Google Cloud في تل أبيب، مع نسخ احتياطي يومي.
- **لسنا محاسبك:** متابعة لا تقدّم إقراراتك الضريبية ولا تُصدر فواتير إلكترونية رسمية.

## ٥. الفواتير

- نستخدم **Stripe من اليوم الأول، دون برمجة**: ننشئ اشتراك كل عميل يدويًا من لوحة Stripe، في حساب **Mutaba3a** التابع لـ Barmajiyat Ltd.
- تصل الفاتورة بالبريد، ويدفع العميل بالبطاقة.
- حين يصل MUT-332 تكون الاشتراكات موجودة، فلا ننقل شيئًا.
