// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * MUT-147 / ADR-091: `docs/observability/sentry-rules.json` is the one list of what every
 * Sentry surface (api, portal, landing, capture-app) strips from an error report before it
 * leaves for Sentry EU, and `sentry-fixtures.json` holds the "dirty event in, clean event out"
 * cases each surface's scrubber must reproduce. This test checks the contract itself: that its
 * lists are safe, that every fixture's expected event is clean under those lists, and that the
 * files can't change without a version bump. The scrubbers live in MUT-148..151.
 */

const RULES_PATH = 'docs/observability/sentry-rules.json';
const FIXTURES_PATH = 'docs/observability/sentry-fixtures.json';
/**
 * sha256 of both files per version. Append-only once a version has merged: changing either file
 * means bumping the version and adding a row, so the Flutter app's byte copy (MUT-151) can't
 * silently differ. (1.0.0 was re-pinned by the MUT-147 pre-landing review cycles, before it merged.)
 */
const PINNED_VERSIONS: Record<string, { rules: string; fixtures: string }> = {
  '1.0.0': {
    rules: '526ba6aa37a7bafffa0b8d87b2417192f523d26631d519a0489d4fc056404c04',
    fixtures: '99db5709d8f447fa48faa4ef0ad5d37be3a733ccb0ab0adb7e7ab0c9c8fe3ee5',
  },
  // Convergence review (2026-10-18): money and free-text keys, multi-line containers, messages.
  '1.1.0': {
    rules: '6d444aac1d33ba3149924c1b8ae3e1f58f4adadf167bb0ee5acfefadce2d44fc',
    fixtures: '3b0dfac37ee2a25a37169ad4c71966e5b703fadd92bdec4e6ae90adf91332995',
  },
};

const SURFACES = ['api', 'portal', 'landing', 'capture-app'];
const FORBIDDEN_SURFACES = ['web', 'desktop', 'app', 'local'];
const RULES_KEYS = [
  'version', 'region', 'surfaces', 'sdk', 'serverReportsStatusAtLeast', 'serverPrismaErrorFormat', 'denyHeaders',
  'denyKeyTokens', 'requestDropFields', 'messageDropFields', 'urlFields', 'maxMessageLength', 'urlInTextPattern', 'labelledValuePattern', 'firstLineOnlyExceptionTypes', 'allowedTags', 'allowedUserKeys',
  'safeContextKeys', 'alwaysDropContextKeys', 'ignoredErrors', 'orgSettings', 'orgSensitiveFields',
];
/** ADR-091 rule 2 (D3): every URL-bearing field keeps the path only; no query, no fragment. */
const URL_FIELDS = ['request.url', 'breadcrumb.data.url', 'breadcrumb.data.from', 'breadcrumb.data.to'];
const REQUIRED_ORG_SETTINGS = {
  dataScrubber: true,
  dataScrubberDefaults: true,
  scrubIPAddresses: true,
  enhancedPrivacy: true,
  allowSharedIssues: false,
  require2FA: true,
};
/** D11: lowercase compounds that whole-token splitting can't break apart, so each must be a token itself. */
const COMPOUND_DENY_TOKENS = [
  'username', 'firstname', 'lastname', 'fullname', 'apikey', 'accesstoken', 'refreshtoken', 'sessionid',
  'phonenumber', 'emailaddress', 'passwd', 'pwd', 'credential', 'credentials', 'jwt', 'otp',
  // D18: the product's own PII labels (clients, receipt vendors, titles, *Reason fields, E-mail → e + mail).
  'client', 'clients', 'vendor', 'vendors', 'mobile', 'tel', 'mail', 'title', 'reason',
];
const FIXTURES_KEYS = ['version', 'marker', 'fixtures'];
const FIXTURE_KEYS = ['name', 'surface', 'input', 'expected'];
const REQUIRED_SDK = {
  sendDefaultPii: false,
  sampleRate: 1,
  tracesSampleRate: 0,
  profilesSampleRate: 0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
  attachScreenshot: false,
  attachViewHierarchy: false,
  consoleBreadcrumbs: false,
  includeLocalVariables: false,
};
/** ADR-091 rule 3: the minimum each list must hold. A list may grow, never drop these. */
const MIN_DENY_TOKENS = [
  'amount', 'total', 'balance', 'name', 'email', 'phone', 'note', 'description', 'memo', 'address', 'iban',
  'account', 'token', 'password', 'secret', 'key', 'pepper', 'session', 'cookie', 'authorization', 'body', 'query',
];
const MIN_DENY_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'idempotency-key', 'x-forwarded-for', 'referer'];
/** D17: request fields dropped whole, wherever an SDK puts them. */
const REQUEST_DROP_FIELDS = ['data', 'cookies', 'query_string', 'fragment', 'env'];
/**
 * D15: messages a scrubber must clean, and the substrings that must be gone afterwards. Fixed
 * here, independent of the contract's own pattern, so a pattern that misses a form fails this test.
 */
const LEAK_CASES: Array<[string, string[]]> = [
  ['Request failed: {"email":"visitor@example.test","amount":12000,"status":500}', ['visitor@example.test', '12000']],
  ['{"email": "visitor@example.test", "note": "paid late"}', ['visitor@example.test', 'paid late']],
  ['Authorization: Bearer mut_live_synthetic', ['mut_live_synthetic', 'Bearer']],
  ['name=Acme Legal', ['Acme', 'Legal']],
  ['{name: John Smith, note: paid late}', ['John', 'Smith', 'paid late']],
  ["name: 'John Smith'", ['John', 'Smith']],
  ['amount=1,234.56 ILS', ['1,234.56', '234']],
  ['email = visitor@example.test', ['visitor@example.test']],
  ['Error: insert failed amount=12000 currency=ILS', ['12000']],
  // Cycle-3 review: nested values, cut-off strings, parentheses, the domain's own labels, URLs in text.
  ['{"email": {"address": "visitor@example.test"}}', ['visitor@example.test']],
  ['{"body":{"note":"pay rent","x":1}}', ['pay rent', 'rent']],
  ['{"emails":["a@b.test","c@d.test"]}', ['a@b.test', 'c@d.test']],
  ['{"emails":[{"a":"x@y.test"},{"b":"z@w.test"}]}', ['x@y.test', 'z@w.test']],
  ['{"note": ["paid late", "second"]}', ['paid late', 'second']],
  ['{"id":"1","name":"Mohammed Abdullah Al-Ahmad Servi', ['Mohammed', 'Abdullah']],
  ['note: pay (rent) to landlord John', ['rent', 'landlord', 'John']],
  ['name: Acme (Pty) Ltd', ['Acme', 'Ltd']],
  ['client: Acme Legal', ['Acme', 'Legal']],
  ['{"vendor":"Taxi Co","title":"Website for John Smith"}', ['Taxi Co', 'John Smith']],
  ['E-mail: visitor@example.test', ['visitor@example.test']],
  ['withdrawnReason=client moved abroad', ['moved abroad']],
  ['failed at https://portal.example.test/setup#t=st_synthetic_token', ['st_synthetic_token', '#']],
  ['GET https://api.example.test/v1/clients?q=acme+legal failed', ['acme', '?q=']],
  // Convergence review: the product's money fields (*Minor), free-text fields, multi-line output, digits, plurals.
  ['Request failed: {"grossMinor":12000,"vatMinor":1800,"netMinor":10200,"paidMinor":5000}', ['12000', '1800', '10200', '5000']],
  ['outstandingMinor=45000 overdueMinor=12000', ['45000', '12000']],
  ['{ creditedMinor: 3000, allocatedMinor: 2000, commissionMinor: 900 }', ['3000', '2000', '900']],
  ['{"reference":"Transfer J. Smith","label":"Deposit from John Smith","metadata":{"by":"Acme"}}', ['J. Smith', 'John Smith', 'Acme']],
  [
    JSON.stringify({ id: 'c1', emails: ['visitor@example.test', 'second.person@example.test'], note: 'x' }, null, 2),
    ['visitor@example.test', 'second.person@example.test'],
  ],
  ["{\n  id: 'c1',\n  emails: [\n    'visitor@example.test',\n    'second.person@example.test'\n  ]\n}", ['visitor@example.test', 'second.person']],
  ['address2=12 Herzl St; phone2=+972501234567; email2=visitor@example.test', ['Herzl', '972501234567', 'visitor@example.test']],
  ['{"phones":["+972501234567"],"addresses":["1 Main St"],"descriptions":["Website for John Smith"]}', ['972501234567', 'Main St', 'John Smith']],
];
/** Text the scrubber must leave exactly as it is. */
const UNTOUCHED = [
  'see https://de.sentry.io/x at 12:30',
  "Cannot read properties of undefined (reading 'balanceMinor')",
  'Unique constraint failed on the fields: (`organization_id`,`external_ref`)',
];
const FILTERED = '[Filtered]';
/** ADR-091 rule 4 (R7): syntax JavaScript and Dart read differently, or only one of them reads. */
const NON_PORTABLE_REGEX: Array<[RegExp, string]> = [
  [/\(\?[a-zA-Z-]+[):]/, 'inline flags such as (?i)'],
  [/\(\?<[=!]/, 'lookbehind'],
  [/\(\?<[A-Za-z]/, 'named groups'],
  [/\\[pP]\{/, 'Unicode property escapes'],
  [/\\k</, 'named backreferences'],
  [/\\[1-9]/, 'backreferences'],
];
const SEMVER = /^\d+\.\d+\.\d+$/;

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };
type IgnoredError = { pattern?: unknown; ignoreCase?: unknown; reason?: unknown; [key: string]: unknown };
type Rules = {
  version?: unknown;
  surfaces?: unknown;
  sdk?: Record<string, unknown>;
  serverReportsStatusAtLeast?: unknown;
  denyHeaders?: string[];
  denyKeyTokens?: string[];
  allowedTags?: string[];
  allowedUserKeys?: string[];
  safeContextKeys?: string[];
  alwaysDropContextKeys?: string[];
  ignoredErrors?: Record<string, IgnoredError[]>;
  orgSettings?: Record<string, unknown>;
  orgSensitiveFields?: string[];
  requestDropFields?: string[];
  messageDropFields?: string[];
  urlFields?: string[];
  urlInTextPattern?: string;
  labelledValuePattern?: string;
  firstLineOnlyExceptionTypes?: string[];
  [key: string]: unknown;
};
type Fixture = { name: string; surface: string; input: JsonObject; expected: JsonObject; [key: string]: unknown };
type Fixtures = { version?: unknown; marker?: unknown; fixtures?: Fixture[]; [key: string]: unknown };

const rulesRaw = readFileSync(RULES_PATH, 'utf8');
const fixturesRaw = readFileSync(FIXTURES_PATH, 'utf8');
const rules = JSON.parse(rulesRaw) as Rules;
const fixturesFile = JSON.parse(fixturesRaw) as Fixtures;
const fixtures = fixturesFile.fixtures ?? [];

const sha256 = (raw: string) => createHash('sha256').update(raw).digest('hex');
const unknownKeys = (value: object, allowed: string[]) => Object.keys(value).filter((key) => !allowed.includes(key));
const isObject = (value: unknown): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * ADR-091 rule 3 (R6): split a key on `_`, `-`, `.`, spaces, camelCase humps and letter–digit
 * boundaries (so `email2` holds `email`), lowercased.
 */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])([0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Za-z])/g, '$1 $2')
    .split(/[\s_.-]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

const denyTokens = () => rules.denyKeyTokens ?? [];
const hasDenyToken = (key: string) => keyTokens(key).some((token) => denyTokens().includes(token));

/** Keys anywhere under `value` that the rules drop, as dotted paths. */
function deniedKeyPaths(value: Json | undefined, path: string): string[] {
  if (Array.isArray(value)) return value.flatMap((item, index) => deniedKeyPaths(item, `${path}[${index}]`));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    ...(hasDenyToken(key) ? [`${path}.${key}`] : []),
    ...deniedKeyPaths(child, `${path}.${key}`),
  ]);
}

function contextProblems(contexts: Json | undefined): string[] {
  if (!isObject(contexts)) return [];
  return Object.entries(contexts).flatMap(([context, fields]) => {
    if (!isObject(fields)) return [];
    return Object.entries(fields).flatMap(([key, child]) => {
      const path = `${context}.${key}`;
      if ((rules.alwaysDropContextKeys ?? []).includes(path)) return [`contexts.${path} is always dropped`];
      if ((rules.safeContextKeys ?? []).includes(path)) return [];
      return [
        ...(hasDenyToken(key) ? [`contexts.${path}`] : []),
        ...deniedKeyPaths(child, `contexts.${path}`),
      ];
    });
  });
}

type LabelledValue = { key: string; value: string; valueStart: number };

/**
 * The contract's scan (README rule 7, D15): key in group 1 or 3, value in group 2 or 4. After a
 * label whose key is not sensitive, scanning restarts at its value, so a harmless label never
 * swallows a sensitive one behind it; after a sensitive one, it continues past the value.
 */
function labelledValues(text: string): LabelledValue[] {
  const pattern = new RegExp(rules.labelledValuePattern ?? '$^', 'g');
  const found: LabelledValue[] = [];
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const key = match[1] ?? match[3];
    const value = match[2] ?? match[4];
    const valueStart = match.index + match[0].length - value.length;
    found.push({ key, value, valueStart });
    pattern.lastIndex = hasDenyToken(key) ? valueStart + value.length : Math.max(valueStart, match.index + 1);
  }
  return found;
}

const isFiltered = (value: string) => value === FILTERED || /^(["'])\[Filtered\]\1$/.test(value);

/** D19: an http(s) URL inside free text keeps scheme, host and path; its query and fragment go. */
const stripUrlsInText = (text: string) => text.replace(new RegExp(rules.urlInTextPattern ?? '$^', 'g'), '$1');

/**
 * The reference scrub of free text, in the contract's order (README rule 7): truncate to
 * `maxMessageLength` (D15), strip URL queries and fragments (D19), then replace each sensitive
 * labelled value with [Filtered], keeping its quotes.
 */
function scrubLabelled(full: string): string {
  const text = stripUrlsInText(full.slice(0, Number(rules.maxMessageLength ?? 0)));
  let out = '';
  let last = 0;
  for (const { key, value, valueStart } of labelledValues(text)) {
    if (!hasDenyToken(key) || valueStart < last) continue;
    const quote = /^["']/.test(value) ? value[0] : '';
    out += text.slice(last, valueStart) + quote + FILTERED + quote;
    last = valueStart + value.length;
  }
  return out + text.slice(last);
}

/** Labelled values in free text whose key holds a deny token must read `[Filtered]` (rule 7, D4, D15). */
function labelledValueProblems(where: string, text: Json | undefined): string[] {
  if (typeof text !== 'string') return [];
  return labelledValues(text)
    .filter(({ key, value }) => hasDenyToken(key) && !isFiltered(value))
    .map(({ key, value }) => `${where}: "${key}" keeps "${value}"`);
}

/** A URL-bearing field keeps the path only (rule 2, D3): a query string or fragment is a leak. */
const urlProblem = (where: string, value: Json | undefined) =>
  typeof value === 'string' && /[?#]/.test(value) ? [`${where} keeps a query string or fragment`] : [];
const breadcrumbUrlKeys = () =>
  (rules.urlFields ?? []).filter((field) => field.startsWith('breadcrumb.data.')).map((field) => field.slice('breadcrumb.data.'.length));

function requestProblems(request: Json | undefined): string[] {
  if (!isObject(request)) return [];
  const problems = (rules.requestDropFields ?? [])
    .filter((field) => field in request)
    .map((field) => `request.${field} is present`);
  problems.push(...urlProblem('request.url', request.url));
  const headers = isObject(request.headers) ? Object.keys(request.headers) : [];
  for (const header of headers) {
    if ((rules.denyHeaders ?? []).includes(header.toLowerCase()) || hasDenyToken(header)) {
      problems.push(`request.headers.${header} is present`);
    }
  }
  return problems;
}

function breadcrumbProblems(breadcrumbs: Json | undefined): string[] {
  const list = isObject(breadcrumbs) && Array.isArray(breadcrumbs.values) ? breadcrumbs.values : [];
  return list.flatMap((crumb, index) => {
    if (!isObject(crumb)) return [];
    const where = `breadcrumbs[${index}]`;
    const problems = crumb.category === 'console' ? [`${where} is a console breadcrumb`] : [];
    const data = isObject(crumb.data) ? crumb.data : {};
    for (const key of breadcrumbUrlKeys()) problems.push(...urlProblem(`${where}.data.${key}`, data[key]));
    return [...problems, ...deniedKeyPaths(data, `${where}.data`), ...freeTextProblems(`${where}.message`, crumb.message)];
  });
}

/** Free text (exception values, messages, breadcrumb messages) gets every text rule (rule 7, D19). */
function freeTextProblems(where: string, text: Json | undefined): string[] {
  if (typeof text !== 'string') return [];
  const problems = labelledValueProblems(where, text);
  if (stripUrlsInText(text) !== text) problems.push(`${where} keeps a URL query or fragment (D19)`);
  return problems;
}

/** An event's top-level message as text: a string (JS), `message.formatted` (Dart) or `logentry.formatted`. */
const messageText = (event: JsonObject): Json | undefined => {
  if (typeof event.message === 'string') return event.message;
  if (isObject(event.message)) return event.message.formatted;
  return isObject(event.logentry) ? event.logentry.formatted : undefined;
};

const firstLineOnly = (type: Json | undefined) =>
  typeof type === 'string' && (rules.firstLineOnlyExceptionTypes ?? []).some((pattern) => new RegExp(pattern).test(type));

function exceptionProblems(exception: Json | undefined): string[] {
  const values = isObject(exception) && Array.isArray(exception.values) ? exception.values : [];
  return values.flatMap((value, index) => {
    if (!isObject(value)) return [];
    const where = `exception.values[${index}]`;
    const problems = freeTextProblems(`${where}.value`, value.value);
    if (firstLineOnly(value.type) && typeof value.value === 'string' && value.value.includes('\n')) {
      problems.push(`${where}.value keeps more than its first line (${String(value.type)})`);
    }
    const stackFrames = isObject(value.stacktrace) && Array.isArray(value.stacktrace.frames) ? value.stacktrace.frames : [];
    stackFrames.forEach((frame, frameIndex) => {
      if (isObject(frame) && 'vars' in frame) problems.push(`${where}.stacktrace.frames[${frameIndex}].vars is present`);
    });
    return problems;
  });
}

/** Everything in an event the rules say must not reach Sentry. Empty for a clean event. */
function forbiddenIn(event: JsonObject): string[] {
  const user = isObject(event.user) ? Object.keys(event.user) : [];
  const tags = isObject(event.tags) ? Object.keys(event.tags) : [];
  return [
    ...requestProblems(event.request),
    ...user.filter((key) => !(rules.allowedUserKeys ?? []).includes(key)).map((key) => `user.${key}`),
    ...tags.filter((key) => !(rules.allowedTags ?? []).includes(key)).map((key) => `tags.${key} is not allowed`),
    ...deniedKeyPaths(event.extra, 'extra'),
    ...contextProblems(event.contexts),
    ...breadcrumbProblems(event.breadcrumbs),
    ...exceptionProblems(event.exception),
    ...freeTextProblems('message', messageText(event)),
    // A structured message's `params` are the raw substituted values (Dart SentryMessage, JS logentry).
    ...(['message', 'logentry'] as const).flatMap((field) => {
      const structured = event[field];
      if (!isObject(structured)) return [];
      return (rules.messageDropFields ?? []).filter((key) => key in structured).map((key) => `${field}.${key} is present`);
    }),
  ];
}

/** Each exception's frames, with `vars` removed: the one part of a frame the scrubbers drop (D10). */
const frames = (event: JsonObject) => {
  const values = isObject(event.exception) && Array.isArray(event.exception.values) ? event.exception.values : [];
  return values.map((value) => {
    const list = isObject(value) && isObject(value.stacktrace) ? value.stacktrace.frames : undefined;
    if (!Array.isArray(list)) return list;
    return list.map((frame) =>
      isObject(frame) ? Object.fromEntries(Object.entries(frame).filter(([key]) => key !== 'vars')) : frame,
    );
  });
};

const allExpected = () => fixtures.map((fixture) => fixture.expected);
const allInputs = () => fixtures.map((fixture) => fixture.input);
const contextValue = (event: JsonObject, context: string, key: string) =>
  isObject(event.contexts) && isObject(event.contexts[context]) ? event.contexts[context][key] : undefined;
const extraKeys = (event: JsonObject) => (isObject(event.extra) ? Object.keys(event.extra) : []);
/** Every key and string value anywhere in the given JSON. */
function allStrings(value: Json | Json[]): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap((item) => allStrings(item));
  if (!isObject(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...allStrings(child)]);
}

describe('keyTokens', () => {
  it.each([
    ['client_name', ['client', 'name']],
    ['clientName', ['client', 'name']],
    ['x-api-key', ['x', 'api', 'key']],
    ['os.name', ['os', 'name']],
    ['HTTPStatus', ['http', 'status']],
    ['filename', ['filename']],
    ['keyboard', ['keyboard']],
    ['email2', ['email', '2']],
    ['address2Line', ['address', '2', 'line']],
    ['grossMinor', ['gross', 'minor']],
  ])('splits %s into whole tokens', (key, expected) => {
    expect(keyTokens(key)).toEqual(expected);
  });
});

describe('Sentry scrub contract (ADR-091)', () => {
  it('uses only known top-level keys, a semver version and the same version in both files', () => {
    expect(unknownKeys(rules, RULES_KEYS)).toEqual([]);
    expect(unknownKeys(fixturesFile, FIXTURES_KEYS)).toEqual([]);
    expect(rules.version).toMatch(SEMVER);
    expect(fixturesFile.version).toBe(rules.version);
  });

  it('pins both files under their version, so a content change needs a version bump (R5)', () => {
    const pinned = PINNED_VERSIONS[rules.version as string];
    expect(pinned, `add a PINNED_VERSIONS row for ${String(rules.version)}`).toBeDefined();
    expect({ rules: sha256(rulesRaw), fixtures: sha256(fixturesRaw) }).toEqual(pinned);
  });

  it('keeps the fixture marker in the fixtures file only, so check-bundles can spot fixtures (R5)', () => {
    expect(typeof fixturesFile.marker).toBe('string');
    expect((fixturesFile.marker as string).length).toBeGreaterThanOrEqual(16);
    expect(rulesRaw).not.toContain(fixturesFile.marker as string);
  });

  it('names exactly the four reporting surfaces and never the local app or desktop', () => {
    expect(rules.surfaces).toEqual(SURFACES);
    for (const surface of FORBIDDEN_SURFACES) expect(rules.surfaces).not.toContain(surface);
    expect(rules.region).toBe('de.sentry.io');
  });

  it('requires the SDK options that keep reports content-free, frame locals included (D10)', () => {
    expect(rules.sdk).toEqual(REQUIRED_SDK);
    expect(rules.serverReportsStatusAtLeast).toBe(500);
    expect(rules.serverPrismaErrorFormat).toBe('minimal');
  });

  it('sets every org privacy switch the settings script applies (R9, D7)', () => {
    expect(rules.orgSettings).toEqual(REQUIRED_ORG_SETTINGS);
  });

  it('pushes only curated, distinctive sensitive fields to the org, because Sentry matches them as substrings (D2)', () => {
    const fields = rules.orgSensitiveFields ?? [];
    expect(fields.length).toBeGreaterThan(0);
    expect(new Set(fields).size).toBe(fields.length);
    for (const field of fields) {
      expect(field, field).toBe(field.toLowerCase());
      expect(field.length, field).toBeGreaterThanOrEqual(4);
    }
    // Server-side, a field wipes any value containing it: none may hit text the reports must keep.
    const kept = [
      ...allStrings(allExpected()),
      ...(rules.safeContextKeys ?? []),
      ...(rules.allowedTags ?? []),
    ].map((text) => text.toLowerCase());
    const clashes = fields.flatMap((field) => kept.filter((text) => text.includes(field)).map((text) => `${field} in "${text}"`));
    expect(clashes).toEqual([]);
  });

  it('lists every URL-bearing field that keeps its path only (D3)', () => {
    expect(rules.urlFields).toEqual(URL_FIELDS);
  });

  it('denies the lowercase compounds whole-token splitting cannot break apart (D11)', () => {
    for (const compound of COMPOUND_DENY_TOKENS) {
      expect(keyTokens(compound), compound).toEqual([compound]);
      expect(hasDenyToken(compound), compound).toBe(true);
    }
  });

  it('shares one portable labelled-value pattern with a bounded key (D4, D15)', () => {
    const pattern = rules.labelledValuePattern ?? '';
    expect(NON_PORTABLE_REGEX.filter(([syntax]) => syntax.test(pattern)).map(([, label]) => label)).toEqual([]);
    expect(pattern).toContain('{0,63}');
    const found = (text: string) => labelledValues(text).map(({ key, value }) => [key, value]);
    expect(found('{"email":"a@b.test","status":500}')).toEqual([
      ['email', '"a@b.test"'],
      ['status', '500'],
    ]);
    expect(found('Authorization: Bearer x, then')).toEqual([['Authorization', 'Bearer x, then']]);
    expect(found('Error: insert failed amount=5')).toEqual([
      ['Error', 'insert failed amount=5'],
      ['amount', '5'],
    ]);
  });

  it.each(LEAK_CASES)('scrubbing %j removes every sensitive value, whatever its form (D15)', (text, secrets) => {
    const scrubbed = scrubLabelled(text);
    for (const secret of secrets) expect(scrubbed, `${secret} survived`).not.toContain(secret);
    expect(scrubbed).not.toBe(text);
    expect(labelledValueProblems('text', scrubbed)).toEqual([]);
  });

  it('shares one portable pattern for URLs inside text (D19)', () => {
    const pattern = rules.urlInTextPattern ?? '';
    expect(NON_PORTABLE_REGEX.filter(([syntax]) => syntax.test(pattern))).toEqual([]);
    expect(stripUrlsInText('see https://a.example/p?q=1#f and http://b.example/x#y.')).toBe(
      'see https://a.example/p and http://b.example/x',
    );
  });

  it.each(UNTOUCHED)('scrubbing leaves %j exactly as it is', (text) => {
    expect(scrubLabelled(text)).toBe(text);
  });

  it('bounds the scan: messages are truncated first, so the worst case stays fast (D15)', () => {
    expect(rules.maxMessageLength).toBe(8192);
    // A wall of harmless labels makes each restart rescan to the clause end; the cap bounds it
    // (about 20 ms on a laptop). The budget is generous so machine load can't flip the result.
    const started = performance.now();
    for (const text of ['a: '.repeat(50_000), `${'a: '.repeat(1_000)}${'b'.repeat(200_000)}`]) scrubLabelled(text);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('drops whole request fields and the Referer header (D17)', () => {
    expect(rules.requestDropFields).toEqual(REQUEST_DROP_FIELDS);
    expect(rules.messageDropFields).toEqual(['params']);
    expect(rules.denyKeyTokens).toContain('fragment');
  });

  it('keeps only the first line of Prisma errors, in the portable regex subset (D4)', () => {
    const patterns = rules.firstLineOnlyExceptionTypes ?? [];
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(NON_PORTABLE_REGEX.filter(([syntax]) => syntax.test(pattern))).toEqual([]);
    }
    expect(firstLineOnly('PrismaClientValidationError')).toBe(true);
    expect(firstLineOnly('TypeError')).toBe(false);
    // Dart's FormatException repeats its input on the second line (convergence review).
    expect(firstLineOnly('FormatException')).toBe(true);
  });

  it('denies the money and free-text field names the schema uses, and their plurals (convergence review)', () => {
    for (const key of ['grossMinor', 'vatMinor', 'paidMinor', 'outstandingMinor', 'reference', 'label', 'metadata']) {
      expect(hasDenyToken(key), key).toBe(true);
    }
    for (const plural of ['phones', 'addresses', 'descriptions', 'titles', 'reasons', 'accounts', 'cards', 'secrets', 'passwords', 'sessions', 'balances', 'prices', 'memos']) {
      expect(hasDenyToken(plural), plural).toBe(true);
    }
  });

  it('holds at least the ADR minimum deny lists, lowercase and without duplicates', () => {
    const tokens = denyTokens();
    const headers = rules.denyHeaders ?? [];
    expect(tokens).toEqual(expect.arrayContaining(MIN_DENY_TOKENS));
    expect(headers).toEqual(expect.arrayContaining(MIN_DENY_HEADERS));
    for (const list of [tokens, headers]) {
      expect(new Set(list).size).toBe(list.length);
      expect(list.every((entry) => entry === entry.toLowerCase())).toBe(true);
    }
    expect(tokens.every((token) => keyTokens(token).length === 1)).toBe(true);
  });

  it('allows only tags and user keys that hold no deny token', () => {
    expect(rules.allowedUserKeys).toEqual(['id']);
    expect((rules.allowedTags ?? []).filter(hasDenyToken)).toEqual([]);
    expect(rules.allowedTags).toEqual(expect.arrayContaining(['surface', 'request_id', 'route', 'release', 'environment']));
  });

  it('keeps safe and always-dropped context keys apart, with device.name only dropped (R6)', () => {
    const safe = rules.safeContextKeys ?? [];
    const dropped = rules.alwaysDropContextKeys ?? [];
    expect(safe.filter((key) => dropped.includes(key))).toEqual([]);
    expect(dropped).toContain('device.name');
    expect(safe).toEqual(expect.arrayContaining(['os.name', 'browser.name', 'runtime.name']));
    for (const key of [...safe, ...dropped]) expect(key).toMatch(/^[a-z_]+\.[a-z_]+$/);
  });

  it('gives every surface ignored-error patterns in the portable regex subset (R7)', () => {
    const ignored = rules.ignoredErrors ?? {};
    expect(Object.keys(ignored).sort()).toEqual([...SURFACES].sort());
    for (const [surface, entries] of Object.entries(ignored)) {
      expect(entries.length, `${surface} has no ignored errors`).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(unknownKeys(entry, ['pattern', 'ignoreCase', 'reason'])).toEqual([]);
        expect(typeof entry.pattern).toBe('string');
        expect(typeof entry.reason).toBe('string');
        if (entry.ignoreCase !== undefined) expect(entry.ignoreCase).toBe(true);
        const pattern = entry.pattern as string;
        expect(() => new RegExp(pattern, entry.ignoreCase ? 'i' : '')).not.toThrow();
        const found = NON_PORTABLE_REGEX.filter(([syntax]) => syntax.test(pattern)).map(([, label]) => label);
        expect(found, `${surface}: ${pattern}`).toEqual([]);
      }
    }
  });

  it('rejects non-portable regex syntax in the portability check itself', () => {
    const flagged = ['(?i)failed', '(?<=x)y', '(?<name>x)', '\\p{L}', '(a)\\1'].filter((pattern) =>
      NON_PORTABLE_REGEX.some(([syntax]) => syntax.test(pattern)),
    );
    expect(flagged).toHaveLength(5);
  });
});

describe('Sentry scrub fixtures (ADR-091)', () => {
  it('has well-formed fixtures for every surface', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(5);
    expect(new Set(fixtures.map((fixture) => fixture.name)).size).toBe(fixtures.length);
    for (const fixture of fixtures) {
      expect(unknownKeys(fixture, FIXTURE_KEYS)).toEqual([]);
      expect(SURFACES).toContain(fixture.surface);
    }
    expect(new Set(fixtures.map((fixture) => fixture.surface))).toEqual(new Set(SURFACES));
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: the expected event has nothing the rules forbid',
    (_name, fixture) => {
      expect(forbiddenIn(fixture.expected)).toEqual([]);
    },
  );

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: the input has something to strip, so the fixture proves something',
    (_name, fixture) => {
      expect(forbiddenIn(fixture.input).length).toBeGreaterThan(0);
    },
  );

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: stack frames, release and environment pass through untouched (R6)',
    (_name, fixture) => {
      expect(frames(fixture.expected)).toEqual(frames(fixture.input));
      expect(fixture.expected.release).toEqual(fixture.input.release);
      expect(fixture.expected.environment).toEqual(fixture.input.environment);
    },
  );

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: allowed content in the input survives unchanged, so no scrubber is forced to over-scrub (R6)',
    (_name, fixture) => {
      const { input, expected } = fixture;
      const inputTags = isObject(input.tags) ? input.tags : {};
      const expectedTags = isObject(expected.tags) ? expected.tags : {};
      for (const [key, value] of Object.entries(inputTags)) {
        if ((rules.allowedTags ?? []).includes(key)) expect(expectedTags[key], `tags.${key}`).toEqual(value);
      }
      if (isObject(input.user) && 'id' in input.user) expect(isObject(expected.user) && expected.user.id).toEqual(input.user.id);
      const inputExtra = isObject(input.extra) ? input.extra : {};
      const expectedExtra = isObject(expected.extra) ? expected.extra : {};
      for (const key of Object.keys(inputExtra)) {
        if (!hasDenyToken(key)) expect(expectedExtra[key], `extra.${key}`).toEqual(inputExtra[key]);
      }
      for (const path of rules.safeContextKeys ?? []) {
        const [context, key] = path.split('.');
        const value = contextValue(input, context, key);
        if (value !== undefined) expect(contextValue(expected, context, key), `contexts.${path}`).toEqual(value);
      }
    },
  );

  it('proves whole-token matching keeps debug fields: a frame filename and os.name survive (R6)', () => {
    const keptFilename = allExpected().some((event) =>
      frames(event).some((list) => Array.isArray(list) && list.some((frame) => isObject(frame) && 'filename' in frame)),
    );
    expect(keptFilename).toBe(true);
    expect(allExpected().some((event) => contextValue(event, 'os', 'name') !== undefined)).toBe(true);
    expect(allExpected().some((event) => contextValue(event, 'browser', 'name') !== undefined)).toBe(true);
  });

  it('proves device.name, client_name and clientName are dropped (R6)', () => {
    expect(allInputs().some((event) => contextValue(event, 'device', 'name') !== undefined)).toBe(true);
    expect(allExpected().every((event) => contextValue(event, 'device', 'name') === undefined)).toBe(true);
    for (const key of ['client_name', 'clientName']) {
      expect(allInputs().some((event) => extraKeys(event).includes(key)), `no input carries extra.${key}`).toBe(true);
      expect(allExpected().every((event) => !extraKeys(event).includes(key))).toBe(true);
    }
  });

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: the contract\'s own scrub reproduces every expected exception value (cycle-3 review)',
    (_name, fixture) => {
      const values = (event: JsonObject) =>
        isObject(event.exception) && Array.isArray(event.exception.values) ? event.exception.values : [];
      values(fixture.input).forEach((value, index) => {
        if (!isObject(value) || typeof value.value !== 'string') return;
        const text = firstLineOnly(value.type) ? value.value.split('\n')[0] : value.value;
        const expected = values(fixture.expected)[index];
        expect(isObject(expected) && expected.value, `exception.values[${index}]`).toBe(scrubLabelled(text));
      });
    },
  );

  it.each(fixtures.map((fixture) => [fixture.name, fixture] as const))(
    '%s: the contract\'s own scrub reproduces every expected message and breadcrumb message (convergence review)',
    (_name, fixture) => {
      const inputMessage = messageText(fixture.input);
      if (typeof inputMessage === 'string') expect(messageText(fixture.expected)).toBe(scrubLabelled(inputMessage));
      // Console breadcrumbs are dropped whole, so compare the kept ones in order.
      const crumbs = (event: JsonObject) =>
        (isObject(event.breadcrumbs) && Array.isArray(event.breadcrumbs.values) ? event.breadcrumbs.values : []).filter(
          (crumb) => isObject(crumb) && crumb.category !== 'console',
        );
      const expectedCrumbs = crumbs(fixture.expected);
      crumbs(fixture.input).forEach((crumb, index) => {
        if (!isObject(crumb) || typeof crumb.message !== 'string') return;
        const expected = expectedCrumbs[index];
        expect(isObject(expected) && expected.message, `breadcrumb ${index}`).toBe(scrubLabelled(crumb.message));
      });
    },
  );

  it('covers top-level messages in both shapes and a dirty breadcrumb message (convergence review)', () => {
    expect(allInputs().some((event) => typeof event.message === 'string')).toBe(true);
    expect(allInputs().some((event) => isObject(event.message) && typeof event.message.formatted === 'string')).toBe(true);
    const dirtyCrumb = allInputs().some((event) =>
      (isObject(event.breadcrumbs) && Array.isArray(event.breadcrumbs.values) ? event.breadcrumbs.values : []).some(
        (crumb) => isObject(crumb) && crumb.category !== 'console' && freeTextProblems('crumb', crumb.message).length > 0,
      ),
    );
    expect(dirtyCrumb).toBe(true);
  });

  it('proves labelled values in all three forms are filtered, not dropped (D4)', () => {
    const exceptionText = allExpected().map((event) => JSON.stringify(event.exception ?? null)).join('\n');
    expect(exceptionText).toContain(`=${FILTERED}`);
    expect(exceptionText).toContain(`: ${FILTERED}`);
    expect(exceptionText).toContain(`\\"email\\":\\"${FILTERED}\\"`);
  });

  it('proves a setup token in a URL fragment never leaves, even in a navigation breadcrumb (D3)', () => {
    const navigation = (event: JsonObject) =>
      (isObject(event.breadcrumbs) && Array.isArray(event.breadcrumbs.values) ? event.breadcrumbs.values : []).filter(
        (crumb) => isObject(crumb) && crumb.category === 'navigation',
      );
    expect(allInputs().some((event) => JSON.stringify(navigation(event)).includes('/setup#'))).toBe(true);
    expect(allExpected().every((event) => !JSON.stringify(event).includes('#'))).toBe(true);
  });

  it('proves a Prisma error keeps only its first line, and frame locals are dropped (D4, D10)', () => {
    const prisma = fixtures.filter((fixture) => JSON.stringify(fixture.input.exception ?? null).includes('PrismaClientValidationError'));
    expect(prisma.length).toBeGreaterThan(0);
    expect(JSON.stringify(prisma.map((fixture) => fixture.input))).toContain('\\n');
    expect(allInputs().some((event) => JSON.stringify(event.exception ?? null).includes('"vars"'))).toBe(true);
  });

  it('proves lowercase compound keys are dropped (D11)', () => {
    const inputKeys = allInputs().flatMap((event) => extraKeys(event));
    for (const key of ['apikey', 'phonenumber']) {
      expect(inputKeys, `no input carries extra.${key}`).toContain(key);
      expect(allExpected().every((event) => !extraKeys(event).includes(key))).toBe(true);
    }
  });
});
