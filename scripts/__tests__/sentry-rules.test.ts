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
 * sha256 of both files per version. Append-only: changing either file means bumping the version
 * and adding a row, so the Flutter app's byte copy (MUT-151) can't silently differ.
 */
const PINNED_VERSIONS: Record<string, { rules: string; fixtures: string }> = {
  '1.0.0': {
    rules: '8d7afe0e8f433a0381102d1fb00046fabf8a9bfb6b215c5fb04f0f9a62991749',
    fixtures: '69ccf2841955b67b4e58a5638baed70846bfd1b54e456a515a0163719a42d2a1',
  },
};

const SURFACES = ['api', 'portal', 'landing', 'capture-app'];
const FORBIDDEN_SURFACES = ['web', 'desktop', 'app', 'local'];
const RULES_KEYS = [
  'version', 'region', 'surfaces', 'sdk', 'serverReportsStatusAtLeast', 'denyHeaders', 'denyKeyTokens',
  'allowedTags', 'allowedUserKeys', 'safeContextKeys', 'alwaysDropContextKeys', 'ignoredErrors', 'orgSettings',
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
};
/** ADR-091 rule 3: the minimum each list must hold. A list may grow, never drop these. */
const MIN_DENY_TOKENS = [
  'amount', 'total', 'balance', 'name', 'email', 'phone', 'note', 'description', 'memo', 'address', 'iban',
  'account', 'token', 'password', 'secret', 'key', 'pepper', 'session', 'cookie', 'authorization', 'body', 'query',
];
const MIN_DENY_HEADERS = ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'idempotency-key', 'x-forwarded-for'];
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

/** ADR-091 rule 3 (R6): split a key on `_`, `-`, `.`, spaces and camelCase humps, lowercased. */
function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
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

/** `key=value` pairs in a free-text message whose key holds a deny token must read `key=[Filtered]`. */
function labelledValueProblems(where: string, text: Json | undefined): string[] {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/([A-Za-z_][\w.-]*)=(\S+)/g)]
    .filter(([, key, value]) => hasDenyToken(key) && value !== FILTERED)
    .map(([pair]) => `${where}: "${pair}" is not filtered`);
}

function requestProblems(request: Json | undefined): string[] {
  if (!isObject(request)) return [];
  const problems = ['data', 'cookies', 'query_string']
    .filter((field) => field in request)
    .map((field) => `request.${field} is present`);
  if (typeof request.url === 'string' && request.url.includes('?')) problems.push('request.url keeps a query string');
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
    if (typeof data.url === 'string' && data.url.includes('?')) problems.push(`${where}.data.url keeps a query string`);
    return [...problems, ...deniedKeyPaths(data, `${where}.data`), ...labelledValueProblems(where, crumb.message)];
  });
}

function exceptionProblems(exception: Json | undefined): string[] {
  const values = isObject(exception) && Array.isArray(exception.values) ? exception.values : [];
  return values.flatMap((value, index) =>
    isObject(value) ? labelledValueProblems(`exception.values[${index}].value`, value.value) : [],
  );
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
    ...labelledValueProblems('message', event.message),
  ];
}

const frames = (event: JsonObject) => {
  const values = isObject(event.exception) && Array.isArray(event.exception.values) ? event.exception.values : [];
  return values.map((value) => (isObject(value) && isObject(value.stacktrace) ? value.stacktrace.frames : undefined));
};

const allExpected = () => fixtures.map((fixture) => fixture.expected);
const allInputs = () => fixtures.map((fixture) => fixture.input);
const contextValue = (event: JsonObject, context: string, key: string) =>
  isObject(event.contexts) && isObject(event.contexts[context]) ? event.contexts[context][key] : undefined;
const extraKeys = (event: JsonObject) => (isObject(event.extra) ? Object.keys(event.extra) : []);

describe('keyTokens', () => {
  it.each([
    ['client_name', ['client', 'name']],
    ['clientName', ['client', 'name']],
    ['x-api-key', ['x', 'api', 'key']],
    ['os.name', ['os', 'name']],
    ['HTTPStatus', ['http', 'status']],
    ['filename', ['filename']],
    ['keyboard', ['keyboard']],
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

  it('requires the SDK options that keep reports content-free', () => {
    expect(rules.sdk).toEqual(REQUIRED_SDK);
    expect(rules.serverReportsStatusAtLeast).toBe(500);
  });

  it('turns on every org privacy setting the settings script applies (R9)', () => {
    expect(rules.orgSettings).toEqual({ dataScrubber: true, dataScrubberDefaults: true, scrubIPAddresses: true });
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

  it('proves a labelled value in an exception message is filtered, not dropped', () => {
    const filtered = allExpected().some((event) =>
      JSON.stringify(event.exception ?? null).includes(`=${FILTERED}`),
    );
    expect(filtered).toBe(true);
  });
});
