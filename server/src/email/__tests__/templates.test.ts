import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS, type MailTemplateId, type TemplateVars } from '../ports.js';
import { renderMail } from '../templates/index.js';
import { mailDay } from '../templates/copy.js';
import { SECONDARY_INK, TEXT_PAIRS } from '../templates/layout.js';
import { ART_FILES, MAIL_ART_PATH, type CustomerTemplateId } from '../templates/look.js';

/**
 * MUT-359 A1 (ADR-159 §5, brief §8.4): every mail exists in English and Arabic, Arabic is RTL, nothing but the
 * links the caller passes is fetched or linked, and no mail ever carries an amount, a currency or a date.
 */
const LINK = 'https://portal.example.test/setup#tok_ABC123def';
const SUBSCRIBE = 'https://portal.example.test/?billing=true&step=subscribe';
const EXPORT = 'https://portal.example.test/?yourData=true';
const SAMPLE: { [T in MailTemplateId]: TemplateVars[T] } = {
  'finish-signup': { link: LINK, validHours: 24 },
  'account-exists': { signInLink: 'https://portal.example.test/', recoverLink: 'https://portal.example.test/recover' },
  'reset-password': { link: LINK, validHours: 1 },
  'finish-setup': { link: LINK, validHours: 72 },
  'password-changed': { first: false, signInLink: 'https://portal.example.test/' },
  'account-under-review': {},
  'account-ready': { signInLink: 'https://portal.example.test/' },
  'account-declined': { supportAddress: 'help@example.test' },
  'review-digest': { pending: 3, command: 'npm --prefix server run signups:review', reviewLink: 'https://portal.example.test/operator/signups' },
  'trial-ending-soon': { daysLeft: 3, subscribeLink: SUBSCRIBE },
  'trial-ended': { subscribeLink: SUBSCRIBE, exportLink: EXPORT },
  'trial-locking-soon': { daysLeft: 2, subscribeLink: SUBSCRIBE, exportLink: EXPORT },
  'account-closing': { deleteOn: { year: 2026, month: 11, day: 23 }, signInLink: 'https://portal.example.test/sign-in' },
  'passkey-added': { passkeyName: 'iCloud Keychain', signInLink: 'https://portal.example.test/' },
  'offer-renewing-soon': { renewsOn: { year: 2027, month: 11, day: 12 }, listAmount: 29000, currency: 'ILS', manageLink: 'https://portal.example.test/?billing=true' },
  'card-failed': { updateLink: 'https://portal.example.test/?billing=true' },
  'card-failed-reminder': { daysLeft: 6, readOnlyAfter: true, updateLink: 'https://portal.example.test/?billing=true' },
  'comeback-offer': { stage: 'day-90', firstMonth: 900, listMonth: 2900, firstYear: 27000, listYear: 29000, currency: 'ILS', subscribeLink: 'https://portal.example.test/?billing=true&step=subscribe', offLink: 'https://portal.example.test/mail-off?mail=offers#tok_ABC123def' },
  'tax-authority-reconnect': { stage: 'soon', daysLeft: 6, profileName: 'Sader Studio', link: 'https://portal.example.test/p/sample-profile/you/invoicing' },
  'plan-change-scheduled': { plan: 'solo', changesOn: { year: 2026, month: 12, day: 15 }, manageLink: 'https://portal.example.test/?billing=true' },
  'accountant-invite': { ownerName: 'Basel Sader', profileName: 'Sader Studio', link: 'https://portal.example.test/accountant-invite#tok_ABC123def', expiresOn: { year: 2026, month: 11, day: 20 } },
  'customer-setup': { accountantName: 'Hadi Khatib', businessName: 'Café Nour', link: LINK, validDays: 14 },
  'customer-setup-cancelled': { accountantName: 'Hadi Khatib', businessName: 'Café Nour' },
  // MUT-618: a sign-in code, typed, never a link.
  'sign-in-code': { code: '482913', validMinutes: 10 },
  'two-factor-code': { code: '482913', validMinutes: 10 },
  'two-factor-changed': { change: 'enabled', method: 'totp', signInLink: 'https://app.example.test/' },
  // MUT-535 (ADR-259): one profile in two currencies, and the yearly line.
  'monthly-summary': {
    month: { year: 2026, month: 11 },
    asOf: { year: 2026, month: 12, day: 1 },
    profiles: [
      {
        name: 'Sader Studio',
        link: 'https://portal.example.test/p/0b7d4f2e-6a1c-4c8e-9f3a-2d5b7e9c1a40',
        cameIn: [{ currency: 'ILS', amount: '12400.00' }, { currency: 'USD', amount: '900.00' }],
        owed: [{ currency: 'ILS', amount: '3200.00' }, { currency: 'USD', amount: '450.50' }],
        overdue: [{ currency: 'ILS', amount: '1100.00' }, { currency: 'USD', amount: '200.00' }],
        overdueCount: 3,
      },
    ],
    yearly: { savings: 5800, currency: 'ILS', link: 'https://portal.example.test/?billing=true&step=switch' },
    offLink: 'https://portal.example.test/mail-off#tok_ABC123def',
  },
};
/** MUT-525: the launch offer line the trial mails carry while it runs (ADR-237). */
const OFFER = { percentOff: 50, endsOn: { year: 2027, month: 2, day: 1 } };
/** Numbers a template may print, from its own count vars; anything else numeric is a defect. */
const NUMERIC_VARS: Partial<Record<MailTemplateId, string[]>> = {
  'finish-signup': ['24'],
  'reset-password': ['1'],
  'finish-setup': ['72'],
  'review-digest': ['3'],
  'trial-ending-soon': ['3'],
  'trial-locking-soon': ['2'],
  'card-failed-reminder': ['6'],
  // MUT-571 AC3: the days left and the Tax Authority's 90-day rule; no date.
  'tax-authority-reconnect': ['90', '6'],
  // MUT-734: the day the plan changes.
  'plan-change-scheduled': [mailDay({ year: 2026, month: 12, day: 15 }, 'en'), mailDay({ year: 2026, month: 12, day: 15 }, 'ar')],
  // MUT-534 (ADR-243, overriding ADR-159 §5): the come-back prices, longest first so none hides inside another.
  // '18' and the contact address (mtb3a) are in the sender's details (s.30A).
  'comeback-offer': ['₪290', '₪270', '₪29', '₪9', '18', 'info@mtb3a.com'],
  // MUT-333 (ADR-188): the deletion day is the one date a mail may carry, in the mail's own language.
  'account-closing': [mailDay({ year: 2026, month: 11, day: 23 }, 'en'), mailDay({ year: 2026, month: 11, day: 23 }, 'ar')],
  // MUT-525 (ADR-237, overriding ADR-159 §5): a renewal notice must state its price and day.
  'offer-renewing-soon': ['₪290', mailDay({ year: 2027, month: 11, day: 12 }, 'en'), mailDay({ year: 2027, month: 11, day: 12 }, 'ar')],
  // MUT-559 (ADR-245): the last day an accountant invite works, a calendar day, never a money date.
  'accountant-invite': [mailDay({ year: 2026, month: 11, day: 20 }, 'en'), mailDay({ year: 2026, month: 11, day: 20 }, 'ar')],
  'customer-setup': ['14'],
  // MUT-618 (ADR-256 D8): the code itself and its ten minutes; a code, never an amount or a date.
  'sign-in-code': ['482913', '10'],
  // MUT-710 (ADR-274 D5): the same as the sign-in code.
  'two-factor-code': ['482913', '10'],
  // MUT-535 (ADR-259, overriding ADR-159 §5): the person's own amounts per currency, the yearly saving, the overdue
  // count, the month's year and the day owed is read on. Longest first, so none hides inside another.
  'monthly-summary': [mailDay({ year: 2026, month: 12, day: 1 }, 'en'), mailDay({ year: 2026, month: 12, day: 1 }, 'ar'), '₪12,400', '$450.50', '₪3,200', '₪1,100', '$900', '$200', '₪58', '2026', '3'],
};
/** Every link in the vars, nested ones too (MUT-535: each profile's panel carries its own). */
const LINKS_OF = (vars: object): string[] =>
  Object.values(vars).flatMap((v): string[] => (typeof v === 'string' ? (/^https?:\/\//.test(v) ? [v] : []) : v && typeof v === 'object' ? LINKS_OF(v as object) : []));
const CURRENCY = /\b(USD|ILS|NIS|EUR|GBP|JOD|AED|SAR|QAR|KWD|BHD|OMR|EGP)\b|[₪$€£]|شيكل|دولار|دينار|درهم|ريال/;
const ARABIC = /[؀-ۿ]/;

describe.each(TEMPLATE_IDS)('template %s', (id) => {
  const vars = SAMPLE[id];
  const en = renderMail(id, 'en', vars as never);
  const ar = renderMail(id, 'ar', vars as never);

  it('renders a subject, text and html in both languages', () => {
    for (const mail of [en, ar]) {
      expect(mail.subject.length).toBeGreaterThan(5);
      expect(mail.text.length).toBeGreaterThan(20);
      expect(mail.html.startsWith('<!doctype html>')).toBe(true);
    }
    expect(ar.subject).toMatch(ARABIC);
    expect(en.subject).not.toMatch(ARABIC);
    expect(ar.subject).not.toBe(en.subject);
  });

  it('marks Arabic RTL and English LTR', () => {
    expect(ar.html).toContain('<html lang="ar" dir="rtl">');
    expect(en.html).toContain('<html lang="en" dir="ltr">');
  });

  it('has no images, styles, scripts or links other than the ones passed in', () => {
    for (const mail of [en, ar]) {
      expect(mail.html).not.toMatch(/<img|<style|<script|<link|url\(|background-image/i);
      const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
      const allowed = [...LINKS_OF(vars), ...('supportAddress' in vars ? [`mailto:${vars.supportAddress}`] : [])];
      for (const href of hrefs) expect(allowed).toContain(href);
      const urls = [...mail.html.matchAll(/https?:\/\/[^\s"<]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));
      for (const url of urls) expect(LINKS_OF(vars)).toContain(url);
    }
  });

  it('puts each link in the text part and, for copying, inside a left-to-right <bdi>', () => {
    for (const link of LINKS_OF(vars)) {
      for (const mail of [en, ar]) {
        expect(mail.text).toContain(link);
        // The HTML part escapes the link (`&` → `&amp;`); a mail client shows and copies it unescaped.
        expect(mail.html).toContain(`<bdi dir="ltr">${link.replace(/&/g, '&amp;')}</bdi>`);
      }
    }
  });

  it('never carries an amount, a currency or a date', () => {
    const allowed = NUMERIC_VARS[id] ?? [];
    for (const mail of [en, ar]) {
      for (const part of [mail.subject, mail.text]) {
        // The English brand name, MTB3A, is the one digit a mail always carries.
        let rest = part.split('MTB3A').join('');
        for (const link of LINKS_OF(vars)) rest = rest.split(link).join('');
        for (const n of allowed) rest = rest.split(n).join('');
        expect(rest).not.toMatch(CURRENCY);
        expect(rest).not.toMatch(/[\d٠-٩۰-۹]/u);
      }
    }
  });
});

describe('account-closing (MUT-333)', () => {
  it('names the deletion day in each language and links to sign-in', () => {
    const vars = SAMPLE['account-closing'];
    const en = renderMail('account-closing', 'en', vars);
    const ar = renderMail('account-closing', 'ar', vars);
    expect(en.subject).toBe('Your MTB3A account will be deleted on November 23, 2026');
    expect(en.text).toContain('Sign in to keep my account');
    expect(ar.subject).toContain(mailDay(vars.deleteOn, 'ar'));
    expect(ar.text).toContain(vars.signInLink);
  });
});

describe('templates', () => {
  it('cover exactly the ids the port names', () => {
    expect(Object.keys(SAMPLE).sort()).toEqual([...TEMPLATE_IDS].sort());
  });

  it('escape every value they interpolate', () => {
    const hostile = 'https://portal.example.test/setup#"><script>alert(1)</script>';
    const mail = renderMail('finish-signup', 'en', { link: hostile, validHours: 24 });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    const declined = renderMail('account-declined', 'ar', { supportAddress: 'a<b>@example.test' });
    expect(declined.html).not.toContain('a<b>');
  });

  it('refuse a link that is not http(s)', () => {
    expect(() => renderMail('finish-signup', 'en', { link: 'javascript:alert(1)', validHours: 24 })).toThrow(/link/i);
  });

  it('word a first password differently from a change', () => {
    const first = renderMail('password-changed', 'en', { first: true, signInLink: 'https://portal.example.test/' });
    const changed = renderMail('password-changed', 'en', { first: false, signInLink: 'https://portal.example.test/' });
    expect(first.subject).not.toBe(changed.subject);
    expect(changed.subject.toLowerCase()).toContain('changed');
  });

  it('agree Arabic hour counts with their number', () => {
    const one = renderMail('reset-password', 'ar', { link: LINK, validHours: 1 }).text;
    const two = renderMail('reset-password', 'ar', { link: LINK, validHours: 2 }).text;
    const five = renderMail('finish-setup', 'ar', { link: LINK, validHours: 5 }).text;
    const many = renderMail('finish-setup', 'ar', { link: LINK, validHours: 72 }).text;
    expect(one).toContain('ساعة واحدة');
    expect(two).toContain('ساعتين');
    expect(five).toContain('5 ساعات');
    expect(many).toContain('72 ساعة');
  });

  it('wrap the operator command and the support address left-to-right inside Arabic', () => {
    expect(renderMail('review-digest', 'ar', SAMPLE['review-digest']).html).toContain('<bdi dir="ltr">npm --prefix server run signups:review</bdi>');
    expect(renderMail('account-declined', 'ar', SAMPLE['account-declined']).html).toContain('<bdi dir="ltr">help@example.test</bdi>');
  });

  it('MUT-419: say "within" N days, never "in" N days, and agree Arabic day counts with their number', () => {
    const ending = (n: number, locale: 'en' | 'ar') => renderMail('trial-ending-soon', locale, { daysLeft: n, subscribeLink: SUBSCRIBE });
    const locking = (n: number, locale: 'en' | 'ar') => renderMail('trial-locking-soon', locale, { daysLeft: n, subscribeLink: SUBSCRIBE, exportLink: EXPORT });
    expect(ending(3, 'en').subject).toBe('Your MTB3A free trial ends within 3 days');
    expect(ending(1, 'en').subject).toBe('Your MTB3A free trial ends within 1 day');
    expect(locking(2, 'en').subject).toBe('Your MTB3A account locks within 2 days');
    expect(ending(1, 'ar').subject).toContain('خلال يوم واحد');
    expect(ending(2, 'ar').subject).toContain('خلال يومين');
    expect(ending(3, 'ar').subject).toContain('خلال 3 أيام');
    expect(locking(3, 'ar').subject).toContain('خلال 3 أيام');
  });

  it("MUT-419: send each trial mail's actions to the portal: Add a card / Subscribe, and Download my records after the trial", () => {
    const ending = renderMail('trial-ending-soon', 'en', SAMPLE['trial-ending-soon']);
    expect(ending.html).toContain(`href="${SUBSCRIBE.replace(/&/g, '&amp;')}"`);
    expect(ending.text).toContain('Add a card:');
    expect(ending.html).not.toContain('yourData');
    for (const id of ['trial-ended', 'trial-locking-soon'] as const) {
      for (const locale of ['en', 'ar'] as const) {
        const mail = renderMail(id, locale, SAMPLE[id] as never);
        expect(mail.text).toContain(SUBSCRIBE);
        expect(mail.text).toContain(EXPORT);
      }
    }
    expect(renderMail('trial-ended', 'ar', SAMPLE['trial-ended']).text).toContain('نزّل سجلاتي');
    expect(renderMail('trial-ended', 'en', SAMPLE['trial-ended']).subject).toBe('Your MTB3A account is read-only');
  });
});

describe('the launch offer in mail (MUT-525 DD7, DD8, DD12d)', () => {
  const TRIAL_IDS = ['trial-ending-soon', 'trial-ended', 'trial-locking-soon'] as const;
  const withOffer = <T extends (typeof TRIAL_IDS)[number]>(id: T) => ({ ...SAMPLE[id], offer: OFFER }) as TemplateVars[T];

  it.each(TRIAL_IDS)('%s: with no offer, renders exactly as before (R3)', (id) => {
    for (const locale of LOCALES) {
      expect(renderMail(id, locale, { ...SAMPLE[id], offer: null } as never, FRAME)).toEqual(renderMail(id, locale, SAMPLE[id] as never, FRAME));
    }
  });

  it.each(TRIAL_IDS)('%s: the offer is the last intro line, the action asks for it, subject and preview stay', (id) => {
    const en = renderMail(id, 'en', withOffer(id), FRAME);
    const ar = renderMail(id, 'ar', withOffer(id), FRAME);
    const enLine = `Launch offer: 50% off your first year on a yearly plan, until ${mailDay(OFFER.endsOn, 'en')}.`;
    const arLine = `عرض الإطلاق: خصم 50% على سنتك الأولى في الاشتراك السنوي، حتى ${mailDay(OFFER.endsOn, 'ar')}.`;
    expect(en.text).toContain(`${enLine}\n\nGet 50% off a year:\n${SUBSCRIBE}`);
    expect(ar.text).toContain(`${arLine}\n\nاحصل على خصم 50%:\n${SUBSCRIBE}`);
    expect(en.subject).toBe(renderMail(id, 'en', SAMPLE[id] as never).subject);
    expect(ar.subject).toBe(renderMail(id, 'ar', SAMPLE[id] as never).subject);
    // No amount anywhere in a trial mail: percent and day only (D8).
    for (const mail of [en, ar]) expect(mail.text).not.toMatch(CURRENCY);
  });

  it('the renewal notice: its day, the new yearly price plus VAT, Manage billing and how to cancel (DD8)', () => {
    const vars = SAMPLE['offer-renewing-soon'];
    const en = renderMail('offer-renewing-soon', 'en', vars, FRAME);
    const ar = renderMail('offer-renewing-soon', 'ar', vars, FRAME);
    expect(en.text).toContain('Your first year ends on November 12, 2027');
    expect(en.text).toContain('Renews on: November 12, 2027');
    expect(en.text).toContain('New price: ₪290 a year, plus VAT where it applies');
    expect(en.text).toContain(`Manage billing:\n${vars.manageLink}`);
    expect(en.text).toContain("Don't want to renew? Cancel any time before November 12, 2027 from Manage billing. You keep the year you paid for.");
    expect(en.html).toContain('data-details');
    expect(ar.text).toContain('السعر الجديد:');
    expect(ar.text).toContain('₪290');
    expect(ar.text).toContain('إدارة الدفع');
    expect(ar.html).toContain('dir="rtl"');
  });
});

/**
 * MUT-468 (plan §5, regression contract R2/D3): the frame. The rules above stay unchanged; with no art origin they
 * also prove the images-off render. These add the pictures, the headline and preview line, the footer, contrast and
 * size, and pin every subject to today's wording.
 */
const ART_ORIGIN = 'https://app.example.test';
const WEBSITE = 'https://site.example.test';
const RECIPIENT = 'person@example.test';
const FRAME = { to: RECIPIENT, artOrigin: ART_ORIGIN, websiteOrigin: WEBSITE };
const CUSTOMER_IDS = TEMPLATE_IDS.filter((id): id is CustomerTemplateId => id !== 'review-digest');
const ART_URLS = ART_FILES.map((file) => `${ART_ORIGIN}${MAIL_ART_PATH}${file}`);
const LOCALES = ['en', 'ar'] as const;
/** Today's subjects (captured before the rewrite); the frame must not change a word. */
const SUBJECTS: Record<CustomerTemplateId, Record<'en' | 'ar', string>> = {
  'finish-signup': { en: 'Finish creating your MTB3A account', ar: 'أكمل إنشاء حسابك في متابعة' },
  'account-exists': { en: 'You already have an MTB3A account', ar: 'لديك حساب في متابعة بالفعل' },
  'reset-password': { en: 'Set a new MTB3A password', ar: 'عيّن كلمة مرور جديدة لحسابك في متابعة' },
  'finish-setup': { en: 'Finish setting up your MTB3A account', ar: 'أكمل إعداد حسابك في متابعة' },
  'password-changed': { en: 'Your MTB3A password was changed', ar: 'تم تغيير كلمة مرور حسابك في متابعة' },
  'account-under-review': { en: "We're reviewing your MTB3A account", ar: 'نراجع حسابك في متابعة' },
  'account-ready': { en: 'Your MTB3A account is ready', ar: 'حسابك في متابعة جاهز' },
  'account-declined': { en: 'About your MTB3A account request', ar: 'بخصوص طلب حسابك في متابعة' },
  'trial-ending-soon': { en: 'Your MTB3A free trial ends within 3 days', ar: 'تنتهي تجربتك المجانية في متابعة خلال 3 أيام' },
  'trial-ended': { en: 'Your MTB3A account is read-only', ar: 'حسابك في متابعة للقراءة فقط' },
  'trial-locking-soon': { en: 'Your MTB3A account locks within 2 days', ar: 'يُقفَل حسابك في متابعة خلال يومين' },
  'account-closing': { en: 'Your MTB3A account will be deleted on November 23, 2026', ar: 'سيُحذف حسابك في متابعة بتاريخ 23 تشرين الثاني 2026' },
  'passkey-added': { en: 'A passkey was added to your MTB3A account', ar: 'أُضيف مفتاح مرور إلى حسابك في متابعة' },
  'offer-renewing-soon': { en: 'Your MTB3A first year ends on November 12, 2027', ar: 'تنتهي سنتك الأولى في متابعة يوم 12 تشرين الثاني 2027' },
  'card-failed': { en: "Your card didn't go through", ar: 'لم تنجح عملية الدفع ببطاقتك' },
  'card-failed-reminder': { en: 'Your card still isn’t going through', ar: 'ما زالت عملية الدفع ببطاقتك لا تنجح' },
  'comeback-offer': { en: 'פרסומת: Come back to MTB3A for ₪9 your first month', ar: 'פרסומת: عُد إلى متابعة بـ \u2068₪9\u2069 لشهرك الأول' },
  'accountant-invite': { en: 'Basel Sader shared “Sader Studio” with you on MTB3A', ar: 'Basel Sader يشاركك ملف «Sader Studio» في متابعة' },
  'sign-in-code': { en: '482913 is your MTB3A sign-in code', ar: 'رمز تسجيل الدخول إلى متابعة: 482913' },
  'monthly-summary': { en: 'Your November in MTB3A', ar: 'تشرين الثاني في متابعة' },
  'two-factor-code': { en: '482913 is your MTB3A two-step code', ar: 'رمز التحقق بخطوتين في متابعة: 482913' },
  'two-factor-changed': { en: 'Two-step sign-in is on for your MTB3A account', ar: 'تم تفعيل التحقق بخطوتين لحسابك في متابعة' },
  'tax-authority-reconnect': { en: 'Your MTB3A connection to the Tax Authority ends within 6 days', ar: 'ينتهي ربط متابعة بسلطة الضرائب خلال 6 أيام' },
  'plan-change-scheduled': { en: 'Your MTB3A plan changes to Solo on December 15, 2026', ar: 'تتغيّر خطتك في متابعة إلى «مستقل» يوم 15 كانون الأول 2026' },
  'customer-setup': { en: 'Hadi Khatib set up “Café Nour” for you on MTB3A', ar: 'Hadi Khatib أعدّ لك «Café Nour» في متابعة' },
  'customer-setup-cancelled': { en: 'Your MTB3A setup link no longer works', ar: 'رابط إعداد حسابك في متابعة لم يعد يعمل' },
};
const tagsOf = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))].map((m) => m[0]);
const attrOf = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** WCAG relative luminance and contrast ratio, from #RRGGBB. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe.each(CUSTOMER_IDS)('MUT-468 frame: %s', (id) => {
  const vars = SAMPLE[id];
  const mails = LOCALES.map((locale) => ({ locale, mail: renderMail(id, locale, vars as never, FRAME) }));

  it("loads pictures only from the portal's served art folder, each one named in look.ts, with alt text and a size", () => {
    for (const { mail } of mails) {
      const imgs = tagsOf(mail.html, 'img');
      expect(imgs).toHaveLength(2); // the header art and the chip
      for (const img of imgs) {
        expect(ART_URLS).toContain(attrOf(img, 'src'));
        expect(attrOf(img, 'alt')?.trim()).toBeTruthy();
        expect(Number(attrOf(img, 'width'))).toBeGreaterThan(0);
        expect(Number(attrOf(img, 'height'))).toBeGreaterThan(0);
      }
      expect(mail.html).not.toMatch(/<style|<script|<link|url\(|background-image/i);
    }
  });

  it('links only to the links passed in, its pictures and the Privacy page in its own language', () => {
    for (const { locale, mail } of mails) {
      const privacy = `${WEBSITE}/privacy?lang=${locale}`;
      const hrefs = [...mail.html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
      const allowed = [...LINKS_OF(vars), ...('supportAddress' in vars ? [`mailto:${vars.supportAddress}`] : []), privacy];
      for (const href of hrefs) expect(allowed).toContain(href);
      expect(hrefs).toContain(privacy);
      const urls = [...mail.html.matchAll(/https?:\/\/[^\s"<]+/g)].map((m) => m[0].replace(/&amp;/g, '&'));
      for (const url of urls) expect([...LINKS_OF(vars), ...ART_URLS, privacy]).toContain(url);
    }
  });

  it('opens with a hidden preview line, then exactly one headline', () => {
    for (const { mail } of mails) {
      const preview = mail.html.indexOf('data-preheader');
      expect(preview).toBeGreaterThan(-1);
      expect(tagsOf(mail.html, 'h1')).toHaveLength(1);
      expect(preview).toBeLessThan(mail.html.indexOf('<h1'));
    }
  });

  it('names the recipient left-to-right and keeps the password line in the footer', () => {
    for (const { locale, mail } of mails) {
      expect(mail.html).toContain(`<bdi dir="ltr">${RECIPIENT}</bdi>`);
      expect(mail.html).toContain(locale === 'ar' ? 'تطلب منك متابعة كلمة المرور' : 'never asks for your password');
    }
  });

  it('keeps its subject word for word', () => {
    for (const { locale, mail } of mails) expect(mail.subject).toBe(SUBJECTS[id][locale]);
  });

  it('stays under 100 KB, so Gmail never clips it', () => {
    for (const { mail } of mails) expect(Buffer.byteLength(mail.html)).toBeLessThan(100_000);
  });
});

describe('MUT-468 frame', () => {
  it('keeps the first-password subject word for word', () => {
    const first = { first: true, signInLink: 'https://portal.example.test/' };
    expect(renderMail('password-changed', 'en', first, FRAME).subject).toBe('Your MTB3A password is set');
    expect(renderMail('password-changed', 'ar', first, FRAME).subject).toBe('تم تعيين كلمة مرور حسابك في متابعة');
  });

  it('faces directional art right to left in Arabic, and never in English', () => {
    for (const [id, file] of [['account-ready', 'mail-header-hello-milestone-firm'], ['account-closing', 'mail-header-goodbye-destructive-confirmation']] as const) {
      expect(renderMail(id, 'ar', SAMPLE[id] as never, FRAME).html).toContain(`${MAIL_ART_PATH}${file}-rtl-2x.png`);
      const en = renderMail(id, 'en', SAMPLE[id] as never, FRAME).html;
      expect(en).toContain(`${MAIL_ART_PATH}${file}-2x.png`);
      expect(en).not.toContain('-rtl-');
    }
    // Art without a direction has one file for both languages.
    expect(renderMail('finish-signup', 'ar', SAMPLE['finish-signup'], FRAME).html).toContain(`${MAIL_ART_PATH}mail-header-hello-spot-email-2x.png`);
  });

  it('keeps the operator digest plain: no pictures, no headline', () => {
    const digest = renderMail('review-digest', 'en', SAMPLE['review-digest'], FRAME).html;
    expect(digest).not.toContain('<img');
    expect(digest).not.toContain('<h1');
  });

  it('drops the Privacy link without a website origin, and every picture without an art origin', () => {
    const noSite = renderMail('finish-signup', 'en', SAMPLE['finish-signup'], { to: RECIPIENT, artOrigin: ART_ORIGIN }).html;
    expect(noSite).not.toContain('/privacy');
    const noArt = renderMail('finish-signup', 'en', SAMPLE['finish-signup'], { to: RECIPIENT, websiteOrigin: WEBSITE }).html;
    expect(noArt).not.toContain('<img');
    // The images-off render still has its headline, button and copyable link.
    expect(noArt).toContain('<h1');
    expect(noArt).toContain(`<bdi dir="ltr">${LINK}</bdi>`);
  });

  it('uses only the origin of an art origin given with a trailing slash', () => {
    const html = renderMail('finish-signup', 'en', SAMPLE['finish-signup'], { ...FRAME, artOrigin: `${ART_ORIGIN}/` }).html;
    expect(html).toContain(`src="${ART_ORIGIN}${MAIL_ART_PATH}`);
  });

  it('escapes a hostile recipient and passkey name in the footer and the details panel', () => {
    const mail = renderMail('passkey-added', 'en', { passkeyName: '<b>evil</b>', signInLink: 'https://portal.example.test/' }, { ...FRAME, to: 'a<script>@example.test' });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).not.toContain('<b>evil</b>');
    expect(mail.html).toContain('&lt;b&gt;evil&lt;/b&gt;');
  });

  it('shows the passkey name and the deletion day in a details panel and in the text part; no other mail has a panel', () => {
    const passkey = renderMail('passkey-added', 'en', SAMPLE['passkey-added'], FRAME);
    expect(passkey.html).toContain('data-details');
    expect(passkey.text).toContain('Passkey: iCloud Keychain');
    const closing = renderMail('account-closing', 'ar', SAMPLE['account-closing'], FRAME);
    expect(closing.html).toContain('data-details');
    expect(closing.text).toContain(`يوم الحذف: ${mailDay(SAMPLE['account-closing'].deleteOn, 'ar')}`);
    for (const id of CUSTOMER_IDS.filter((t) => t !== 'passkey-added' && t !== 'account-closing' && t !== 'offer-renewing-soon' && t !== 'comeback-offer' && t !== 'accountant-invite' && t !== 'monthly-summary' && t !== 'plan-change-scheduled')) {
      expect(renderMail(id, 'en', SAMPLE[id] as never, FRAME).html).not.toContain('data-details');
    }
  });

  it('puts the headline in the text part too', () => {
    expect(renderMail('account-ready', 'en', SAMPLE['account-ready'], FRAME).text).toContain('Your account is ready');
    expect(renderMail('account-ready', 'ar', SAMPLE['account-ready'], FRAME).text).toContain('حسابك جاهز');
  });

  it('reaches 7:1 (AAA) for every text colour on every background the layout puts it on', () => {
    expect(TEXT_PAIRS.length).toBeGreaterThan(0);
    for (const { fg, bg, where } of TEXT_PAIRS) expect(contrast(fg, bg), `${where}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(7);
  });

  it('never puts the secondary ink on a mood tint: the details panel is ink only', () => {
    const html = renderMail('passkey-added', 'en', SAMPLE['passkey-added'], FRAME).html;
    const panel = html.slice(html.indexOf('data-details'), html.indexOf('</table>', html.indexOf('data-details')));
    expect(panel).not.toContain(SECONDARY_INK);
  });
});

/** MUT-468 review fixes (specialist T1/T4, adversarial 3/4). */
describe('MUT-468 frame: review fixes', () => {
  /** The words a reader sees in the HTML: tags, comments and entities removed. */
  const visibleText = (html: string) => html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' ').replace(/&#?[a-z0-9]+;/gi, ' ');

  it.each(CUSTOMER_IDS)('%s: no amount, currency or date in the HTML-only text either (preview line, footer, alt text)', (id) => {
    const allowed = NUMERIC_VARS[id] ?? [];
    for (const locale of LOCALES) {
      const html = renderMail(id, locale, SAMPLE[id] as never, FRAME).html;
      let rest = visibleText(html).split('MTB3A').join('');
      for (const link of [...LINKS_OF(SAMPLE[id]), ...ART_URLS, `${WEBSITE}/privacy?lang=${locale}`]) rest = rest.split(link).join('');
      for (const n of allowed) rest = rest.split(n).join('');
      expect(rest).not.toMatch(CURRENCY);
      expect(rest).not.toMatch(/[\d٠-٩۰-۹]/u);
      // Alt text is read aloud and shown with images off; it is attribute text, so check it on its own.
      for (const img of tagsOf(html, 'img')) expect(attrOf(img, 'alt')).not.toMatch(/[\d٠-٩۰-۹]/u);
    }
  });

  it('keeps only the origin of an art or website origin given with a path or query, and refuses a non-http one', () => {
    const html = renderMail('finish-signup', 'en', SAMPLE['finish-signup'], { to: RECIPIENT, artOrigin: `${ART_ORIGIN}/x?a="b`, websiteOrigin: `${WEBSITE}/some/page` }).html;
    expect(html).toContain(`src="${ART_ORIGIN}${MAIL_ART_PATH}`);
    expect(html).not.toContain('?a=');
    expect(html).toContain(`href="${WEBSITE}/privacy?lang=en"`);
    expect(() => renderMail('finish-signup', 'en', SAMPLE['finish-signup'], { artOrigin: 'javascript:alert(1)' })).toThrow(/link/i);
  });

  it('isolates a details value so a Latin name reads correctly inside an Arabic mail', () => {
    const html = renderMail('passkey-added', 'ar', { passkeyName: 'YubiKey 5C (USB)', signInLink: 'https://portal.example.test/' }, FRAME).html;
    expect(html).toContain('<bdi>YubiKey 5C (USB)</bdi>');
  });

  it('holds the card at its width in Outlook desktop, which ignores max-width', () => {
    const html = renderMail('finish-signup', 'en', SAMPLE['finish-signup'], FRAME).html;
    expect(html).toContain('<!--[if mso]><table role="presentation" width="560" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->');
    expect(html.match(/<!--\[if mso\]>/g)?.length).toBe(html.match(/<!\[endif\]-->/g)?.length);
  });
});

/**
 * MUT-468 dark-mode fix (Basel's Apple Mail check, 2026-10-27): `color-scheme: light` alone is a preference, and Apple
 * Mail still repainted the mail dark around the opaque art. Every mail opts out with `light only`, in both metas and
 * inline on the body and the outer table; the `<html lang dir>` tag stays exactly as the contract above pins it.
 */
describe('MUT-468 frame: light only, in every client that honours it', () => {
  it.each(TEMPLATE_IDS)('%s opts out of dark-mode repainting', (id) => {
    for (const locale of LOCALES) {
      const html = renderMail(id, locale, SAMPLE[id] as never, FRAME).html;
      expect(html).toContain('<meta name="color-scheme" content="light only">');
      expect(html).toContain('<meta name="supported-color-schemes" content="light only">');
      expect(html).not.toContain('<meta name="color-scheme" content="light">');
      expect(tagsOf(html, 'body')[0]).toContain('color-scheme:light only');
      expect(tagsOf(html, 'table')[0]).toContain('color-scheme:light only');
      expect(html).toContain(`<html lang="${locale}" dir="${locale === 'ar' ? 'rtl' : 'ltr'}">`);
    }
  });
});

describe('monthly-summary (MUT-535, ADR-259)', () => {
  const vars = SAMPLE['monthly-summary'];
  const en = renderMail('monthly-summary', 'en', vars, FRAME);
  const ar = renderMail('monthly-summary', 'ar', vars, FRAME);

  it('shows each profile’s month per currency, never summed or converted, with its overview link', () => {
    expect(en.text).toContain('Sader Studio');
    expect(en.text).toContain('Came in during November: ₪12,400 · $900');
    expect(en.text).toContain('Still owed: ₪3,200 · $450.50');
    expect(en.text).toContain('Overdue: ₪1,100 · $200 (3 entries)');
    expect(en.text).toContain('Open Sader Studio: https://portal.example.test/p/0b7d4f2e-6a1c-4c8e-9f3a-2d5b7e9c1a40');
    expect(en.html).toContain('data-section');
    expect(en.text).toContain('as of December 1, 2026');
  });

  it('writes Arabic with Levantine months, every amount and name isolated', () => {
    expect(ar.subject).toBe('تشرين الثاني في متابعة');
    expect(ar.text).toContain('تشرين الثاني 2026 باختصار');
    expect(ar.text).toContain('المستلَم في تشرين الثاني: \u2068₪12,400\u2069 · \u2068$900\u2069');
    expect(ar.text).toContain('المتأخر: \u2068₪1,100\u2069 · \u2068$200\u2069 (3 قيود)');
    expect(ar.text).toContain('افتح \u2068Sader Studio\u2069');
    expect(ar.html).toContain('dir="rtl"');
  });

  it('names what is empty rather than leaving a row blank', () => {
    const empty = renderMail('monthly-summary', 'en', { ...vars, profiles: [{ ...vars.profiles[0]!, cameIn: [], overdue: [], overdueCount: 0 }] }, FRAME);
    expect(empty.text).toContain('Came in during November: Nothing recorded');
    expect(empty.text).toContain('Overdue: Nothing overdue');
    const arEmpty = renderMail('monthly-summary', 'ar', { ...vars, profiles: [{ ...vars.profiles[0]!, owed: [], overdue: [], overdueCount: 0 }] }, FRAME);
    expect(arEmpty.text).toContain('المتأخر: لا شيء متأخر');
  });

  it('carries the yearly line only when given one (MUT-531)', () => {
    expect(en.text).toContain('Switch to yearly and save ₪58 a year:');
    expect(ar.text).toContain('انتقل إلى الاشتراك السنوي ووفّر \u2068₪58\u2069 في السنة');
    const none = renderMail('monthly-summary', 'en', { ...vars, yearly: null }, FRAME);
    expect(none.text).not.toContain('yearly');
  });

  it('says how to turn it off, in the footer and the text part (AC3)', () => {
    expect(en.html).toContain('data-opt-out');
    expect(en.html).toContain('href="https://portal.example.test/mail-off#tok_ABC123def"');
    expect(en.text).toContain("Don't want this monthly email? Turn it off. You can turn it back on in You › Account.");
    expect(ar.text).toContain('لا تريد هذه الرسالة الشهرية؟ أوقفها. ويمكنك إعادتها من أنت › الحساب.');
  });

  it('counts entries in Arabic grammar', () => {
    const count = (n: number) => renderMail('monthly-summary', 'ar', { ...vars, profiles: [{ ...vars.profiles[0]!, overdueCount: n }] }, FRAME).text;
    expect(count(1)).toContain('(قيد واحد)');
    expect(count(2)).toContain('(قيدان)');
    expect(count(11)).toContain('(11 قيدًا)');
  });
});

describe('the come-back offer is an advertisement (Communications Law s.30A)', () => {
  const vars = SAMPLE['comeback-offer'];
  for (const stage of ['day-30', 'day-90'] as const) {
    for (const locale of ['en', 'ar'] as const) {
      it(`${stage} in ${locale}: «פרסומת» opens the subject, the sender's details are in both parts, and the unsubscribe stays`, () => {
        const mail = renderMail('comeback-offer', locale, { ...vars, stage }, FRAME);
        expect(mail.subject.startsWith('פרסומת: ')).toBe(true);
        for (const part of [mail.html, mail.text]) {
          expect(part).toContain('Narabnd Studio Ltd');
          expect(part).toContain('18');
          expect(part).toContain('info@mtb3a.com');
        }
        expect(mail.html).toContain('data-sender');
        expect(mail.html).toContain('data-opt-out');
        expect(mail.text).toContain('mail-off?mail=offers#tok_ABC123def');
      });
    }
  }

  it('no other mail carries a sender block or the advertisement label', () => {
    for (const id of CUSTOMER_IDS.filter((t) => t !== 'comeback-offer')) {
      const mail = renderMail(id, 'en', SAMPLE[id] as never, FRAME);
      expect(mail.subject).not.toContain('פרסומת');
      expect(mail.html).not.toContain('data-sender');
    }
  });
});
