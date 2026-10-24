import { describe, expect, it } from 'vitest';
import { TEMPLATE_IDS, type MailTemplateId, type TemplateVars } from '../ports.js';
import { renderMail } from '../templates/index.js';
import { mailDay } from '../templates/copy.js';

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
  'review-digest': { pending: 3, command: 'npm --prefix server run signups:review' },
  'trial-ending-soon': { daysLeft: 3, subscribeLink: SUBSCRIBE },
  'trial-ended': { subscribeLink: SUBSCRIBE, exportLink: EXPORT },
  'trial-locking-soon': { daysLeft: 2, subscribeLink: SUBSCRIBE, exportLink: EXPORT },
  'account-closing': { deleteOn: { year: 2026, month: 11, day: 23 }, signInLink: 'https://portal.example.test/sign-in' },
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
