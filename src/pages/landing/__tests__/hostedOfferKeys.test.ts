import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/translations/en';
import ar from '../../../lib/i18n/translations/ar';

/** Every leaf under `node`, as dotted key → string. */
function leaves(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('request-account copy', () => {
  const enKeys = leaves(en.landing.requestAccount);
  const arKeys = leaves(ar.landing.requestAccount);

  it('has the same keys in English and Arabic', () => {
    expect(Object.keys(arKeys).sort()).toEqual(Object.keys(enKeys).sort());
  });

  it.each(Object.keys(enKeys))('%s is filled in both languages with the same placeholders', (key) => {
    expect(enKeys[key].trim()).not.toBe('');
    expect(arKeys[key]?.trim()).not.toBe('');
    expect(placeholders(arKeys[key] ?? '')).toEqual(placeholders(enKeys[key]));
  });

  it('adds the request-form section to the privacy policy in both languages', () => {
    for (const dict of [en, ar]) {
      expect(dict.landing.privacyPolicy.hostedRequest.title.trim()).not.toBe('');
      expect(dict.landing.privacyPolicy.hostedRequest.body).toContain('Netlify');
    }
  });

  it('adds the signup and email sections to the privacy policy in both languages, with the same keys (MUT-369)', () => {
    expect(Object.keys(leaves(ar.landing.privacyPolicy)).sort()).toEqual(Object.keys(leaves(en.landing.privacyPolicy)).sort());
    for (const dict of [en, ar]) {
      expect(dict.landing.privacyPolicy.createAccount.body).toContain('Cloudflare Turnstile');
      expect(dict.landing.privacyPolicy.createAccount.body).toContain('RDAP');
      expect(dict.landing.privacyPolicy.email.body).toContain('Resend');
    }
  });

  it('keeps the request form while signup is open, and names it for those who want help (MUT-369, D6)', () => {
    for (const dict of [en, ar]) {
      for (const key of ['ctaCreate', 'altNoteOpen'] as const) expect(dict.landing.hero[key].trim()).not.toBe('');
      for (const key of ['createCta', 'noteOpen', 'requestCtaOpen'] as const) expect(dict.landing.getIt[key].trim()).not.toBe('');
      expect(dict.landing.phone.hintLinkOpen.trim()).not.toBe('');
      expect(dict.landing.faq.a1Open.trim()).not.toBe('');
    }
  });

  it('promises a reply within 2 working days before and after sending (4A)', () => {
    expect(en.landing.requestAccount.form.lead).toContain('2 working days');
    expect(en.landing.requestAccount.success.body).toContain('2 working days');
    expect(ar.landing.requestAccount.form.lead).toContain('يومَي عمل');
    expect(ar.landing.requestAccount.success.body).toContain('يومَي عمل');
  });
});
