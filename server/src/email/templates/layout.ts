import type { UserLocale } from '../../repositories/ports.js';
import type { RenderedMail } from '../ports.js';
import { artFor, MAIL_ART_PATH, MOODS, type Look } from './look.js';

/**
 * The one frame every mail is drawn in (brief §8.4; MUT-468 frame 1b "full-bleed"): one language per mail,
 * `<html lang dir>`, tables and inline styles only, system fonts, Brand v2's AAA light inks (src/styles/brand/
 * mutaba3a-theme.css, as hex because mail clients drop custom properties). A customer mail's mood tints a band that
 * runs edge to edge behind the wordmark and header art; the white card rises out of it with the chip and headline.
 * Pictures come only from `<artOrigin>/mail/v1/` (static, the same URL for everyone, ADR override of §8.4) and every
 * one has alt text, so a mail with images off still reads fully. A link is a button plus its raw URL in
 * `<bdi dir="ltr">` for copying (ADR-101). Every interpolated value is escaped here, so a template never writes raw HTML.
 */
const INK = '#392F4B';
/** Only ever on the white surface or the canvas: it misses 7:1 on the mood tints (MUT-468 plan §5 test 6). */
export const SECONDARY_INK = '#564E68';
const LINK = '#4D387E';
const SURFACE = '#FFFCF7';
const CANVAS = '#FCF6ED';
const LINE = '#E6E2ED';
const ON_LINK = '#FFFFFF';
/** The brand's amber dot beside the wordmark and in the footer divider; decoration, never text. */
const NUQTA = '#E89960';
const FONTS: Record<UserLocale, string> = {
  ar: "-apple-system, 'Segoe UI', Tahoma, 'Geeza Pro', 'Noto Naskh Arabic', Arial, sans-serif",
  en: "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
};
/** The header art is drawn at a fixed 150 px (plan D6: no media queries), from its 320 px file. */
const HEADER_PX = 150;
/** The chip at half its 80 px @2x file. */
const CHIP_PX = 40;
const CARD_MAX_PX = 560;
/** Outlook desktop ignores max-width; these conditional comments hold the card at CARD_MAX_PX there. */
const MSO_OPEN = `<!--[if mso]><table role="presentation" width="${CARD_MAX_PX}" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->`;
const MSO_CLOSE = '<!--[if mso]></td></tr></table><![endif]-->';

/** Every text colour the frame puts on a background, for the contrast test. */
export const TEXT_PAIRS: ReadonlyArray<{ fg: string; bg: string; where: string }> = [
  { fg: INK, bg: SURFACE, where: 'card text' },
  { fg: SECONDARY_INK, bg: SURFACE, where: 'card hint, note' },
  { fg: LINK, bg: SURFACE, where: 'card links' },
  { fg: ON_LINK, bg: LINK, where: 'button label' },
  { fg: INK, bg: CANVAS, where: 'wordmark and footer line (plain mail)' },
  { fg: SECONDARY_INK, bg: CANVAS, where: 'footer' },
  { fg: LINK, bg: CANVAS, where: 'footer Privacy link' },
  ...Object.entries(MOODS).flatMap(([mood, { band, panel }]) => [
    { fg: INK, bg: band, where: `${mood} band wordmark` },
    { fg: INK, bg: panel, where: `${mood} details panel` },
  ]),
];

/** MUT-400: the product's name in each language. */
export const BRAND_NAME: Record<UserLocale, string> = { en: 'MTB3A', ar: 'متابعة' };

/** A piece of a paragraph: plain text, or a value that reads left-to-right inside any language (an address, a command). */
export type Inline = string | { ltr: string } | { mailto: string };

export interface MailBody {
  subject: string;
  /** MUT-468: the inbox preview line, hidden in the mail. Customer mails only. */
  preheader?: string;
  /** MUT-468: the headline under the chip. Customer mails only. */
  headline?: string;
  /** Paragraphs before the button. */
  intro: Inline[][];
  /**
   * MUT-468: label/value rows in a tinted panel (the passkey's name, the deletion day), also in the text part. Values
   * are plain text, isolated in a `<bdi>` so a name in either script reads right inside the other (no links on a tint).
   */
  details?: { label: string; value: string }[];
  action?: { label: string; href: string };
  /** A second, quieter link under the button. */
  secondary?: { label: string; href: string };
  /** The note under a rule after the button (what to do if this wasn't you). */
  outro?: Inline[][];
}

/** MUT-468 (F3): a customer mail always has its preview line and headline. */
export interface CustomerMailBody extends MailBody {
  preheader: string;
  headline: string;
}

/** What the mailer adds around a template's words: the recipient, and where the pictures and the website are. */
export interface MailFrame {
  to?: string | undefined;
  /** PORTAL_ORIGIN: the pictures are served from `<artOrigin>/mail/v1/`. Unset = no pictures. */
  artOrigin?: string | undefined;
  /** WEBSITE_ORIGIN: the footer's Privacy link. Unset = no Privacy link. */
  websiteOrigin?: string | undefined;
}

const COPY_HINT: Record<UserLocale, string> = {
  en: "If the button doesn't work, copy this link into your browser:",
  ar: 'إذا لم يعمل الزر، انسخ هذا الرابط إلى متصفحك:',
};
const FOOTER: Record<UserLocale, string> = {
  en: 'You received this email because of an action on your MTB3A account. MTB3A never asks for your password by email.',
  ar: 'وصلتك هذه الرسالة بسبب إجراء على حسابك في متابعة. لن تطلب منك متابعة كلمة المرور عبر البريد الإلكتروني أبدًا.',
};
const SAFE: Record<UserLocale, string> = {
  en: 'MTB3A never asks for your password by email.',
  ar: 'لن تطلب منك متابعة كلمة المرور عبر البريد الإلكتروني أبدًا.',
};
const SERVICE: Record<UserLocale, string> = {
  en: 'This is a service email about your MTB3A account',
  ar: 'هذه رسالة خدمة تخص حسابك في متابعة',
};
const SENT_TO: Record<UserLocale, string> = { en: ', sent to ', ar: '، أُرسلت إلى ' };
const PRIVACY: Record<UserLocale, string> = { en: 'Privacy', ar: 'الخصوصية' };

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Only http(s) links reach a mail; anything else is a caller bug. */
function checkedHref(href: string): string {
  if (!/^https?:\/\/[^\s]+$/.test(href)) throw new Error(`mail link must be an absolute http(s) URL, got ${JSON.stringify(href.slice(0, 40))}`);
  return href;
}

/** An origin from config, without any path or trailing slash. */
const originOf = (value: string): string => new URL(checkedHref(value)).origin;

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

const img = (src: string, alt: string, px: number, margin: string) =>
  `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" width="${px}" height="${px}" style="display:block;margin:${margin};border:0;width:${px}px;height:${px}px;">`;

/** The wordmark: the product's name and the amber dot. */
function wordmark(locale: UserLocale): string {
  return [
    '<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0"><tr>',
    `<td style="font-size:20px;line-height:24px;font-weight:700;color:${INK};">${escapeHtml(BRAND_NAME[locale])}</td>`,
    '<td width="6" style="width:6px;"></td>',
    `<td valign="middle"><div style="width:8px;height:8px;border-radius:4px;background:${NUQTA};font-size:0;line-height:0;"></div></td>`,
    '</tr></table>',
  ].join('');
}

/** The band (tinted for a customer mail, canvas for the digest): wordmark, header art, then the card's top with chip and headline. */
function top(locale: UserLocale, body: MailBody, look: Look | undefined, artOrigin: string | undefined): string {
  const band = look ? MOODS[look.mood].band : CANVAS;
  const art = look && artOrigin ? artFor(look, locale) : null;
  const artUrl = (file: string) => `${artOrigin}${MAIL_ART_PATH}${file}`;
  return [
    `<tr><td align="center" bgcolor="${band}" style="background:${band};padding:32px 16px 0;">`,
    MSO_OPEN,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${CARD_MAX_PX}px;">`,
    `<tr><td align="center" style="padding-bottom:16px;">${wordmark(locale)}</td></tr>`,
    ...(art ? [`<tr><td align="center" style="padding-bottom:8px;">${img(artUrl(art.header.file), art.header.alt, HEADER_PX, '0 auto')}</td></tr>`] : []),
    ...(body.headline
      ? [
          `<tr><td align="center" bgcolor="${SURFACE}" style="background:${SURFACE};border:1px solid ${LINE};border-bottom:0;border-radius:16px 16px 0 0;padding:36px 32px 4px;">`,
          ...(art ? [img(artUrl(art.chip.file), art.chip.alt, CHIP_PX, '0 auto 14px')] : []),
          `<h1 style="margin:0;font-size:24px;line-height:1.3;font-weight:700;color:${INK};text-align:center;">${escapeHtml(body.headline)}</h1>`,
          '</td></tr>',
        ]
      : []),
    '</table>',
    MSO_CLOSE,
    '</td></tr>',
  ].join('\n');
}

function details(rows: NonNullable<MailBody['details']>, look: Look | undefined, align: string): string {
  const panel = look ? MOODS[look.mood].panel : CANVAS;
  const cell = (content: string, weight: number) =>
    `<td valign="top" style="padding:8px 16px;font-size:14px;line-height:1.5;font-weight:${weight};color:${INK};text-align:${align};">${content}</td>`;
  return [
    `<table data-details role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${panel}" style="background:${panel};border-radius:12px;margin:4px 0 24px;">`,
    ...rows.map((row) => `<tr>${cell(escapeHtml(row.label), 700)}${cell(`<bdi>${escapeHtml(row.value)}</bdi>`, 400)}</tr>`),
    '</table>',
  ].join('');
}

function footer(locale: UserLocale, frame: MailFrame): string {
  const service = frame.to ? `${escapeHtml(SERVICE[locale])}${SENT_TO[locale]}<bdi dir="ltr">${escapeHtml(frame.to)}</bdi>.` : `${escapeHtml(SERVICE[locale])}.`;
  const privacy = frame.websiteOrigin ? `${originOf(frame.websiteOrigin)}/privacy?lang=${locale}` : null;
  return [
    '<tr><td align="center" style="padding:28px 24px 0;text-align:center;">',
    `<table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 12px;"><tr><td><div style="width:6px;height:6px;border-radius:3px;background:${NUQTA};font-size:0;line-height:0;"></div></td></tr></table>`,
    `<p style="margin:0 0 8px;font-size:14px;line-height:1.55;font-weight:700;color:${INK};">${escapeHtml(SAFE[locale])}</p>`,
    `<p style="margin:0 0 8px;font-size:13px;line-height:1.6;color:${SECONDARY_INK};">${service}</p>`,
    ...(privacy ? [`<p style="margin:0;font-size:13px;line-height:1.6;"><a href="${escapeHtml(privacy)}" style="color:${LINK};">${escapeHtml(PRIVACY[locale])}</a></p>`] : []),
    '</td></tr>',
  ].join('\n');
}

export function renderLayout(locale: UserLocale, body: MailBody, look?: Look, frame: MailFrame = {}): RenderedMail {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const align = locale === 'ar' ? 'right' : 'left';
  const action = body.action ? { label: body.action.label, href: checkedHref(body.action.href) } : null;
  const secondary = body.secondary ? { label: body.secondary.label, href: checkedHref(body.secondary.href) } : null;
  const artOrigin = frame.artOrigin ? originOf(frame.artOrigin) : undefined;
  const cardTop = body.headline ? 'border-top:0;border-radius:0 0 16px 16px;padding:20px 32px 32px' : 'border-radius:16px;padding:32px';

  const html = [
    '<!doctype html>',
    `<html lang="${locale}" dir="${dir}">`,
    '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light">',
    `<title>${escapeHtml(body.subject)}</title></head>`,
    `<body style="margin:0;padding:0;background:${CANVAS};">`,
    ...(body.preheader
      ? [`<div data-preheader style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${CANVAS};opacity:0;">${escapeHtml(body.preheader)}${'&#847;&zwnj;&nbsp;'.repeat(40)}</div>`]
      : []),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${dir}" style="background:${CANVAS};font-family:${FONTS[locale]};color:${INK};">`,
    top(locale, body, look, artOrigin),
    `<tr><td align="center" style="padding:0 16px 32px;">`,
    MSO_OPEN,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:${CARD_MAX_PX}px;">`,
    `<tr><td dir="${dir}" bgcolor="${SURFACE}" style="background:${SURFACE};border:1px solid ${LINE};${cardTop};font-size:16px;line-height:1.6;color:${INK};text-align:${align};">`,
    ...body.intro.map((p) => paragraphHtml(p)),
    ...(body.details && body.details.length > 0 ? [details(body.details, look, align)] : []),
    ...(action
      ? [
          `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px;"><tr><td align="center" bgcolor="${LINK}" style="background:${LINK};border-radius:10px;"><a href="${escapeHtml(action.href)}" style="display:inline-block;padding:14px 28px;font-size:16px;line-height:20px;font-weight:700;color:${ON_LINK};text-decoration:none;">${escapeHtml(action.label)}</a></td></tr></table>`,
          `<p style="margin:0 0 16px;font-size:14px;color:${SECONDARY_INK};">${escapeHtml(COPY_HINT[locale])}<br><bdi dir="ltr">${escapeHtml(action.href)}</bdi></p>`,
        ]
      : []),
    ...(secondary
      ? [`<p style="margin:0 0 16px;font-size:14px;color:${SECONDARY_INK};"><a href="${escapeHtml(secondary.href)}" style="color:${LINK};">${escapeHtml(secondary.label)}</a><br><bdi dir="ltr">${escapeHtml(secondary.href)}</bdi></p>`]
      : []),
    ...(body.outro && body.outro.length > 0
      ? [`<div style="margin-top:24px;padding-top:20px;border-top:1px solid ${LINE};">`, ...body.outro.map((p) => paragraphHtml(p, SECONDARY_INK)), '</div>']
      : []),
    '</td></tr>',
    footer(locale, frame),
    '</table>',
    MSO_CLOSE,
    '</td></tr>',
    '</table>',
    '</body></html>',
  ].join('\n');

  const text = [
    BRAND_NAME[locale],
    '',
    ...(body.headline ? [body.headline, ''] : []),
    ...body.intro.map((p) => p.map(inlineText).join('')).flatMap((p) => [p, '']),
    ...(body.details && body.details.length > 0 ? [...body.details.map((row) => `${row.label}: ${row.value}`), ''] : []),
    ...(action ? [`${action.label}:`, action.href, ''] : []),
    ...(secondary ? [`${secondary.label}:`, secondary.href, ''] : []),
    ...(body.outro ?? []).map((p) => p.map(inlineText).join('')).flatMap((p) => [p, '']),
    '--',
    FOOTER[locale],
  ].join('\n');

  return { subject: body.subject, text, html };
}
