import { randomUUID } from 'node:crypto';
import type { CreateUserInput, UserLocale } from './repositories/ports.js';

/** MUT-120: the personal profile is named in the user's language; a server-generated name, so no i18n layer (precedent: expenses/presets.ts). */
export const PERSONAL_PROFILE_NAME: Record<UserLocale, string> = { en: 'Personal', ar: 'شخصي' };

/**
 * The organization fields of a user's personal profile. Shared by account
 * creation (`POST /admin/v1/users`) and the post-roll backfill, so a
 * backfilled profile is indistinguishable from one created with the account.
 */
export function personalProfileFor(locale: UserLocale, settings: { defaultCurrency: string; timezone: string }): CreateUserInput['personal'] {
  // slugify() strips Arabic, and the user id does not exist until the store creates it: a random, ASCII, never-shown slug.
  return { name: PERSONAL_PROFILE_NAME[locale], slug: `personal-${randomUUID()}`, ...settings };
}
