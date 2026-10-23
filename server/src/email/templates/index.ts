import type { UserLocale } from '../../repositories/ports.js';
import type { MailTemplateId, RenderedMail, TemplateVars } from '../ports.js';
import { COPY } from './copy.js';
import { renderLayout } from './layout.js';

/** `(id, locale, vars) → { subject, text, html }`. Throws only on a caller bug (a link that isn't http(s)). */
export function renderMail<T extends MailTemplateId>(template: T, locale: UserLocale, vars: TemplateVars[T]): RenderedMail {
  const copy = COPY[template] as Record<UserLocale, (v: TemplateVars[T]) => Parameters<typeof renderLayout>[1]>;
  return renderLayout(locale, copy[locale](vars));
}

export { BRAND_NAME } from './layout.js';
