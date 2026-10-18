// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { SUPPORTED_CURRENCIES } from '../../server/src/money';

/**
 * MUT-153 / ADR-090: `docs/analytics/events.json` is the only list of what the landing page,
 * the portal and the phone app may send to PostHog. These rules keep it anonymous: no free
 * text, nothing that can carry an amount, a name or an identifier, no errors (Sentry owns
 * them, MUT-146) and nothing from the local app, desktop or server (ADR-024).
 */

const CONTRACT_PATH = 'docs/analytics/events.json';
/**
 * sha256 of events.json per version. Append-only: changing the contract means bumping its
 * version and adding a row, so a copy pinned by version (the Flutter app's) can't silently
 * differ from what this repo calls that version.
 */
const PINNED_VERSIONS: Record<string, string> = {
  '1.1.0': '2654fb1f1dde9896c359d58356c478181c0f8b8f7fa43a1b56f1d6b6986ad099',
  '1.2.0': 'cf7e4022ee0ce261ebf945c32e5374eafc543467d6b2902922507fb8265e8ff7',
};

const SURFACES = ['landing', 'portal', 'ios', 'android'] as const;
const FORBIDDEN_EMITTERS = ['server', 'web', 'desktop'];
/** `currency` means one of the contract's top-level `currencies`, which mirror the hosted API's list. */
const PROPERTY_TYPES = ['enum', 'boolean', 'integer', 'currency', 'semver'];
const CURRENCY_CODE = /^[A-Z]{3}$/;
const POSTHOG_BUILT_INS = ['$pageview'];
const SHARED_PROPERTIES = ['surface', 'app_version', 'locale'];
/** `semver` is a version number, never a way to smuggle digits: only the build version may use it. */
const SEMVER_PROPERTIES = ['app_version'];
const CONTRACT_KEYS = ['version', 'currencies', 'sharedProperties', 'events'];
const EVENT_KEYS = ['emitters', 'description', 'properties'];
const PROPERTY_KEYS = ['type', 'values', 'description'];
/** Whole snake_case tokens a property name may never contain, so `paid` passes and `client_id` fails. */
const BANNED_PROPERTY_TOKENS = [
  'amount', 'amounts', 'price', 'total', 'sum', 'balance', 'cost', 'costs', 'fee', 'fees', 'value', 'cents', 'minor',
  'name', 'email', 'phone', 'address', 'iban', 'account', 'note', 'notes', 'description', 'title', 'text', 'message',
  'comment', 'client', 'customer', 'vendor', 'user', 'id', 'ids', 'uuid', 'ip', 'url', 'token',
];
const ERROR_TOKENS = ['error', 'errors', 'exception', 'exceptions', 'crash', 'crashed', 'crashes', 'failed', 'failure'];
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

type Property = { type?: unknown; values?: unknown; description?: unknown; [key: string]: unknown };
type EventDefinition = { emitters?: unknown; properties?: Record<string, Property>; description?: unknown; [key: string]: unknown };
type Contract = {
  version?: unknown;
  currencies?: unknown;
  sharedProperties?: Record<string, Property>;
  events?: Record<string, EventDefinition>;
  [key: string]: unknown;
};

const tokens = (name: string) => name.split('_');
const unknownKeys = (value: object, allowed: string[]) => Object.keys(value).filter((key) => !allowed.includes(key));

function valueProblems(where: string, name: string, property: Property): string[] {
  if (property.type === 'enum') {
    const values = property.values;
    const valid = Array.isArray(values) && values.length > 0 && values.every((v) => typeof v === 'string' && SNAKE_CASE.test(v));
    return valid && new Set(values as string[]).size === (values as string[]).length
      ? []
      : [`${where}: enum "${name}" needs unique snake_case values`];
  }
  return property.values === undefined ? [] : [`${where}: only an enum may list values ("${name}")`];
}

function propertyProblems(where: string, name: string, property: Property): string[] {
  const problems: string[] = [];
  if (!SNAKE_CASE.test(name)) problems.push(`${where}: property "${name}" is not snake_case`);
  const banned = tokens(name).filter((token) => BANNED_PROPERTY_TOKENS.includes(token));
  if (banned.length > 0) problems.push(`${where}: property "${name}" uses banned token "${banned.join('", "')}"`);
  if (!PROPERTY_TYPES.includes(property.type as string)) {
    problems.push(`${where}: property "${name}" has type "${String(property.type)}"; allowed: ${PROPERTY_TYPES.join(', ')}`);
  }
  if (property.type === 'semver' && !SEMVER_PROPERTIES.includes(name)) {
    problems.push(`${where}: only ${SEMVER_PROPERTIES.join(', ')} may be semver ("${name}")`);
  }
  for (const key of unknownKeys(property, PROPERTY_KEYS)) problems.push(`${where}: property "${name}" has unknown key "${key}"`);
  return [...problems, ...valueProblems(where, name, property)];
}

function emitterProblems(event: string, emitters: unknown): string[] {
  if (!Array.isArray(emitters) || emitters.length === 0) return [`${event}: needs at least one emitter`];
  const problems: string[] = [];
  for (const emitter of emitters) {
    if (FORBIDDEN_EMITTERS.includes(emitter)) problems.push(`${event}: "${emitter}" may never emit (ADR-024, ADR-090)`);
    else if (!SURFACES.includes(emitter)) problems.push(`${event}: unknown emitter "${String(emitter)}"`);
  }
  if (new Set(emitters).size !== emitters.length) problems.push(`${event}: duplicate emitter`);
  return problems;
}

function eventNameProblems(event: string): string[] {
  const problems: string[] = [];
  if (event.startsWith('$') ? !POSTHOG_BUILT_INS.includes(event) : !SNAKE_CASE.test(event)) {
    problems.push(`${event}: event names are snake_case (PostHog built-ins allowed: ${POSTHOG_BUILT_INS.join(', ')})`);
  }
  if (tokens(event.replace(/^\$/, '')).some((token) => ERROR_TOKENS.includes(token))) {
    problems.push(`${event}: errors go to Sentry, not PostHog (MUT-146)`);
  }
  return problems;
}

function eventProblems(event: string, definition: EventDefinition, shared: Record<string, Property>): string[] {
  const problems = [...eventNameProblems(event), ...emitterProblems(event, definition.emitters)];
  if (typeof definition.description !== 'string' || definition.description.trim() === '') {
    problems.push(`${event}: needs a description`);
  }
  for (const key of unknownKeys(definition, EVENT_KEYS)) problems.push(`${event}: unknown key "${key}"`);
  for (const [name, property] of Object.entries(definition.properties ?? {})) {
    if (name in shared) problems.push(`${event}: "${name}" repeats a shared property`);
    problems.push(...propertyProblems(event, name, property));
  }
  return problems;
}

function sharedProblems(shared: Record<string, Property>): string[] {
  const problems: string[] = [];
  for (const name of SHARED_PROPERTIES) if (!(name in shared)) problems.push(`shared property "${name}" is missing`);
  for (const name of unknownKeys(shared, SHARED_PROPERTIES)) problems.push(`shared property "${name}" is not allowed`);
  for (const [name, property] of Object.entries(shared)) problems.push(...propertyProblems('shared', name, property));
  if (shared.surface && JSON.stringify(shared.surface.values) !== JSON.stringify(SURFACES)) {
    problems.push(`shared "surface" must be exactly ${SURFACES.join(', ')}`);
  }
  return problems;
}

/** Every way `contract` breaks ADR-090's rules; empty when it is valid. */
function contractProblems(contract: Contract): string[] {
  const problems: string[] = [];
  if (typeof contract.version !== 'string' || !SEMVER.test(contract.version)) problems.push('version must be x.y.z');
  for (const key of unknownKeys(contract, CONTRACT_KEYS)) problems.push(`unknown top-level key "${key}"`);
  const currencies = contract.currencies;
  const validCurrencies = Array.isArray(currencies) && currencies.length > 0 && currencies.every((c) => typeof c === 'string' && CURRENCY_CODE.test(c));
  if (!validCurrencies || new Set(currencies as string[]).size !== (currencies as string[]).length) {
    problems.push('currencies must be unique three-letter codes');
  }
  const shared = contract.sharedProperties ?? {};
  problems.push(...sharedProblems(shared));
  const events = contract.events ?? {};
  if (Object.keys(events).length === 0) problems.push('no events');
  for (const [event, definition] of Object.entries(events)) problems.push(...eventProblems(event, definition, shared));
  return problems;
}

const compareVersions = (a: string, b: string) => {
  const [x, y] = [a, b].map((v) => v.split('.').map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const raw = readFileSync(CONTRACT_PATH, 'utf8');
const contract = JSON.parse(raw) as Contract;

/** A valid contract to break one rule at a time. */
function validContract(): Contract {
  return {
    version: '1.0.0',
    currencies: ['USD', 'ILS'],
    sharedProperties: {
      surface: { type: 'enum', values: [...SURFACES] },
      app_version: { type: 'semver' },
      locale: { type: 'enum', values: ['ar', 'en'] },
    },
    events: {
      income_recorded: {
        emitters: ['portal', 'ios', 'android'],
        description: 'An income entry was saved.',
        properties: { currency: { type: 'currency' }, paid: { type: 'boolean' } },
      },
    },
  };
}

function withEvent(event: string, definition: EventDefinition): Contract {
  const base = validContract();
  return { ...base, events: { ...base.events, [event]: definition } };
}

function withProperty(name: string, property: Property): Contract {
  return withEvent('client_created', { emitters: ['ios'], description: 'x', properties: { [name]: property } });
}

describe('docs/analytics/events.json (ADR-090)', () => {
  it('follows every contract rule', () => {
    expect(contractProblems(contract)).toEqual([]);
  });

  it('lists the events the MUT-152 funnels are built on, with their emitters', () => {
    const emitters = Object.fromEntries(Object.entries(contract.events ?? {}).map(([event, d]) => [event, d.emitters]));
    expect(emitters).toEqual({
      $pageview: ['landing'],
      landing_cta_clicked: ['landing'],
      app_first_opened: ['ios', 'android'],
      portal_opened: ['portal'],
      analytics_opted_in: ['portal', 'ios', 'android'],
      analytics_opted_out: ['portal', 'ios', 'android'],
      client_created: ['ios', 'android'],
      income_recorded: ['portal', 'ios', 'android'],
      expense_recorded: ['portal', 'ios', 'android'],
      payment_recorded: ['portal', 'ios', 'android'],
    });
  });

  it('is pinned under its version, so a content change needs a version bump (R2)', () => {
    const version = contract.version as string;
    expect(PINNED_VERSIONS[version]).toBe(createHash('sha256').update(raw).digest('hex'));
    expect([...Object.keys(PINNED_VERSIONS)].sort(compareVersions).at(-1)).toBe(version);
    expect(new Set(Object.values(PINNED_VERSIONS)).size).toBe(Object.keys(PINNED_VERSIONS).length);
  });

  it('lists exactly the currencies the hosted API accepts, so every guard reads them from the contract', () => {
    expect([...(contract.currencies as string[])].sort()).toEqual([...SUPPORTED_CURRENCIES].sort());
  });
});

describe('contract rules', () => {
  it('accepts the valid base contract, including a property named paid', () => {
    expect(contractProblems(validContract())).toEqual([]);
  });

  it.each(['1.0', 'v1.0.0', '', undefined])('rejects version %j', (version) => {
    expect(contractProblems({ ...validContract(), version })).toContain('version must be x.y.z');
  });

  it.each([[[]], [undefined], [['usd']], [['USD', 'USD']], [['DOLLAR']]])('rejects the currencies list %j', (currencies) => {
    expect(contractProblems({ ...validContract(), currencies })).toContain('currencies must be unique three-letter codes');
  });

  it('rejects an unknown top-level key', () => {
    expect(contractProblems({ ...validContract(), notes: 'x' })).toContain('unknown top-level key "notes"');
  });

  it.each(SHARED_PROPERTIES)('requires the shared property %s', (name) => {
    const base = validContract();
    const shared = { ...base.sharedProperties };
    delete shared[name];
    expect(contractProblems({ ...base, sharedProperties: shared })).toContain(`shared property "${name}" is missing`);
  });

  it('refuses a fourth shared property', () => {
    const base = validContract();
    const sharedProperties = { ...base.sharedProperties, theme: { type: 'enum', values: ['dark'] } };
    expect(contractProblems({ ...base, sharedProperties })).toContain('shared property "theme" is not allowed');
  });

  it('requires surface to be exactly the four tracked surfaces', () => {
    const base = validContract();
    const sharedProperties = { ...base.sharedProperties, surface: { type: 'enum', values: ['landing', 'portal', 'ios', 'android', 'web'] } };
    expect(contractProblems({ ...base, sharedProperties })).toContain('shared "surface" must be exactly landing, portal, ios, android');
  });

  it.each(['IncomeRecorded', 'income-recorded', '$autocapture', '$identify', '$pageleave', '$opt_in', '$screen'])(
    'rejects the event name %s',
    (event) => {
      expect(contractProblems(withEvent(event, { emitters: ['ios'], description: 'x' })).join('\n')).toMatch(/event names are snake_case/);
    },
  );

  it.each(['$exception', 'sync_error', 'sync_errors', 'app_crash', 'app_crashed', 'app_crashes', 'upload_exception', 'exceptions_seen', 'upload_failed', 'sync_failure'])(
    'rejects the error event %s',
    (event) => {
      expect(contractProblems(withEvent(event, { emitters: ['ios'], description: 'x' })).join('\n')).toMatch(/errors go to Sentry/);
    },
  );

  it.each([[[]], [undefined], ['ios']])('requires an emitter list (%j)', (emitters) => {
    expect(contractProblems(withEvent('portal_opened', { emitters, description: 'x' }))).toContain('portal_opened: needs at least one emitter');
  });

  it.each(FORBIDDEN_EMITTERS)('refuses %s as an emitter', (emitter) => {
    expect(contractProblems(withEvent('portal_opened', { emitters: [emitter], description: 'x' })).join('\n')).toMatch(/may never emit/);
  });

  it('refuses unknown and duplicate emitters', () => {
    const problems = contractProblems(withEvent('portal_opened', { emitters: ['portal', 'portal', 'watch'], description: 'x' }));
    expect(problems).toEqual(expect.arrayContaining(['portal_opened: unknown emitter "watch"', 'portal_opened: duplicate emitter']));
  });

  it.each(['', '   ', undefined])('requires a description (%j)', (description) => {
    expect(contractProblems(withEvent('portal_opened', { emitters: ['portal'], description }))).toContain('portal_opened: needs a description');
  });

  it('refuses an unknown key on an event', () => {
    expect(contractProblems(withEvent('portal_opened', { emitters: ['portal'], description: 'x', sampling: 0.5 }))).toContain(
      'portal_opened: unknown key "sampling"',
    );
  });

  it.each(['amount_minor', 'client_id', 'customer_name', 'email', 'note', 'vendor', 'total', 'user_id', 'page_url'])(
    'bans the property %s by whole token',
    (name) => {
      expect(contractProblems(withProperty(name, { type: 'boolean' })).join('\n')).toMatch(/uses banned token/);
    },
  );

  it.each(BANNED_PROPERTY_TOKENS.map((token) => [`is_${token}`, token]))('bans %s on its single banned token %s', (name, token) => {
    expect(contractProblems(withProperty(name, { type: 'boolean' }))).toContain(`client_created: property "${name}" uses banned token "${token}"`);
  });

  it.each(['amounts', 'minor_units', 'cost', 'fee', 'value', 'ids', 'cents'])('refuses the integer property %s that could carry money or an id', (name) => {
    expect(contractProblems(withProperty(name, { type: 'integer' })).join('\n')).toMatch(/uses banned token/);
  });

  it.each(['paid', 'prompt', 'cta', 'is_first'])('allows the property %s', (name) => {
    expect(contractProblems(withProperty(name, { type: 'boolean' }))).toEqual([]);
  });

  it('allows a count-like integer and a currency', () => {
    expect(contractProblems(withProperty('entry_count', { type: 'integer' }))).toEqual([]);
    expect(contractProblems(withProperty('currency', { type: 'currency' }))).toEqual([]);
  });

  it.each(['string', 'text', 'object', 'iso4217', undefined])('refuses the type %j', (type) => {
    expect(contractProblems(withProperty('prompt', { type })).join('\n')).toMatch(/has type/);
  });

  it('allows semver only on app_version', () => {
    expect(contractProblems(withProperty('build', { type: 'semver' }))).toContain('client_created: only app_version may be semver ("build")');
  });

  it.each([[[]], [undefined], [['first_run', 'first_run']], [['First Run']]])('needs unique snake_case enum values (%j)', (values) => {
    expect(contractProblems(withProperty('prompt', { type: 'enum', values })).join('\n')).toMatch(/needs unique snake_case values/);
  });

  it('allows values only on an enum', () => {
    expect(contractProblems(withProperty('paid', { type: 'boolean', values: ['yes'] })).join('\n')).toMatch(/only an enum may list values/);
    expect(contractProblems(withProperty('currency', { type: 'currency', values: ['GBP'] })).join('\n')).toMatch(/only an enum may list values/);
  });

  it('refuses an unknown key on a property', () => {
    expect(contractProblems(withProperty('paid', { type: 'boolean', pii: false }))).toContain('client_created: property "paid" has unknown key "pii"');
  });

  it('refuses an event property that repeats a shared one', () => {
    expect(contractProblems(withProperty('locale', { type: 'enum', values: ['ar'] }))).toContain('client_created: "locale" repeats a shared property');
  });
});
