import type { UserLocale } from '../../repositories/ports.js';
import type { MailTemplateId } from '../ports.js';

/**
 * MUT-468: each customer mail's look, from the approved Claude Design mail kit (frame 1b, MUT-467): a mood (the tint
 * of the band and panels), a header picture and an icon chip. The pictures are PNG @2x in
 * src/hosted/public/mail/v1, served by the API at <PORTAL_ORIGIN>/mail/v1 (eng review D2). `v1` is never rewritten:
 * changed art goes in a new folder, because sent mails keep pointing at the old one. The operator digest has no look.
 */
export type CustomerTemplateId = Exclude<MailTemplateId, 'review-digest'>;
export type Mood = 'hello' | 'safety' | 'trial' | 'goodbye';

/** Band: the full-bleed tint behind the wordmark and header art. Panel: the lighter tint of the details panel. */
export const MOODS: Record<Mood, { band: string; panel: string }> = {
  hello: { band: '#FBE5D1', panel: '#FDF1E6' },
  safety: { band: '#EAE4F6', panel: '#F4F1FA' },
  trial: { band: '#DFEBF1', panel: '#EEF4F7' },
  goodbye: { band: '#ECE7E1', panel: '#F5F1EC' },
};

type Words = Record<UserLocale, string>;
type Header =
  | 'spot-email'
  | 'empty-state'
  | 'spot-pending'
  | 'milestone-firm'
  | 'spot-lock'
  | 'spot-badge'
  | 'spot-person'
  | 'spot-calendar'
  | 'spot-schedule'
  | 'destructive-confirmation';
type Chip = 'email' | 'edit' | 'pending' | 'success' | 'password' | 'lock' | 'badge' | 'person' | 'calendar' | 'schedule' | 'info' | 'delete';

/** `rtl`: the art has a direction, so Arabic mails use its mirrored `-rtl` file. */
const HEADERS: Record<Header, { rtl: boolean; alt: Words }> = {
  'spot-email': { rtl: false, alt: { en: 'An envelope in a circle', ar: 'ظرف داخل دائرة' } },
  'empty-state': { rtl: false, alt: { en: 'An envelope with an orange dot above it', ar: 'ظرف ونقطة برتقالية فوقه' } },
  'spot-pending': { rtl: false, alt: { en: 'An hourglass in a circle', ar: 'ساعة رملية داخل دائرة' } },
  'milestone-firm': { rtl: true, alt: { en: 'Three steps with a flag on top', ar: 'ثلاث درجات وعلم فوقها' } },
  'spot-lock': { rtl: false, alt: { en: 'A padlock in a circle', ar: 'قفل داخل دائرة' } },
  'spot-badge': { rtl: false, alt: { en: 'An ID card in a circle', ar: 'بطاقة هوية داخل دائرة' } },
  'spot-person': { rtl: false, alt: { en: 'A person in a circle', ar: 'شخص داخل دائرة' } },
  'spot-calendar': { rtl: false, alt: { en: 'A calendar in a circle', ar: 'تقويم داخل دائرة' } },
  'spot-schedule': { rtl: false, alt: { en: 'A clock in a circle', ar: 'ساعة داخل دائرة' } },
  'destructive-confirmation': { rtl: true, alt: { en: 'A bin with its lid open', ar: 'سلة بغطاء مفتوح' } },
};

const CHIPS: Record<Chip, Words> = {
  email: { en: 'Envelope icon', ar: 'أيقونة ظرف' },
  edit: { en: 'Pencil icon', ar: 'أيقونة قلم' },
  pending: { en: 'Hourglass icon', ar: 'أيقونة ساعة رملية' },
  success: { en: 'Check mark icon', ar: 'أيقونة علامة صح' },
  password: { en: 'Password icon', ar: 'أيقونة كلمة مرور' },
  lock: { en: 'Padlock icon', ar: 'أيقونة قفل' },
  badge: { en: 'ID card icon', ar: 'أيقونة بطاقة هوية' },
  person: { en: 'Person icon', ar: 'أيقونة شخص' },
  calendar: { en: 'Calendar icon', ar: 'أيقونة تقويم' },
  schedule: { en: 'Clock icon', ar: 'أيقونة ساعة' },
  info: { en: 'Information icon', ar: 'أيقونة معلومات' },
  delete: { en: 'Bin icon', ar: 'أيقونة سلة' },
};

export interface Look {
  mood: Mood;
  header: Header;
  chip: Chip;
}

/** The approved mockup's mapping (plan §3). */
export const LOOK: Record<CustomerTemplateId, Look> = {
  'finish-signup': { mood: 'hello', header: 'spot-email', chip: 'email' },
  'finish-setup': { mood: 'hello', header: 'empty-state', chip: 'edit' },
  'account-under-review': { mood: 'hello', header: 'spot-pending', chip: 'pending' },
  'account-ready': { mood: 'hello', header: 'milestone-firm', chip: 'success' },
  'reset-password': { mood: 'safety', header: 'spot-lock', chip: 'password' },
  'password-changed': { mood: 'safety', header: 'spot-lock', chip: 'lock' },
  'passkey-added': { mood: 'safety', header: 'spot-badge', chip: 'badge' },
  'account-exists': { mood: 'safety', header: 'spot-person', chip: 'person' },
  'trial-ending-soon': { mood: 'trial', header: 'spot-calendar', chip: 'calendar' },
  'trial-ended': { mood: 'trial', header: 'spot-schedule', chip: 'schedule' },
  'trial-locking-soon': { mood: 'trial', header: 'spot-lock', chip: 'lock' },
  'account-declined': { mood: 'goodbye', header: 'empty-state', chip: 'info' },
  'account-closing': { mood: 'goodbye', header: 'destructive-confirmation', chip: 'delete' },
};

export function isCustomerTemplate(template: MailTemplateId): template is CustomerTemplateId {
  return template in LOOK;
}

/** Where the pictures are served, under the art origin. */
export const MAIL_ART_PATH = '/mail/v1/';

const headerFile = (mood: Mood, header: Header, rtl: boolean) => `mail-header-${mood}-${header}${rtl ? '-rtl' : ''}-2x.png`;
const chipFile = (mood: Mood, chip: Chip) => `chip-${chip}-${mood}-2x.png`;

export interface Picture {
  file: string;
  alt: string;
}

/** The two pictures of a look, in a language: Arabic takes the mirrored file of art with a direction. */
export function artFor(look: Look, locale: UserLocale): { header: Picture; chip: Picture } {
  const header = HEADERS[look.header];
  return {
    header: { file: headerFile(look.mood, look.header, locale === 'ar' && header.rtl), alt: header.alt[locale] },
    chip: { file: chipFile(look.mood, look.chip), alt: CHIPS[look.chip][locale] },
  };
}

/** Every file a mail can point at, both directions (look.test.ts checks each ships). */
export const ART_FILES: readonly string[] = [
  ...new Set(
    Object.values(LOOK).flatMap((look) => [
      headerFile(look.mood, look.header, false),
      ...(HEADERS[look.header].rtl ? [headerFile(look.mood, look.header, true)] : []),
      chipFile(look.mood, look.chip),
    ]),
  ),
];
