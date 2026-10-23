import type { UserLocale } from '../../repositories/ports.js';
import type { RenderedMail } from '../ports.js';

/**
 * The one frame every mail is drawn in (brief §8.4): one language per mail, `<html lang dir>`, inline styles only,
 * system fonts, Brand v2's AAA light inks (src/styles/brand/mutaba3a-theme.css, as hex because mail clients drop
 * custom properties), no images and nothing fetched. A link is a button plus its raw URL in `<bdi dir="ltr">` for
 * copying (ADR-101). Every interpolated value is escaped here, so a template never writes raw HTML.
 */
const INK = '#392F4B';
const INK_2 = '#564E68';
const LINK = '#4D387E';
const SURFACE = '#FFFCF7';
const CANVAS = '#FCF6ED';
const LINE = '#E6E2ED';
const ON_LINK = '#FFFFFF';
const FONTS: Record<UserLocale, string> = {
  ar: "-apple-system, 'Segoe UI', Tahoma, 'Geeza Pro', 'Noto Naskh Arabic', Arial, sans-serif",
  en: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};
/** MUT-400: the product's name in each language. */
export const BRAND_NAME: Record<UserLocale, string> = { en: 'MTB3A', ar: 'متابعة' };

/** A piece of a paragraph: plain text, or a value that reads left-to-right inside any language (an address, a command). */
export type Inline = string | { ltr: string } | { mailto: string };

export interface MailBody {
  subject: string;
  /** Paragraphs before the button. */
  intro: Inline[][];
  action?: { label: string; href: string };
  /** A second, quieter link under the button. */
  secondary?: { label: string; href: string };
  /** Paragraphs after the button (what to do if this wasn't you). */
  outro?: Inline[][];
}

const COPY_HINT: Record<UserLocale, string> = {
  en: "If the button doesn't work, copy this link into your browser:",
  ar: 'إذا لم يعمل الزر، انسخ هذا الرابط إلى متصفحك:',
};
const FOOTER: Record<UserLocale, string> = {
  en: 'You received this email because of an action on your MTB3A account. MTB3A never asks for your password by email.',
  ar: 'وصلتك هذه الرسالة بسبب إجراء على حسابك في متابعة. لن تطلب منك متابعة كلمة المرور عبر البريد الإلكتروني أبدًا.',
};

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only http(s) links reach a mail; anything else is a caller bug. */
function checkedHref(href: string): string {
  if (!/^https?:\/\/[^\s]+$/.test(href)) throw new Error(`mail link must be an absolute http(s) URL, got ${JSON.stringify(href.slice(0, 40))}`);
  return href;
}

function inlineHtml(part: Inline): string {
  if (typeof part === 'string') return escapeHtml(part);
  if ('ltr' in part) return `<bdi dir="ltr">${escapeHtml(part.ltr)}</bdi>`;
  return `<a href="mailto:${escapeHtml(part.mailto)}" style="color:${LINK};"><bdi dir="ltr">${escapeHtml(part.mailto)}</bdi></a>`;
}

function inlineText(part: Inline): string {
  if (typeof part === 'string') return part;
  return 'ltr' in part ? part.ltr : part.mailto;
}

const paragraphHtml = (parts: Inline[], color = INK) => `<p style="margin:0 0 16px;color:${color};">${parts.map(inlineHtml).join('')}</p>`;

export function renderLayout(locale: UserLocale, body: MailBody): RenderedMail {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  const action = body.action ? { label: body.action.label, href: checkedHref(body.action.href) } : null;
  const secondary = body.secondary ? { label: body.secondary.label, href: checkedHref(body.secondary.href) } : null;

  const html = [
    '<!doctype html>',
    `<html lang="${locale}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(body.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS};">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CANVAS};"><tr><td align="center" style="padding:24px 16px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:${SURFACE};border:1px solid ${LINE};border-radius:12px;">`,
    `<tr><td dir="${dir}" style="padding:32px 28px;font-family:${FONTS[locale]};font-size:16px;line-height:1.6;color:${INK};text-align:${align};">`,
    `<p style="margin:0 0 24px;font-size:18px;font-weight:700;color:${INK};">${escapeHtml(BRAND_NAME[locale])}</p>`,
    ...body.intro.map((p) => paragraphHtml(p)),
    ...(action
      ? [
          `<p style="margin:24px 0;"><a href="${escapeHtml(action.href)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:${LINK};color:${ON_LINK};font-weight:700;text-decoration:none;">${escapeHtml(action.label)}</a></p>`,
          `<p style="margin:0 0 16px;font-size:14px;color:${INK_2};">${escapeHtml(COPY_HINT[locale])}<br><bdi dir="ltr">${escapeHtml(action.href)}</bdi></p>`,
        ]
      : []),
    ...(secondary
      ? [`<p style="margin:0 0 16px;font-size:14px;color:${INK_2};"><a href="${escapeHtml(secondary.href)}" style="color:${LINK};">${escapeHtml(secondary.label)}</a><br><bdi dir="ltr">${escapeHtml(secondary.href)}</bdi></p>`]
      : []),
    ...(body.outro ?? []).map((p) => paragraphHtml(p, INK_2)),
    `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${LINE};font-size:13px;color:${INK_2};">${escapeHtml(FOOTER[locale])}</p>`,
    '</td></tr></table>',
    '</td></tr></table>',
    '</body></html>',
  ].join('\n');

  const text = [
    BRAND_NAME[locale],
    '',
    ...body.intro.map((p) => p.map(inlineText).join('')).flatMap((p) => [p, '']),
    ...(action ? [`${action.label}:`, action.href, ''] : []),
    ...(secondary ? [`${secondary.label}:`, secondary.href, ''] : []),
    ...(body.outro ?? []).map((p) => p.map(inlineText).join('')).flatMap((p) => [p, '']),
    '--',
    FOOTER[locale],
  ].join('\n');

  return { subject: body.subject, text, html };
}
