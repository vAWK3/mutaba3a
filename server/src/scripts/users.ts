import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/**
 * Operator CLI for hosted-portal users (MUT-37, ADR-033). Talks to the admin
 * API of a running service, like `npm run provision`. There is no other way to
 * create a user, grant access or reset a password — by design.
 *
 *   npm run provision:user  -- --url https://api.mutaba3a.app --email nour@firm.ps --name "Nour Haddad" --organization-id <uuid> [--locale ar]
 *   npm run grant:user      -- --email nour@firm.ps --organization-id <uuid>
 *   npm run revoke:user     -- --email nour@firm.ps --organization-id <uuid>
 *   npm run rotate:password -- --email nour@firm.ps
 *   npm run disable:user    -- --email nour@firm.ps
 *   npm run enable:user     -- --email nour@firm.ps
 *   npm run revoke:sessions -- --email nour@firm.ps   (sign out everywhere)
 *
 * MUTABA3A_ADMIN_TOKEN is read from the environment, never from a flag, so it
 * does not land in shell history. Passwords are printed once, on a line of
 * their own, after a "shown once" line.
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
  '  create  --email <email> --name <display name> --organization-id <uuid> [--locale en|ar]',
  '  grant   --email <email> --organization-id <uuid>',
  '  revoke  --email <email> --organization-id <uuid>',
  '  rotate  --email <email>',
  '  disable --email <email>',
  '  enable  --email <email>',
  '  revoke-sessions --email <email>',
  'MUTABA3A_ADMIN_TOKEN is read from the environment.',
].join('\n');

const SHOWN_ONCE = 'Password — shown once; deliver it to the person over a secure channel:';

interface UserSummary {
  id: string;
  email: string;
  locale: string;
  status: string;
}

class CliError extends Error {}

export async function runUsersCommand(argv: string[], deps: UsersCliDeps): Promise<number> {
  const [command, ...rest] = argv;
  if (!isCommand(command)) {
    deps.err(USAGE);
    return 2;
  }
  let values: Record<string, string | undefined>;
  try {
    values = parseArgs({
      args: rest,
      options: {
        url: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        'organization-id': { type: 'string' },
        locale: { type: 'string' },
      },
    }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }

  try {
    if (!deps.token) throw new CliError('MUTABA3A_ADMIN_TOKEN is not set');
    const client = adminClient(deps.fetch, values.url ?? deps.url, deps.token);
    const need = (name: string): string => {
      const value = values[name];
      if (!value) throw new CliError(`--${name} is required`);
      return value;
    };
    await COMMAND_HANDLERS[command]({ client, need, optional: (name) => values[name], out: deps.out });
    return 0;
  } catch (e) {
    if (!(e instanceof CliError)) throw e;
    deps.err(e.message);
    return 1;
  }
}

interface AdminClient {
  call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T>;
  userByEmail(email: string): Promise<UserSummary>;
}

function adminClient(fetchFn: typeof fetch, baseUrl: string, token: string): AdminClient {
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
  out(line: string): void;
}

const COMMAND_HANDLERS: Record<Command, (ctx: HandlerContext) => Promise<void>> = {
  create: async ({ client, need, optional, out }) => {
    const locale = optional('locale');
    const created = await client.call<{ user: UserSummary; memberships: { organizationId: string }[]; initialPassword: string }>('POST', '/admin/v1/users', {
      email: need('email'),
      displayName: need('name'),
      organizationId: need('organization-id'),
      ...(locale ? { locale } : {}),
    });
    out(`user ${created.user.id} ${created.user.email} (${created.user.locale})`);
    for (const m of created.memberships) out(`membership ${m.organizationId}`);
    out('');
    out(SHOWN_ONCE);
    out(created.initialPassword);
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
  rotate: async ({ client, need, out }) => {
    const user = await client.userByEmail(need('email'));
    const { password } = await client.call<{ password: string }>('POST', `/admin/v1/users/${user.id}/password`);
    out(`password reset for ${user.email}`);
    out('');
    out(SHOWN_ONCE);
    out(password);
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
