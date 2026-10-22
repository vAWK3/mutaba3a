import { SENTRY_RULES, type SentrySurface } from './sentry-rules.js';

/**
 * ADR-091's whole-event scrubber (docs/observability/README.md, "Rules every surface follows"),
 * run as the SDK's `beforeSend`. Returns a cleaned copy, or null for an error the surface ignores.
 *
 * Pure and free of `node:*` imports: the portal and landing (MUT-149/150) reuse it in the browser.
 */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const FILTERED = '[Filtered]';
const DENY_TOKENS = new Set<string>(SENTRY_RULES.denyKeyTokens);
const DENY_HEADERS = new Set<string>(SENTRY_RULES.denyHeaders);
const LABELLED_VALUE = new RegExp(SENTRY_RULES.labelledValuePattern, 'g');
const URL_IN_TEXT = new RegExp(SENTRY_RULES.urlInTextPattern, 'g');
const FIRST_LINE_ONLY = SENTRY_RULES.firstLineOnlyExceptionTypes.map((pattern) => new RegExp(pattern));
const BREADCRUMB_URL_KEYS = SENTRY_RULES.urlFields
  .filter((field) => field.startsWith('breadcrumb.data.'))
  .map((field) => field.slice('breadcrumb.data.'.length));

const isObject = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null && !Array.isArray(value);
const includes = (list: readonly string[], value: string) => list.includes(value);

/** Rule 3: `clientName` → client + name, `address2Line` → address + 2 + line, lowercased. */
export function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

const isDeniedKey = (key: string) => keyTokens(key).some((token) => DENY_TOKENS.has(token));

/** Drops every key holding a deny token, at any depth. */
function dropDeniedKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(dropDeniedKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !isDeniedKey(key)).map(([key, child]) => [key, dropDeniedKeys(child)]));
}

/** Rule 2: a URL keeps scheme, host and path; never its query or fragment. */
const pathOnly = (url: string) => url.replace(/[?#].*$/s, '');

/**
 * Rule 7, in order: truncate, first line only (when `firstLine`), strip URL queries, then replace each
 * sensitive labelled value with [Filtered], keeping its quotes. After a harmless label the scan restarts
 * at its value, so `Error: failed amount=5` can't hide `amount=`.
 */
export function scrubText(full: string, firstLine = false): string {
  let text = full.slice(0, SENTRY_RULES.maxMessageLength);
  if (firstLine) text = text.split('\n')[0] ?? '';
  text = text.replace(URL_IN_TEXT, '$1');
  let out = '';
  let last = 0;
  LABELLED_VALUE.lastIndex = 0;
  for (let match = LABELLED_VALUE.exec(text); match; match = LABELLED_VALUE.exec(text)) {
    const key = match[1] ?? match[3] ?? '';
    const value = match[2] ?? match[4] ?? '';
    const valueStart = match.index + match[0].length - value.length;
    const sensitive = isDeniedKey(key);
    LABELLED_VALUE.lastIndex = sensitive ? valueStart + value.length : Math.max(valueStart, match.index + 1);
    if (!sensitive || valueStart < last) continue;
    const quote = /^["']/.test(value) ? value[0] : '';
    out += text.slice(last, valueStart) + quote + FILTERED + quote;
    last = valueStart + value.length;
  }
  return out + text.slice(last);
}

const isFirstLineOnly = (type: Json | undefined, value: Json | undefined) =>
  FIRST_LINE_ONLY.some((pattern) => [type, value].some((text) => typeof text === 'string' && pattern.test(text)));

function scrubRequest(request: JsonObject): JsonObject {
  const clean: JsonObject = {};
  for (const [field, value] of Object.entries(request)) {
    if (includes(SENTRY_RULES.requestDropFields, field)) continue;
    if (field === 'url' && typeof value === 'string') clean.url = pathOnly(value);
    else if (field === 'headers' && isObject(value)) {
      clean.headers = Object.fromEntries(Object.entries(value).filter(([header]) => !DENY_HEADERS.has(header.toLowerCase()) && !isDeniedKey(header)));
    } else clean[field] = value;
  }
  return clean;
}

const pick = (value: JsonObject, allowed: readonly string[]) => Object.fromEntries(Object.entries(value).filter(([key]) => includes(allowed, key)));

/** Rule 4: always-dropped keys go, safe keys stay even with a deny token, the rest follow rule 3. */
function scrubContexts(contexts: JsonObject): JsonObject {
  const clean: JsonObject = {};
  for (const [context, fields] of Object.entries(contexts)) {
    if (!isObject(fields)) {
      clean[context] = fields;
      continue;
    }
    const kept: JsonObject = {};
    for (const [key, child] of Object.entries(fields)) {
      const path = `${context}.${key}`;
      if (includes(SENTRY_RULES.alwaysDropContextKeys, path)) continue;
      if (includes(SENTRY_RULES.safeContextKeys, path)) kept[key] = child;
      else if (!isDeniedKey(key)) kept[key] = dropDeniedKeys(child);
    }
    clean[context] = kept;
  }
  return clean;
}

/** Rule 6: no console breadcrumbs; data keeps path-only URLs and no denied keys; messages are scrubbed. */
function scrubBreadcrumb(crumb: Json): Json | undefined {
  if (!isObject(crumb) || crumb.category === 'console') return isObject(crumb) ? undefined : crumb;
  const clean: JsonObject = { ...crumb };
  if (isObject(crumb.data)) {
    const data = dropDeniedKeys(crumb.data) as JsonObject;
    for (const key of BREADCRUMB_URL_KEYS) if (typeof data[key] === 'string') data[key] = pathOnly(data[key]);
    clean.data = data;
  }
  if (typeof crumb.message === 'string') clean.message = scrubText(crumb.message);
  return clean;
}

const scrubBreadcrumbs = (list: Json[]) => list.map(scrubBreadcrumb).filter((crumb): crumb is Json => crumb !== undefined);

function scrubException(exception: JsonObject): JsonObject {
  if (!Array.isArray(exception.values)) return exception;
  const values = exception.values.map((entry) => {
    if (!isObject(entry)) return entry;
    const clean: JsonObject = { ...entry };
    if (typeof entry.value === 'string') clean.value = scrubText(entry.value, isFirstLineOnly(entry.type, entry.value));
    if (isObject(entry.stacktrace) && Array.isArray(entry.stacktrace.frames)) {
      // D10: a frame keeps everything except its local variables.
      const frames = entry.stacktrace.frames.map((frame) => (isObject(frame) ? Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'vars')) : frame));
      clean.stacktrace = { ...entry.stacktrace, frames };
    }
    return clean;
  });
  return { ...exception, values };
}

/** A structured message keeps its template; its `params` (the raw substituted values) go. */
function scrubMessage(message: Json): Json {
  if (typeof message === 'string') return scrubText(message);
  if (!isObject(message)) return message;
  const clean = Object.fromEntries(Object.entries(message).filter(([key]) => !includes(SENTRY_RULES.messageDropFields, key)));
  if (typeof clean.formatted === 'string') clean.formatted = scrubText(clean.formatted);
  return clean;
}

/** Rule 8: the top exception's `<type>: <value>` against the surface's ignored errors. */
function isIgnored(event: JsonObject, surface: SentrySurface): boolean {
  const values = isObject(event.exception) && Array.isArray(event.exception.values) ? event.exception.values : [];
  const top = values[values.length - 1];
  if (!isObject(top)) return false;
  const text = `${String(top.type ?? '')}: ${String(top.value ?? '')}`;
  return SENTRY_RULES.ignoredErrors[surface].some((entry) => new RegExp(entry.pattern, 'ignoreCase' in entry && entry.ignoreCase ? 'i' : '').test(text));
}

const FIELD_SCRUBBERS: Record<string, (value: Json) => Json> = {
  request: (value) => (isObject(value) ? scrubRequest(value) : value),
  user: (value) => (isObject(value) ? pick(value, SENTRY_RULES.allowedUserKeys) : value),
  tags: (value) => (isObject(value) ? pick(value, SENTRY_RULES.allowedTags) : value),
  extra: dropDeniedKeys,
  contexts: (value) => (isObject(value) ? scrubContexts(value) : value),
  breadcrumbs: (value) =>
    Array.isArray(value) ? scrubBreadcrumbs(value) : isObject(value) && Array.isArray(value.values) ? { ...value, values: scrubBreadcrumbs(value.values) } : value,
  exception: (value) => (isObject(value) ? scrubException(value) : value),
  message: scrubMessage,
  logentry: scrubMessage,
};

export function scrubEvent<T extends object>(event: T, surface: SentrySurface): T | null {
  const source = event as unknown as JsonObject;
  if (isIgnored(source, surface)) return null;
  const clean: JsonObject = {};
  for (const [field, value] of Object.entries(source)) {
    const scrub = FIELD_SCRUBBERS[field];
    clean[field] = scrub ? scrub(value) : value;
  }
  return clean as unknown as T;
}
