import { describe, it, expect } from 'vitest';
import en from '../../../lib/i18n/translations/en.json';
import ar from '../../../lib/i18n/translations/ar.json';

/** Every leaf under `node`, as dotted key → string. */
function leaves(node: unknown, prefix = ''): Record<string, string> {
  if (typeof node === 'string') return { [prefix]: node };
  return Object.entries(node as Record<string, unknown>).reduce<Record<string, string>>(
    (acc, [key, value]) => ({ ...acc, ...leaves(value, prefix ? `${prefix}.${key}` : key) }),
    {},
  );
}

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('/hosted copy (MUT-186)', () => {
  const enKeys = leaves(en.landing.hostedOffer);
  const arKeys = leaves(ar.landing.hostedOffer);

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

  it('promises a reply within 2 working days before and after sending (4A)', () => {
    expect(en.landing.hostedOffer.form.lead).toContain('2 working days');
    expect(en.landing.hostedOffer.success.body).toContain('2 working days');
    expect(ar.landing.hostedOffer.form.lead).toContain('يومَي عمل');
    expect(ar.landing.hostedOffer.success.body).toContain('يومَي عمل');
  });
});
