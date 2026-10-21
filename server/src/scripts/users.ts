import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { MAX_PROFILE_OWNERS } from '../co-owners.js';

/**
 * Operator CLI for hosted-portal users (MUT-37, ADR-037). Talks to the admin
 * API of a running service, like `npm run provision`. There is no other way to
 * create a user, grant access or reset a password — by design.
 *
 *   npm run provision:user  -- --url https://<portal origin> --email nour@firm.ps --name "Nour Haddad" --organization-id <uuid> [--locale en] [--valid-hours 72]  (Arabic by default, MUT-209)
 *   npm run provision:user  -- --email solo@me.ps --name "Solo" --currency ILS --timezone Asia/Jerusalem   (no firm; MUT-120)
 *   npm run grant:user      -- --email nour@firm.ps --organization-id <uuid> [--role owner]   (MUT-373: a co-owner)
 *   npm run revoke:user     -- --email nour@firm.ps --organization-id <uuid>
 *   npm run rotate:password -- --email nour@firm.ps [--valid-hours 72] [--lock]
 *   npm run disable:user    -- --email nour@firm.ps
 *   npm run enable:user     -- --email nour@firm.ps
 *   npm run revoke:sessions -- --email nour@firm.ps   (sign out everywhere)
 *   npm run terms:report                                        (MUT-354: who is behind the current terms)
 *   npm run firm:requests                                       (MUT-300: pending requests for firm features)
 *   npm run firm:enable  -- --organization-id <uuid> [--owner nour@firm.ps,omar@firm.ps]
 *   npm run firm:disable -- --organization-id <uuid>
 *   npm run firm:decline -- --organization-id <uuid>
 *
 * MUT-300 (ADR-099): `firm-enable` turns firm features on in place. An owned
 * Business profile stays its owner's, who becomes OWNER; an operator firm
 * needs at least one --owner, each already a member. Everyone else becomes
 * BOOKKEEPER.
 *
 * MUT-235 (ADR-088): nobody here ever sees a password. `create` and `rotate`
 * print a one-time setup link instead, on a line of its own after a "shown
 * once" line; the person sets their own password through it. `rotate` leaves
 * the current password working until the link is used; `rotate --lock` (a
 * suspected takeover) stops it and signs every session out at once.
 *
 * MUTABA3A_ADMIN_TOKEN is read from the environment, never from a flag, so it
 * does not land in shell history.
 */

export interface UsersCliDeps {
  fetch: typeof fetch;
  /** Used when --url is not given. */
  url: string;
  token: string | undefined;
  out: (line: string) => void;
  err: (line: string) => void;
}

const COMMANDS = ['create', 'grant', 'revoke', 'rotate', 'disable', 'enable', 'revoke-sessions', 'terms', 'firm-requests', 'firm-enable', 'firm-disable', 'firm-decline', 'billing-grant', 'billing-revoke', 'billing-grants', 'billing-link', 'billing-unlinked', 'billing-reconcile'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = [
  'usage: tsx src/scripts/users.ts <command> [--url <base url>] <options>',
  '  create  --email <email> --name <display name> [--organization-id <uuid>] [--currency ILS|USD|EUR] [--timezone <IANA>] [--locale en|ar] [--valid-hours <1-720>]',
  '          (every user gets a personal profile; with no --organization-id, --currency and --timezone are required)',
  '          prints a one-time setup link (72 hours unless --valid-hours) through which the person sets their own password',
  '  grant   --email <email> --organization-id <uuid> [--role owner]',
  `          --role owner: a co-owner of a Business profile someone created (MUT-373; at most ${MAX_PROFILE_OWNERS} owners); prints the note for both partners`,
  '  revoke  --email <email> --organization-id <uuid>',
  '  rotate  --email <email> [--valid-hours <1-720>] [--lock]',
  '          prints a new setup link; their current password keeps working until they use it.',
  '          --lock (a suspected takeover): the current password stops working and every session is signed out now',
  '  disable --email <email>',
  '  enable  --email <email>',
  '  revoke-sessions --email <email>',
  '  terms   lists every user with the terms version they last accepted and the client release that showed it, flagging who is behind the current terms',
  '  firm-requests   (pending requests for firm features, oldest first)',
  '  firm-enable  --organization-id <uuid> [--owner <email>[,<email>]]',
  '          on in place; an owned Business profile needs no --owner (its owner is OWNER); an operator firm needs at least one member',
  '  firm-disable --organization-id <uuid>',
  '  firm-decline --organization-id <uuid>',
  '  billing-grant  (--email <email> | --organization-id <uuid>) --tier FREELANCER|FIRM --reason <text> [--expires <ISO date-time>]',
  '          covers the person\'s own profiles, or one profile (MUT-358); a pilot user gets one until their Stripe subscription is linked',
  '  billing-revoke --grant-id <uuid>',
  '  billing-grants [--email <email> | --organization-id <uuid>] [--active]',
  '  billing-link   --customer cus_… --email <email> [--currency ILS|USD]   (currency only for a customer the server has not seen yet)',
  '  billing-unlinked   (Stripe customers not yet matched to a person)',
  '  billing-reconcile  (MUT-360: re-read every Stripe subscription now, as the nightly job does)',
  'MUTABA3A_ADMIN_TOKEN is read from the environment.',
].join('\n');

const SHOWN_ONCE = 'Setup link — shown once; send it to the person over a secure channel.';

export interface UserSummary {
  id: string;
  email: string;
  locale: string;
  status: string;
}

export class CliError extends Error {}

export async function runUsersCommand(argv: string[], deps: UsersCliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    deps.err(USAGE);
    return 2;
  }
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: rest,
      options: {
        url: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        'organization-id': { type: 'string' },
        locale: { type: 'string' },
        currency: { type: 'string' },
        timezone: { type: 'string' },
        'valid-hours': { type: 'string' },
        lock: { type: 'boolean' },
        owner: { type: 'string' },
        role: { type: 'string' },
        tier: { type: 'string' },
        reason: { type: 'string' },
        expires: { type: 'string' },
        'grant-id': { type: 'string' },
        customer: { type: 'string' },
        active: { type: 'boolean' },
      },
    }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }

  try {
    if (!deps.token) throw new CliError('MUTABA3A_ADMIN_TOKEN is not set');
    const text = (name: string): string | undefined => {
      const value = values[name];
      return typeof value === 'string' && value !== '' ? value : undefined;
    };
    const client = adminClient(deps.fetch, text('url') ?? deps.url, deps.token);
    const need = (name: string): string => {
      const value = text(name);
      if (!value) throw new CliError(`--${name} is required`);
      return value;
    };
    await COMMAND_HANDLERS[command]({ client, need, optional: text, flag: (name) => values[name] === true, out: deps.out });
    return 0;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    deps.err(e.message);
    return 1;
  }
}

export interface AdminClient {
  call<T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T>;
  userByEmail(email: string): Promise<UserSummary>;
}

/** Exported for seed-demo-account.ts (MUT-136), the admin-API half of seeding a local test account. */
export function adminClient(fetchFn: typeof fetch, baseUrl: string, token: string): AdminClient {
  const call = async <T>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> => {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-token': token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const json = (await res.json()) as T & { error?: { code: string; message: string } };
    if (!res.ok) throw new CliError(`${method} ${path.split('?')[0]} → ${res.status} ${json.error?.code}: ${json.error?.message}`);
    return json;
  };
  return {
    call,
    userByEmail: async (email) => {
      const { users } = await call<{ users: UserSummary[] }>('GET', `/admin/v1/users?email=${encodeURIComponent(email)}`);
      const [user] = users;
      if (!user) throw new CliError(`No user with email ${email}`);
      return user;
    },
  };
}

interface HandlerContext {
  client: AdminClient;
  need(name: string): string;
  optional(name: string): string | undefined;
  flag(name: string): boolean;
  out(line: string): void;
}

/** MUT-235: what POST /admin/v1/users and …/setup-link return; the URL carries the token in its fragment. */
interface SetupLink {
  url: string;
  expiresAt: string;
}

/** --valid-hours, as a whole number of hours; the server enforces its 1–720 bounds. */
function validHours(optional: HandlerContext['optional']): number | undefined {
  const raw = optional('valid-hours');
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw)) throw new CliError('--valid-hours must be a whole number of hours');
  return Number(raw);
}

function printSetupLink(out: HandlerContext['out'], link: SetupLink): void {
  out('');
  out(`${SHOWN_ONCE} Valid until ${link.expiresAt} (UTC).`);
  out(link.url);
}

/** MUT-300: the organization fields the firm verbs print. */
interface FirmOrganization {
  id: string;
  name: string;
}

interface FirmRequestRow {
  organizationId: string;
  name: string;
  requestedAt: string;
  requestedByEmail: string | null;
  owned: boolean;
}

const FIRM_HANDLERS: Record<Extract<Command, `firm-${string}`>, (ctx: HandlerContext) => Promise<void>> = {
  'firm-requests': async ({ client, out }) => {
    let cursor: string | null = null;
    let printed = 0;
    do {
      const query: string = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const page: { data: FirmRequestRow[]; nextCursor: string | null } = await client.call('GET', `/admin/v1/firm-requests${query}`);
      for (const r of page.data) {
        out(`${r.organizationId} ${r.name} — requested ${r.requestedAt} by ${r.requestedByEmail ?? 'an unknown user'} (${r.owned ? 'owned' : 'operator firm'})`);
      }
      printed += page.data.length;
      cursor = page.nextCursor;
    } while (cursor);
    if (printed === 0) out('no pending firm requests');
  },
  'firm-enable': async ({ client, need, optional, out }) => {
    const emails = (optional('owner') ?? '').split(',').map((e) => e.trim()).filter(Boolean);
    const ownerUserIds = [];
    for (const email of emails) ownerUserIds.push((await client.userByEmail(email)).id);
    const organizationId = need('organization-id');
    const body = { firmEnabled: true, ...(ownerUserIds.length > 0 ? { ownerUserIds } : {}) };
    const { organization } = await client.call<{ organization: FirmOrganization }>('PATCH', `/admin/v1/organizations/${organizationId}`, body);
    out(`${organization.id} ${organization.name}: firm features on`);
  },
  'firm-disable': async ({ client, need, out }) => {
    const { organization } = await client.call<{ organization: FirmOrganization }>('PATCH', `/admin/v1/organizations/${need('organization-id')}`, { firmEnabled: false });
    out(`${organization.id} ${organization.name}: firm features off`);
  },
  'firm-decline': async ({ client, need, out }) => {
    const { organization } = await client.call<{ organization: FirmOrganization }>('DELETE', `/admin/v1/organizations/${need('organization-id')}/firm-request`);
    out(`${organization.id} ${organization.name}: firm request declined`);
  },
};

/** MUT-358: the operator's billing levers (routes/admin-billing.ts). */
interface GrantRow {
  id: string;
  userId: string | null;
  organizationId: string | null;
  tier: string;
  reason: string;
  expiresAt: string | null;
  revokedAt: string | null;
}

interface BillingAccountRow {
  stripeCustomerId: string;
  userId: string | null;
  country: string | null;
  currency: string;
  createdAt: string;
}

function describeGrant(g: GrantRow): string {
  const target = g.userId ? `person ${g.userId}` : `profile ${g.organizationId}`;
  const state = g.revokedAt ? `revoked ${g.revokedAt}` : g.expiresAt ? `until ${g.expiresAt}` : 'no expiry';
  return `${g.id} ${g.tier} for ${target} (${state}): ${g.reason}`;
}

/** MUT-373 (DR8): what the operator sends both partners when a profile becomes shared, in both languages. */
export function partnerNote(profileName: string): string[] {
  return [
    '',
    'Send this to both partners:',
    `EN: ${profileName} is now shared. You both own it fully: income, clients, payments, expenses and its settings. Each of your personal profiles stays private.`,
    `AR: ${profileName} أصبح مشتركًا. يملكه كلٌّ منكما بالكامل: الدخل والعملاء والدفعات والمصاريف والإعدادات. ويبقى ملفّ كلٍّ منكما الشخصي خاصًّا به.`,
  ];
}

const BILLING_HANDLERS: Record<Extract<Command, `billing-${string}`>, (ctx: HandlerContext) => Promise<void>> = {
  'billing-grant': async ({ client, need, optional, out }) => {
    const email = optional('email');
    const organizationId = optional('organization-id');
    if ((email === undefined) === (organizationId === undefined)) throw new CliError('give exactly one of --email and --organization-id');
    const expires = optional('expires');
    const target = email ? { userId: (await client.userByEmail(email)).id } : { organizationId };
    const grant = await client.call<GrantRow>('POST', '/admin/v1/billing/grants', { ...target, tier: need('tier'), reason: need('reason'), ...(expires ? { expiresAt: expires } : {}) });
    out(`granted: ${describeGrant(grant)}`);
  },
  'billing-revoke': async ({ client, need, out }) => {
    const { grant, revoked } = await client.call<{ grant: GrantRow; revoked: boolean }>('DELETE', `/admin/v1/billing/grants/${need('grant-id')}`);
    out(revoked ? `revoked: ${describeGrant(grant)}` : `already revoked: ${describeGrant(grant)}`);
  },
  'billing-grants': async ({ client, optional, flag, out }) => {
    const email = optional('email');
    const params = new URLSearchParams();
    if (email) params.set('userId', (await client.userByEmail(email)).id);
    const organizationId = optional('organization-id');
    if (organizationId) params.set('organizationId', organizationId);
    if (flag('active')) params.set('active', 'true');
    const query = params.size > 0 ? `?${params.toString()}` : '';
    const { grants } = await client.call<{ grants: GrantRow[] }>('GET', `/admin/v1/billing/grants${query}`);
    for (const g of grants) out(describeGrant(g));
    if (grants.length === 0) out('no grants');
  },
  'billing-link': async ({ client, need, optional, out }) => {
    const user = await client.userByEmail(need('email'));
    const currency = optional('currency');
    const { account, linked } = await client.call<{ account: BillingAccountRow; linked: boolean }>('POST', '/admin/v1/billing/accounts/link', {
      stripeCustomerId: need('customer'),
      userId: user.id,
      ...(currency ? { currency } : {}),
    });
    out(`${account.stripeCustomerId} ${linked ? 'linked to' : 'was already linked to'} ${user.email} (${account.currency})`);
  },
  'billing-unlinked': async ({ client, out }) => {
    const { accounts } = await client.call<{ accounts: BillingAccountRow[] }>('GET', '/admin/v1/billing/accounts?linked=false');
    for (const a of accounts) out(`${a.stripeCustomerId} ${a.currency}${a.country ? ` ${a.country}` : ''}: seen ${a.createdAt}`);
    if (accounts.length === 0) out('every Stripe customer is linked');
  },
  'billing-reconcile': async ({ client, out }) => {
    const s = await client.call<{ checked: number; changed: number; unlinked: number; pruned: number; errors: { subscriptionId: string | null; code: string }[] }>(
      'POST',
      '/admin/v1/billing/stripe/reconcile',
    );
    out(`checked ${s.checked}, changed ${s.changed}, unlinked ${s.unlinked}, pruned ${s.pruned}`);
    for (const e of s.errors) out(`  ${e.subscriptionId ?? '(listing)'}: ${e.code}`);
  },
};

const COMMAND_HANDLERS: Record<Command, (ctx: HandlerContext) => Promise<void>> = {
  create: async ({ client, need, optional, out }) => {
    const locale = optional('locale');
    const organizationId = optional('organization-id');
    const defaultCurrency = optional('currency');
    const timezone = optional('timezone');
    const setupLinkValidHours = validHours(optional);
    const created = await client.call<{
      user: UserSummary;
      memberships: { organizationId: string }[];
      personalProfile: { id: string; name: string };
      setupLink: SetupLink;
    }>('POST', '/admin/v1/users', {
      email: need('email'),
      displayName: need('name'),
      ...(organizationId ? { organizationId } : {}),
      ...(defaultCurrency ? { defaultCurrency } : {}),
      ...(timezone ? { timezone } : {}),
      ...(locale ? { locale } : {}),
      ...(setupLinkValidHours === undefined ? {} : { setupLinkValidHours }),
    });
    out(`user ${created.user.id} ${created.user.email} (${created.user.locale})`);
    out(`personal ${created.personalProfile.id} ${created.personalProfile.name}`);
    for (const m of created.memberships) out(`membership ${m.organizationId}`);
    printSetupLink(out, created.setupLink);
  },
  grant: async ({ client, need, optional, out }) => {
    const role = optional('role');
    if (role !== undefined && role !== 'owner') throw new CliError('--role takes only "owner" (a co-owner of a Business profile; MUT-373)');
    const user = await client.userByEmail(need('email'));
    const organizationId = need('organization-id');
    const { created } = await client.call<{ created: boolean }>('POST', `/admin/v1/users/${user.id}/memberships`, { organizationId, ...(role ? { role: 'OWNER' } : {}) });
    if (!role) {
      out(`${user.email} → ${organizationId}: ${created ? 'access granted' : 'already had access'}`);
      return;
    }
    out(`${user.email} → ${organizationId}: ${created ? 'co-owner added' : 'already a co-owner'}`);
    if (created) {
      // MUT-373 (design review DR8): the app says nothing when a profile appears, so the operator tells both partners.
      const { organization } = await client.call<{ organization: { name: string } }>('GET', `/admin/v1/organizations/${organizationId}`);
      for (const line of partnerNote(organization.name)) out(line);
    }
  },
  revoke: async ({ client, need, out }) => {
    const user = await client.userByEmail(need('email'));
    const organizationId = need('organization-id');
    const { removed } = await client.call<{ removed: boolean }>('DELETE', `/admin/v1/users/${user.id}/memberships/${organizationId}`);
    out(`${user.email} → ${organizationId}: ${removed ? 'access removed' : 'had no access'}`);
  },
  rotate: async ({ client, need, optional, flag, out }) => {
    const user = await client.userByEmail(need('email'));
    const hours = validHours(optional);
    const issued = await client.call<{ setupLink: SetupLink; lock: boolean }>('POST', `/admin/v1/users/${user.id}/setup-link`, {
      ...(hours === undefined ? {} : { validHours: hours }),
      lock: flag('lock'),
    });
    const { setupLink } = issued;
    out(`setup link issued for ${user.email}`);
    // From the server's answer, not the flag: the message must say what actually happened.
    out(issued.lock ? 'Their password no longer works and every session is signed out.' : 'Their current password keeps working until they use this link.');
    printSetupLink(out, setupLink);
  },
  disable: async (ctx) => setStatus(ctx, 'disable'),
  enable: async (ctx) => setStatus(ctx, 'enable'),
  // MUT-324 T1: who hasn't accepted the current terms (someone on the phone only is never asked until MUT-344).
  terms: async ({ client, out }) => {
    const report = await client.call<{
      current: string;
      users: Array<{ email: string; status: string; latestVersion: string | null; clientRelease: string | null; accepted: boolean }>;
    }>('GET', '/admin/v1/terms-acceptance');
    out(`current terms ${report.current}`);
    // MUT-354: the client release that showed the latest accepted version, - when none was recorded
    for (const u of report.users) out(`${u.email}  ${u.status}  ${u.latestVersion ?? 'never'}  ${u.clientRelease ?? '-'}  ${u.accepted ? 'ok' : 'BEHIND'}`);
    const active = report.users.filter((u) => u.status === 'ACTIVE');
    out(`${active.filter((u) => !u.accepted).length} of ${active.length} active users behind the current terms`);
  },
  'revoke-sessions': async ({ client, need, out }) => {
    const user = await client.userByEmail(need('email'));
    const { revoked } = await client.call<{ revoked: number }>('POST', `/admin/v1/users/${user.id}/sessions/revoke`);
    out(`${user.email}: ${revoked} ${revoked === 1 ? 'session' : 'sessions'} revoked`);
  },
  ...FIRM_HANDLERS,
  ...BILLING_HANDLERS,
};


async function setStatus({ client, need, out }: HandlerContext, verb: 'disable' | 'enable'): Promise<void> {
  const target = await client.userByEmail(need('email'));
  const { user } = await client.call<{ user: UserSummary }>('POST', `/admin/v1/users/${target.id}/${verb}`);
  out(`${user.email} is now ${user.status}`);
}

function isCommand(value: string | undefined): value is Command {
  return (COMMANDS as readonly string[]).includes(value ?? '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runUsersCommand(process.argv.slice(2), {
    fetch,
    url: 'http://localhost:8787',
    token: process.env.MUTABA3A_ADMIN_TOKEN,
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}
