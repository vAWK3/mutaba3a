import { z } from 'zod';
import { HOSTED_CURRENCIES } from '../format/currencies';

/**
 * The profile forms' rules, matching the server's (MUT-182: name 1–80 trimmed,
 * type PERSONAL | BUSINESS, an API currency). Messages are i18n keys, resolved
 * with `t()` where they render. The type has no default (eng review R5): the
 * form starts it as '' and the schema asks for a choice.
 */

const NAME_MAX = 80;

const name = z
  .string()
  .trim()
  .min(1, { message: 'hosted.profiles.errors.nameRequired' })
  .max(NAME_MAX, { message: 'hosted.profiles.errors.nameTooLong' });

const type = z.enum(['PERSONAL', 'BUSINESS'], { message: 'hosted.profiles.errors.typeRequired' });

const defaultCurrency = z.enum(HOSTED_CURRENCIES, { message: 'hosted.profiles.errors.currencyInvalid' });

export const createProfileSchema = z.object({
  name,
  type,
  defaultCurrency,
  timezone: z.string().min(1, { message: 'hosted.profiles.errors.timezoneInvalid' }),
});

export const editProfileSchema = z.object({ name, type, defaultCurrency });

export type CreateProfileValues = z.infer<typeof createProfileSchema>;
export type EditProfileValues = z.infer<typeof editProfileSchema>;
/** What the create form holds before validation: the type may still be unchosen. */
export type CreateProfileFormValues = Omit<CreateProfileValues, 'type'> & { type: CreateProfileValues['type'] | '' };
