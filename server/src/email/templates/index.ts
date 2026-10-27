import type { UserLocale } from '../../repositories/ports.js';
import type { MailTemplateId, RenderedMail, TemplateVars } from '../ports.js';
import { COPY } from './copy.js';
import { renderLayout, type MailBody, type MailFrame } from './layout.js';
import { isCustomerTemplate, LOOK } from './look.js';

/**
 * `(id, locale, vars, frame) → { subject, text, html }`. Throws only on a caller bug (a link that isn't http(s)).
 * MUT-468: the frame is what the mailer adds (the recipient, the art and website origins); without it the mail renders
 * with no pictures and no Privacy link.
 */
export function renderMail<T extends MailTemplateId>(template: T, locale: UserLocale, vars: TemplateVars[T], frame: MailFrame = {}): RenderedMail {
  const copy = COPY[template] as Record<UserLocale, (v: TemplateVars[T]) => MailBody>;
  return renderLayout(locale, copy[locale](vars), isCustomerTemplate(template) ? LOOK[template] : undefined, frame);
}

export { BRAND_NAME } from './layout.js';
export type { MailFrame } from './layout.js';
