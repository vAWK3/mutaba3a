import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS, type MailTemplateId, type TemplateVars } from '../ports.js';
import { renderMail } from '../templates/index.js';
import { mailDay } from '../templates/copy.js';
import { SECONDARY_INK, TEXT_PAIRS } from '../templates/layout.js';
import { ART_FILES, type CustomerTemplateId } from '../templates/look.js';

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
};
/** Numbers a template may print, from its own count vars; anything else numeric is a defect. */
const NUMERIC_VARS: Partial<Record<MailTemplateId, string[]>> = {
  'finish-signup': ['24'],
  'reset-password': ['1'],
  'finish-setup': ['72'],
  'review-digest': ['3'],
  'trial-ending-soon': ['3'],
  'trial-locking-soon': ['2'],
  // MUT-333 (ADR-188): the deletion day is the one date a mail may carry, in the mail's own language.
  'account-closing': [mailDay({ year: 2026, month: 11, day: 23 }, 'en'), mailDay({ year: 2026, month: 11, day: 23 }, 'ar')],
};
const LINKS_OF = (vars: object): string[] => Object.values(vars).filter((v): v is string => typeof v === 'string' && /^https?:\/\//.test(v));
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
const ART_URLS = ART_FILES.map((file) => `${ART_ORIGIN}/mail/v1/${file}`);
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
  'account-closing': { en: 'Your MTB3A account will be deleted on November 23, 2026', ar: 'سيُحذف حسابك في متابعة بتاريخ 23 نوفمبر 2026' },
  'passkey-added': { en: 'A passkey was added to your MTB3A account', ar: 'أُضيف مفتاح مرور إلى حسابك في متابعة' },
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

  it("loads pictures only from the portal's /mail/v1/, each one named in look.ts, with alt text and a size", () => {
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
      expect(renderMail(id, 'ar', SAMPLE[id] as never, FRAME).html).toContain(`/mail/v1/${file}-rtl-2x.png`);
      const en = renderMail(id, 'en', SAMPLE[id] as never, FRAME).html;
      expect(en).toContain(`/mail/v1/${file}-2x.png`);
      expect(en).not.toContain('-rtl-');
    }
    // Art without a direction has one file for both languages.
    expect(renderMail('finish-signup', 'ar', SAMPLE['finish-signup'], FRAME).html).toContain('/mail/v1/mail-header-hello-spot-email-2x.png');
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
    expect(html).toContain(`src="${ART_ORIGIN}/mail/v1/`);
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
    for (const id of CUSTOMER_IDS.filter((t) => t !== 'passkey-added' && t !== 'account-closing')) {
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
