# Guide copy deck, first three guides (draft for sign-off, 2026-11-28)

Epic MUT-672. For MUT-673 (the copy deck Basel signs) and the three stories that build from it: MUT-679 (Tax Authority), MUT-785 (the invoice guide, new), MUT-681 (accountant access, owner's side). **Not signed off. The Arabic needs a native read.** Steps are checked against the real screens in the app's own strings (`src/hosted/i18n/{en,ar}.json`); what still needs a look at the screen is under "To check when each guide is built".

## The standard every guide follows (MUT-673)

1. **What it is and who needs it:** the lead, one sentence.
2. **The steps:** short, one action each, in the words the screen uses (a button's label is quoted exactly).
3. **A standing fact:** the one line a person must remember (the note). Optional.
4. **If it goes wrong:** one or two lines (`ifStuck`). Optional.

Tone: plain, second person, no reassurance, no explanation of how we operate. No sentence states a tax rule, rate, threshold or deadline of the law; a guide says what MTB3A does and links the authority's own page.

**Format.** The guide file (`src/content/guides/<id>.json`) has `lead`, `steps`, `note` and `source` today. "If it goes wrong" needs one new optional field, `ifStuck` (`{ar, en}`), rendered after the note by `GuideDrawer`. It is added by the first story that uses it (MUT-679), with its test.

## 1. Connect to the Tax Authority (`tax-authority`, MUT-679)

Replaces the draft that ships in `tax-authority.json`. Four steps, so the four drawn scenes (`guide-tax-1..4`, hero `guide-tax-hero`) fit as they are.

| | English | العربية |
|---|---|---|
| Title | Connect to the Tax Authority | الربط بسلطة الضرائب |
| Lead | Some invoices need an allocation number from the Tax Authority. Connect once and MTB3A gets it for you. | تحتاج بعض الفواتير إلى رقم تخصيص من سلطة الضرائب. اربط مرة واحدة وتحصل «متابعة» عليه لك. |
| 1 | Open Invoicing on your profile and press Connect to the Tax Authority. | افتح «الفوترة» في ملفك واضغط «الربط بسلطة الضرائب». |
| 2 | Sign in to the Tax Authority personal area with your own account. | سجّل الدخول إلى المنطقة الشخصية في سلطة الضرائب بحسابك أنت. |
| 3 | Approve MTB3A's access. | وافق على وصول «متابعة». |
| 4 | Back in MTB3A, Invoicing shows “Connected to the Tax Authority until” and a date. | عند عودتك إلى «متابعة» تظهر في «الفوترة» عبارة «مرتبط بسلطة الضرائب حتى» مع تاريخ. |
| Note | Reconnect every 90 days. | أعد الربط كل 90 يومًا. |
| If it goes wrong | If the connection ends or isn't approved, press Connect again. You can also request the number on the Tax Authority's site and enter it on the invoice. | إن انتهى الربط أو لم تتم الموافقة، اضغط «إعادة الربط». ويمكنك دائمًا طلب الرقم من موقع سلطة الضرائب وإدخاله في الفاتورة. |
| Source link | The Tax Authority's own page on allocation numbers (the address is Basel's to confirm; it is not guessed here). | صفحة سلطة الضرائب عن رقم التخصيص |

Entry points (MUT-679): the Connect button on the profile's Invoicing, the issue screen when a number is needed (`issue.refusals.ALLOCATION_NUMBER_REQUIRED`), and the expired-connection banner (`invoicing.taxAuthority.endingSoon`, `expired`).

## 2. Issue your first invoice (`issue-first-invoice`, MUT-785)

New: not in the first brief. Four steps; **art is not drawn** (see `claude-design-brief-invoice-guide.md`). Reuse nothing from the pilot Welcome or the milestone scenes: they belong to other moments.

| | English | العربية |
|---|---|---|
| Title | Issue your first invoice | إصدار أول فاتورة |
| Lead | Issue a tax invoice, receipt or credit note from MTB3A. | أصدِر فاتورة ضريبية أو إيصالًا أو إشعار دائن من «متابعة». |
| 1 | Open Invoicing on your profile and finish the setup. | افتح «الفوترة» في ملفك وأكمِل الإعداد. |
| 2 | Press Issue a document. | اضغط «إصدار مستند». |
| 3 | Choose the client and the document type, then add the lines. | اختر العميل ونوع المستند ثم أضِف البنود. |
| 4 | Check the totals and issue. | راجع المجاميع ثم أصدِر المستند. |
| Note | An issued document can't be edited. A tax invoice is corrected with a credit note. | لا يمكن تعديل المستند بعد إصداره، وتُصحَّح الفاتورة الضريبية بإشعار دائن. |
| If it goes wrong | If it asks for an allocation number, see Connect to the Tax Authority. If issuing is blocked, finish the invoicing setup. | إن طُلب رقم تخصيص فراجع «الربط بسلطة الضرائب». وإن تعذّر الإصدار فأكمِل إعداد الفوترة. |

Why this guide: invoicing is what the paid plans sell; the pilot's Welcome sends testers to "Issue an invoice"; MUT-611's "set up, nothing issued yet" prompt has no guide to open. Entry points: the Issued documents list's empty state, the Invoicing setup's last screen, and the prompt.

## 3. Invite your accountant, the owner's side (`accountant-access`, MUT-681)

Three steps, so the three drawn scenes (`guide-accountant-1..3`, hero `guide-accountant-hero`) fit. The accountant's own side (accepting, the desk) is a later guide.

| | English | العربية |
|---|---|---|
| Title | Invite your accountant | دعوة المحاسب |
| Lead | Your accountant can read your profile. They can't change anything. | يستطيع محاسبك قراءة ملفك، ولا يستطيع تغيير شيء. |
| 1 | On your profile, open Share with your accountant and press Invite by email. | في ملفك افتح «شارك مع محاسبك» واضغط «دعوة بالبريد». |
| 2 | They get an email and accept. | يصله بريد ويقبل الدعوة. |
| 3 | They see your income, payments, reports and the expenses that have a receipt. | يرى دخلك ومدفوعاتك وتقاريرك والمصروفات التي لها إيصال. |
| Note | You can stop their access at any time. | يمكنك إيقاف وصوله في أي وقت. |
| If it goes wrong | The invite lasts 14 days. If it expires, invite again. | تبقى الدعوة سارية 14 يومًا. إن انتهت فأرسل دعوة جديدة. |

Facts it rests on: read-only grant (ADR-245); an accountant sees only expenses that have a receipt (ADR-258); invites last 14 days (`inviteExpiresAt`); the owner can stop access (`sharing.accountants.stop`). Entry points: You › Profiles › Share with your accountant, and the prompt (MUT-609 is the separate offer).

## To check when each guide is built (eng-ticket step 5 of each story)

- **Tax Authority:** step 1's path against the real Invoicing page; the "Connect again" label on an expired connection; the real approval screen on the Tax Authority's side, in the sandbox (MUT-679 AC1). The 90 days is the connection's real lifetime.
- **Invoice:** which of Invoicing's five steps are required before issuing (`invoicing.required`, `issue.refusals.ISSUING_SETUP_INCOMPLETE`), so step 1 can name them if the screen needs it; that the Issue a document button is on the profile's own screens; that an exempt dealer sees receipts only (the guide must not claim every type for everyone: check whether the lead should name fewer types).
- **Accountant:** the labels in You › Profiles; that the three things in step 3 are exactly what the accountant's session shows (ADR-245 scopes plus ADR-258); that Stop is on the same screen as Invite.
- **All three:** the Arabic read aloud by a native speaker; "المصلحة" versus "العمل" for the business, and «الملف» for the profile, as the portal's own Arabic uses them.

## Decisions for Basel

1. Sign off, or edit, the English and the Arabic above (MUT-673).
2. The Tax Authority's own page for the source link.
3. Confirm the new invoice guide, and that it comes before Scan (the new story is MUT-785, under MUT-672).
4. The `ifStuck` field (a small schema addition, built with MUT-679).
