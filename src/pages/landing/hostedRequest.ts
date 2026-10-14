import type { Language } from '../../lib/i18n/types';

/**
 * The hosted-account request form's contract with Netlify Forms (MUT-186).
 * Netlify only registers a form it finds in static HTML at deploy time, so
 * `vite.config.ts` emits a hidden twin of this form from these same constants
 * (`__forms.html`). Renaming a field here renames it in both places.
 *
 * Imports nothing from React or the DOM: the Vite config's Node program loads
 * this file too.
 */

export const HOSTED_REQUEST_FORM_NAME = 'hosted-request';

/** The emitted static twin. Posting to a real file sidesteps the SPA's `/*` rewrite. */
export const NETLIFY_FORMS_PATH = '/__forms.html';

/** Netlify drops any submission that fills this field; people never see it. */
export const HONEYPOT_FIELD = 'company-website';

/** A request with no answer by then shows the retry state instead of hanging (D5). */
export const SUBMIT_TIMEOUT_MS = 15_000;

export const PROFESSIONS = ['freelancer', 'lawyer', 'accountant', 'other'] as const;
export type Profession = (typeof PROFESSIONS)[number];

export const DEVICES = ['iphone', 'android', 'computer'] as const;
export type Device = (typeof DEVICES)[number];

/** Every field Netlify receives, in the order it is sent. */
export const HOSTED_REQUEST_FIELDS = [
  'name',
  'email',
  'phone',
  'profession',
  'devices',
  'message',
  'language',
  HONEYPOT_FIELD,
] as const;

export interface HostedRequestValues {
  name: string;
  email: string;
  phone: string;
  profession: Profession | '';
  devices: Device[];
  message: string;
  /** The page language, so Basel replies in it (D4). Never typed by the visitor. */
  language: Language;
  honeypot: string;
}

/** Only the two required fields can be wrong. */
export type HostedRequestErrors = Partial<Record<'name' | 'email', true>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emptyHostedRequest(language: Language): HostedRequestValues {
  return { name: '', email: '', phone: '', profession: '', devices: [], message: '', language, honeypot: '' };
}

export function validateHostedRequest(values: HostedRequestValues): HostedRequestErrors {
  const errors: HostedRequestErrors = {};
  if (!values.name.trim()) errors.name = true;
  if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = true;
  return errors;
}

export function encodeHostedRequest(values: HostedRequestValues): URLSearchParams {
  const fields: Record<(typeof HOSTED_REQUEST_FIELDS)[number], string> = {
    name: values.name.trim(),
    email: values.email.trim(),
    phone: values.phone.trim(),
    profession: values.profession,
    devices: values.devices.join(', '),
    message: values.message.trim(),
    language: values.language,
    [HONEYPOT_FIELD]: values.honeypot,
  };
  const body = new URLSearchParams({ 'form-name': HOSTED_REQUEST_FORM_NAME });
  for (const field of HOSTED_REQUEST_FIELDS) body.append(field, fields[field]);
  return body;
}

/**
 * Sends the request to Netlify Forms. Resolves 'error' rather than throwing
 * for a failure status, a network failure, or no answer within
 * `SUBMIT_TIMEOUT_MS`, so the form always leaves its sending state.
 */
export async function submitHostedRequest(
  values: HostedRequestValues,
  fetchImpl: typeof fetch = fetch,
): Promise<'ok' | 'error'> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(NETLIFY_FORMS_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encodeHostedRequest(values).toString(),
      signal: controller.signal,
    });
    return response.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  } finally {
    clearTimeout(timeout);
  }
}
