// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * MUT-153 / ADR-090: `docs/analytics/events.json` is the only list of what the landing page,
 * the portal and the phone app may send to PostHog. These rules keep it anonymous: no free
 * text, nothing that can carry an amount, a name or an identifier, no errors (Sentry owns
 * them, MUT-146) and nothing from the local app, desktop or server (ADR-024).
 */

const SURFACES = ['landing', 'portal', 'ios', 'android'] as const;
const FORBIDDEN_EMITTERS = ['server', 'web', 'desktop'];
const PROPERTY_TYPES = ['enum', 'boolean', 'integer', 'iso4217', 'semver'];
const POSTHOG_BUILT_INS = ['$pageview'];
const SHARED_PROPERTIES = ['surface', 'app_version', 'locale'];
/** Whole snake_case tokens a property name may never contain, so `paid` passes and `client_id` fails. */
const BANNED_PROPERTY_TOKENS = [
  'amount', 'price', 'total', 'sum', 'balance', 'name', 'email', 'phone', 'address', 'iban', 'account',
  'note', 'notes', 'description', 'title', 'text', 'message', 'comment', 'client', 'customer', 'vendor',
  'user', 'id', 'ip', 'url',
];
const ERROR_TOKENS = ['error', 'errors', 'exception', 'crash'];
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+$/;

type Property = { type?: unknown; values?: unknown; description?: unknown };
type Contract = {
  version?: unknown;
  sharedProperties?: Record<string, Property>;
  events?: Record<string, { emitters?: unknown; properties?: Record<string, Property>; description?: unknown }>;
};

const tokens = (name: string) => name.split('_');

function propertyProblems(where: string, name: string, property: Property): string[] {
  const problems: string[] = [];
  if (!SNAKE_CASE.test(name)) problems.push(`${where}: property "${name}" is not snake_case`);
  const banned = tokens(name).filter((token) => BANNED_PROPERTY_TOKENS.includes(token));
  if (banned.length > 0) problems.push(`${where}: property "${name}" uses banned token "${banned.join('", "')}"`);
  if (!PROPERTY_TYPES.includes(property.type as string)) {
    problems.push(`${where}: property "${name}" has type "${String(property.type)}"; allowed: ${PROPERTY_TYPES.join(', ')}`);
  }
  if (property.type === 'enum') {
    const values = property.values;
    const valid = Array.isArray(values) && values.length > 0 && values.every((v) => typeof v === 'string' && SNAKE_CASE.test(v));
    if (!valid || new Set(values as string[]).size !== (values as string[]).length) {
      problems.push(`${where}: enum "${name}" needs unique snake_case values`);
    }
  } else if (property.values !== undefined) {
    problems.push(`${where}: only an enum may list values ("${name}")`);
  }
  return problems;
}

function emitterProblems(event: string, emitters: unknown): string[] {
  if (!Array.isArray(emitters) || emitters.length === 0) return [`${event}: needs at least one emitter`];
  const problems: string[] = [];
  for (const emitter of emitters) {
    if (FORBIDDEN_EMITTERS.includes(emitter)) problems.push(`${event}: "${emitter}" may never emit (ADR-024, MUT-153 P2)`);
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

/** Every way `contract` breaks ADR-090's rules; empty when it is valid. */
function contractProblems(contract: Contract): string[] {
  const problems: string[] = [];
  if (typeof contract.version !== 'string' || !SEMVER.test(contract.version)) problems.push('version must be x.y.z');

  const shared = contract.sharedProperties ?? {};
  for (const name of SHARED_PROPERTIES) if (!(name in shared)) problems.push(`shared property "${name}" is missing`);
  for (const [name, property] of Object.entries(shared)) problems.push(...propertyProblems('shared', name, property));
  const surface = shared.surface;
  if (surface && JSON.stringify(surface.values) !== JSON.stringify(SURFACES)) {
    problems.push(`shared "surface" must be exactly ${SURFACES.join(', ')}`);
  }

  const events = contract.events ?? {};
  if (Object.keys(events).length === 0) problems.push('no events');
  for (const [event, definition] of Object.entries(events)) {
    problems.push(...eventNameProblems(event), ...emitterProblems(event, definition.emitters));
    if (typeof definition.description !== 'string' || definition.description.trim() === '') {
      problems.push(`${event}: needs a description`);
    }
    for (const [name, property] of Object.entries(definition.properties ?? {})) {
      if (name in shared) problems.push(`${event}: "${name}" repeats a shared property`);
      problems.push(...propertyProblems(event, name, property));
    }
  }
  return problems;
}

const contract = JSON.parse(readFileSync('docs/analytics/events.json', 'utf8')) as Contract;

/** A valid contract to break one rule at a time. */
function validContract(): Contract {
  return {
    version: '1.0.0',
    sharedProperties: {
      surface: { type: 'enum', values: [...SURFACES] },
      app_version: { type: 'semver' },
      locale: { type: 'enum', values: ['ar', 'en'] },
    },
    events: {
      income_recorded: {
        emitters: ['ios', 'android'],
        description: 'An income entry was saved on the phone.',
        properties: { currency: { type: 'iso4217' }, paid: { type: 'boolean' } },
      },
    },
  };
}

function withEvent(event: string, definition: NonNullable<Contract['events']>[string]): Contract {
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
      income_recorded: ['ios', 'android'],
      expense_recorded: ['ios', 'android'],
      payment_recorded: ['ios', 'android'],
    });
  });
});

describe('contract rules', () => {
  it('accepts the valid base contract, including a property named paid', () => {
    expect(contractProblems(validContract())).toEqual([]);
  });

  it.each(['1.0', 'v1.0.0', '', undefined])('rejects version %j', (version) => {
    expect(contractProblems({ ...validContract(), version })).toContain('version must be x.y.z');
  });

  it.each(SHARED_PROPERTIES)('requires the shared property %s', (name) => {
    const base = validContract();
    const shared = { ...base.sharedProperties };
    delete shared[name];
    expect(contractProblems({ ...base, sharedProperties: shared })).toContain(`shared property "${name}" is missing`);
  });

  it('requires surface to be exactly the four tracked surfaces', () => {
    const base = validContract();
    const sharedProperties = { ...base.sharedProperties, surface: { type: 'enum', values: ['landing', 'portal', 'ios', 'android', 'web'] } };
    expect(contractProblems({ ...base, sharedProperties })).toContain('shared "surface" must be exactly landing, portal, ios, android');
  });

  it.each(['IncomeRecorded', 'income-recorded', '$autocapture', '$identify'])('rejects the event name %s', (event) => {
    expect(contractProblems(withEvent(event, { emitters: ['ios'], description: 'x' })).join('\n')).toMatch(/event names are snake_case/);
  });

  it.each(['$exception', 'sync_error', 'app_crash', 'upload_exception'])('rejects the error event %s', (event) => {
    expect(contractProblems(withEvent(event, { emitters: ['ios'], description: 'x' })).join('\n')).toMatch(/errors go to Sentry/);
  });

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

  it.each(['amount_minor', 'client_id', 'customer_name', 'email', 'note', 'vendor', 'total', 'user_id', 'page_url'])(
    'bans the property %s by whole token',
    (name) => {
      expect(contractProblems(withProperty(name, { type: 'boolean' })).join('\n')).toMatch(/uses banned token/);
    },
  );

  it.each(['paid', 'currency', 'prompt', 'cta', 'is_first'])('allows the property %s', (name) => {
    expect(contractProblems(withProperty(name, { type: 'boolean' }))).toEqual([]);
  });

  it.each(['string', 'text', 'object', undefined])('refuses the free-form type %j', (type) => {
    expect(contractProblems(withProperty('prompt', { type })).join('\n')).toMatch(/has type/);
  });

  it.each([[[]], [undefined], [['first_run', 'first_run']], [['First Run']]])('needs unique snake_case enum values (%j)', (values) => {
    expect(contractProblems(withProperty('prompt', { type: 'enum', values })).join('\n')).toMatch(/needs unique snake_case values/);
  });

  it('allows values only on an enum', () => {
    expect(contractProblems(withProperty('paid', { type: 'boolean', values: ['yes'] })).join('\n')).toMatch(/only an enum may list values/);
  });

  it('refuses an event property that repeats a shared one', () => {
    expect(contractProblems(withProperty('locale', { type: 'enum', values: ['ar'] }))).toContain('client_created: "locale" repeats a shared property');
  });
});
