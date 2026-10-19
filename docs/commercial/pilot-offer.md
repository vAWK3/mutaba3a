# Mutaba3a hosted pilot: the offer

> **Status:** draft for Basel's sign-off (MUT-323, epic MUT-322). Internal document: none of it goes on the website. MUT-171/185 keep prices off the site until billing exists (MUT-332).
> **Seller:** Barmajiyat Ltd (UK).
> **Decided 2026-10-19:**
> - prices, currencies, the 12-month lock and yearly pricing;
> - support by email within 2 working days;
> - closing an account: 30 days, then deletion;
> - lapsed payment means read-only + export;
> - Malafat firms pay through Malafat.
>
> **Defaults set here** are marked *(default)*. Change them before the first offer goes out.

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
- **VAT:** prices exclude VAT. Whether VAT is added, and at what rate, depends on where the customer is. Confirm with Barmajiyat Ltd's accountant before the first invoice; Stripe Tax takes this over in MUT-332.
- **Pilot length:** the cohort runs **3 months** *(default)*. After that the founder price simply continues until its 12 months are up.

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

- **Support:** email only, with a reply **within 2 working days**. No WhatsApp or phone support.
- **Moving in:** if you used the free app, we move your records into the hosted account with you, by hand. This promise already exists on /hosted.
- **Feedback:**
  - a 20-minute call in week 2 and another at the end of the pilot *(default)*;
  - anything else by email, whenever you like.
- **Your data is yours:**
  - **Before MUT-325 ships:** you can ask for your records at any time, and we send them to you as a file.
  - **Once MUT-325 ships:** you download them yourself.
- **If you stop paying:** your account becomes read-only. You can still see and download everything. Nothing is deleted because a payment lapsed.
- **If you close your account:** you have **30 days** to change your mind, and then everything is deleted. Backups clear 14 days after that.
- **Where the data lives:** Google Cloud in Tel Aviv (`me-west1`), backed up daily and kept for 14 days. The terms (MUT-324) say this in full.
- **What we're not:** we're not your accountant. Mutaba3a doesn't file taxes or issue legal e-invoices.

## 5. How pilot users are invoiced

Use **Stripe from day one, with no code** *(default)*:

1. Open the **Mutaba3a** Stripe account in the Barmajiyat Ltd Organization.
2. Create two Products, **Freelancer** and **Firm**. Give each four prices: monthly and yearly, in ILS and in USD.
3. Create the customer's subscription from the Stripe dashboard, with "email invoice" collection. Stripe emails a hosted invoice page, and the customer pays by card.
4. Set the statement descriptor to `MUTABA3A`.

Why Stripe from day one, when the pilot could be invoiced by hand:
- The subscriptions already exist when MUT-332's code lands, so there is nothing to migrate.
- Card changes and receipts are handled by Stripe.
- MUT-332 later connects the same subscriptions to the server's entitlements.

The account itself is still provisioned by hand (pilot runbook, MUT-327).

## 6. Decisions still open in this document

These have defaults. Change any of them before the first offer goes out:
- the pilot length (3 months);
- the feedback calls (week 2 and the end);
- Stripe from day one;
- the reply address (the request emails' reply-to; see the reply template).
- **VAT treatment:** the one item with no default. Ask the accountant.

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
- **ضريبة القيمة المضافة:** تُضاف حسب بلد العميل، ويُؤكَّد ذلك مع محاسب الشركة قبل أول فاتورة.

## ٣. ما تشمله كل باقة

نذكر فقط ما هو متاح اليوم:

- **الباقتان معًا:**
  - حساب مستضاف على كل أجهزتك، مع البوابة على الويب وتطبيقَي الآيفون والأندرويد.
  - حتى 6 ملفات شخصية وتجارية.
  - الدخل المستلم والمستحق والدفعات، والعملاء والقضايا.
  - المصاريف مع صور الإيصالات، ومجموعات المصاريف للرحلات.
  - تسع عملات، كلٌّ يبقى بعملته.
  - العربية والإنجليزية، والعربية هي الأساس.
- **باقة المكتب تضيف:** دفاتر المكتب عند صدورها: مكتبة الإيصالات، والمورّدين، وضريبة القيمة المضافة على المصاريف.
- **قادم دون موعد محدد:** أدوار الموظفين، والفواتير المستحقة على المكتب، وإغلاق الشهر، وملف المحاسب.

## ٤. ما نَعِد به خلال التجربة

- **الدعم:** بالبريد الإلكتروني فقط، ونرد **خلال يومَي عمل**.
- **نقل سجلاتك:** ننقل سجلاتك من التطبيق المجاني معك، يدويًا.
- **بياناتك لك:** نرسلها لك ملفًا متى طلبت، وقريبًا تنزّلها بنفسك.
- **إذا توقف الدفع:** يصبح الحساب للقراءة فقط، ويبقى التنزيل متاحًا، ولا يُحذف شيء.
- **إذا أغلقت حسابك:** أمامك **30 يومًا** للتراجع، ثم يُحذف كل شيء، وتُمحى النسخ الاحتياطية بعد 14 يومًا أخرى.
- **مكان البيانات:** خوادم Google Cloud في تل أبيب، مع نسخ احتياطي يومي.
- **لسنا محاسبك:** متابعة لا تقدّم إقراراتك الضريبية ولا تُصدر فواتير إلكترونية رسمية.
