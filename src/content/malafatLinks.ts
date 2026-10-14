/**
 * Every link from Mutaba3a to Malafat (MUT-174, epic MUT-189). Attribution travels
 * in the link and is counted on malafat.app (MAL-1153), so Mutaba3a itself measures
 * nothing (ADR-024). The two unions are MUT-189's CTA contract, plus the landing
 * band's own `landing` / `landing-section` (recorded on MUT-189).
 */

export const MALAFAT_SITE_URL = 'https://malafat.app';

export type MalafatLocale = 'en' | 'ar';
export type MalafatMedium = 'web-local' | 'desktop' | 'portal' | 'ios' | 'android' | 'landing';
export type MalafatContent = 'settings' | 'business-profile' | 'client-threshold' | 'second-business' | 'landing-section';

interface MalafatLinkOptions {
  locale: MalafatLocale;
  medium: MalafatMedium;
  content: MalafatContent;
  /** The in-app moments send a known firm to the contact page with the Mutaba3a topic prefilled. */
  contact?: boolean;
}

/** `https://malafat.app/<locale>[/contact]?[topic=mutaba3a&]utm_source=…&utm_medium=…&utm_campaign=…&utm_content=…` */
export function malafatUrl({ locale, medium, content, contact = false }: MalafatLinkOptions): string {
  const query = new URLSearchParams();
  if (contact) query.set('topic', 'mutaba3a');
  query.set('utm_source', 'mutaba3a');
  query.set('utm_medium', medium);
  query.set('utm_campaign', 'malafat-upsell');
  query.set('utm_content', content);
  return `${MALAFAT_SITE_URL}/${locale}${contact ? '/contact' : ''}?${query}`;
}
