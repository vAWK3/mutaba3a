import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/**
 * Operator CLI for hosted-portal users (MUT-37, ADR-037). Talks to the admin
 * API of a running service, like `npm run provision`. There is no other way to
 * create a user, grant access or reset a password — by design.
 *
 *   npm run provision:user  -- --url https://api.mutaba3a.app --email nour@firm.ps --name "Nour Haddad" --organization-id <uuid> [--locale en] [--valid-hours 72]  (Arabic by default, MUT-209)
 *   npm run provision:user  -- --email solo@me.ps --name "Solo" --currency ILS --timezone Asia/Jerusalem   (no firm; MUT-120)
 *   npm run grant:user      -- --email nour@firm.ps --organization-id <uuid>
 *   npm run revoke:user     -- --email nour@firm.ps --organization-id <uuid>
 *   npm run rotate:password -- --email nour@firm.ps [--valid-hours 72] [--lock]
 *   npm run disable:user    -- --email nour@firm.ps
 *   npm run enable:user     -- --email nour@firm.ps
 *   npm run revoke:sessions -- --email nour@firm.ps   (sign out everywhere)
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

const COMMANDS = ['create', 'grant', 'revoke', 'rotate', 'disable', 'enable', 'revoke-sessions'] as const;
type Command = (typeof COMMANDS)[number];

const USAGE = [
  'usage: tsx src/scripts/users.ts <command> [--url <base url>] <options>',
  '  create  --email <email> --name <display name> [--organization-id <uuid>] [--currency ILS|USD|EUR] [--timezone <IANA>] [--locale en|ar] [--valid-hours <1-720>]',
  '          (every user gets a personal profile; with no --organization-id, --currency and --timezone are required)',
  '          prints a one-time setup link (72 hours unless --valid-hours) through which the person sets their own password',
  '  grant   --email <email> --organization-id <uuid>',
  '  revoke  --email <email> --organization-id <uuid>',
  '  rotate  --email <email> [--valid-hours <1-720>] [--lock]',
  '          prints a new setup link; their current password keeps working until they use it.',
  '          --lock (a suspected takeover): the current password stops working and every session is signed out now',
  '  disable --email <email>',
  '  enable  --email <email>',
  '  revoke-sessions --email <email>',
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
  call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>;
  userByEmail(email: string): Promise<UserSummary>;
}

/** Exported for seed-demo-account.ts (MUT-136), the admin-API half of seeding a local test account. */
export function adminClient(fetchFn: typeof fetch, baseUrl: string, token: string): AdminClient {
  const call = async <T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> => {
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
  grant: async ({ client, need, out }) => {
    const user = await client.userByEmail(need('email'));
    const organizationId = need('organization-id');
    const { created } = await client.call<{ created: boolean }>('POST', `/admin/v1/users/${user.id}/memberships`, { organizationId });
    out(`${user.email} → ${organizationId}: ${created ? 'access granted' : 'already had access'}`);
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
    const lock = flag('lock');
    const { setupLink } = await client.call<{ setupLink: SetupLink }>('POST', `/admin/v1/users/${user.id}/setup-link`, {
      ...(hours === undefined ? {} : { validHours: hours }),
      lock,
    });
    out(`setup link issued for ${user.email}`);
    out(lock ? 'Their password no longer works and every session is signed out.' : 'Their current password keeps working until they use this link.');
    printSetupLink(out, setupLink);
  },
  disable: async (ctx) => setStatus(ctx, 'disable'),
  enable: async (ctx) => setStatus(ctx, 'enable'),
  'revoke-sessions': async ({ client, need, out }) => {
    const user = await client.userByEmail(need('email'));
    const { revoked } = await client.call<{ revoked: number }>('POST', `/admin/v1/users/${user.id}/sessions/revoke`);
    out(`${user.email}: ${revoked} ${revoked === 1 ? 'session' : 'sessions'} revoked`);
  },
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
