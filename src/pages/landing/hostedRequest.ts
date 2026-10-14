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

/** The twin's file name in the build output (the path without its leading slash). */
export const NETLIFY_FORMS_FILE = NETLIFY_FORMS_PATH.slice(1);

/**
 * Netlify drops any submission that fills this field; people never see it.
 * Netlify's own name: a name that looks like contact data (company, website…)
 * gets autofilled for real visitors, whose requests would then vanish.
 */
export const HONEYPOT_FIELD = 'bot-field';

/** Longest accepted answer per field; the inputs carry these as maxLength too. */
export const FIELD_MAX_LENGTH = { name: 200, email: 254, phone: 40, message: 4000 } as const;
type LimitedField = keyof typeof FIELD_MAX_LENGTH;

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
  'request-id',
  HONEYPOT_FIELD,
] as const;

/** Fields the twin declares as a <textarea>; everything else is an <input>. */
export const MULTILINE_FIELDS: ReadonlySet<string> = new Set(['message']);

export interface HostedRequestValues {
  name: string;
  email: string;
  phone: string;
  profession: Profession | '';
  devices: Device[];
  message: string;
  /** The page language, so Basel replies in it (D4). Never typed by the visitor. */
  language: Language;
  /** One id per form, kept across retries and corrections, so Basel can match duplicates. */
  requestId: string;
  honeypot: string;
}

/** What the visitor types; the language and request id are added at send time. */
export type HostedRequestAnswers = Omit<HostedRequestValues, 'language' | 'requestId'>;

export const EMPTY_HOSTED_ANSWERS: HostedRequestAnswers = {
  name: '',
  email: '',
  phone: '',
  profession: '',
  devices: [],
  message: '',
  honeypot: '',
};

export type HostedRequestError = 'required' | 'invalid' | 'tooLong';
export type HostedRequestErrors = Partial<Record<LimitedField, HostedRequestError>>;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * A random v4 UUID. crypto.randomUUID exists only in secure contexts (and Safari 15.4+);
 * getRandomValues works everywhere, so a page opened over plain http still renders.
 */
export function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function emptyHostedRequest(language: Language, requestId: string): HostedRequestValues {
  return { ...EMPTY_HOSTED_ANSWERS, language, requestId };
}

export function validateHostedRequest(values: HostedRequestAnswers): HostedRequestErrors {
  const errors: HostedRequestErrors = {};
  if (!values.name.trim()) errors.name = 'required';
  if (!values.email.trim()) errors.email = 'required';
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'invalid';
  for (const field of Object.keys(FIELD_MAX_LENGTH) as LimitedField[]) {
    if (values[field].trim().length > FIELD_MAX_LENGTH[field]) errors[field] = 'tooLong';
  }
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
    'request-id': values.requestId,
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
