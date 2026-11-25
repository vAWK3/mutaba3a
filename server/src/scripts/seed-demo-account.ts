import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ensureSeedAccount } from './seed-demo-account/adminAccount.js';
import { ApiClientError, clientFor, signIn, type ApiClientDeps } from './seed-demo-account/apiClient.js';
import { buildFixtures } from './seed-demo-account/fixtures.js';
import { seedKey as key } from './seed-demo-account/keys.js';
import { pruneEarlierBatches, type SeedClaims } from './seed-demo-account/pruneEarlierBatches.js';
import { adminClient } from './users.js';

/**
 * Populates a local, disposable account with realistic clients, projects,
 * income, expenses and payments (MUT-136) — so the iOS app has something to
 * screenshot for the App Store (MUT-137) instead of an empty first run.
 *
 *   npm run seed:demo-account -- --url http://localhost:8787 [--email qa@mutaba3a.test] [--name "Mutaba3a QA"] [--currency ILS] [--timezone Asia/Jerusalem] [--locale en|ar]
 *
 * MUTABA3A_ADMIN_TOKEN is read from the environment, never from a flag, same
 * as users.ts. Re-running is safe: the account is reused (its password is
 * rotated fresh every run, see adminAccount.ts — unless MUTABA3A_SEED_PASSWORD
 * holds the current one, for a store-review account whose credentials are
 * already handed out), and every customer/project/
 * income/expense/settle call carries a deterministic Idempotency-Key, so a
 * same-day re-run replays the exact prior writes instead of duplicating them.
 * A re-run on a *later* day naturally seeds a fresh batch of recent-looking
 * transactions (the fixtures' dates are relative to "now"), on top of the
 * same customers/projects — intentional for a screenshot account, which
 * should always have a few genuinely recent entries.
 *
 * --prune-earlier-batches makes that a replacement instead of a pile-up (the
 * QA account gathered a batch a day, 2026-11-14): before today's batch, the
 * batches this seed wrote on earlier days are removed through the API, found
 * by the server's own record of the seed's keys (pruneEarlierBatches.ts). Rows
 * the seed didn't write are never touched. Reading that record needs the
 * server's database: DATABASE_URL, the one the server at --url runs on.
 */

export interface SeedDemoAccountDeps {
  fetch: typeof fetch;
  /** Used when --url is not given. */
  url: string;
  adminToken: string | undefined;
  /** MUTABA3A_SEED_PASSWORD: the existing account's current password; skips rotation. */
  seedPassword?: string | undefined;
  /** For --prune-earlier-batches: the seed's stored claims, from the server's database. Undefined → the flag is refused. */
  claims?: SeedClaims | undefined;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
}

const DEFAULTS = {
  email: 'qa@mutaba3a.test',
  name: 'Mutaba3a QA',
  currency: 'ILS',
  timezone: 'Asia/Jerusalem',
  locale: 'en',
};

const USAGE = [
  'usage: tsx src/scripts/seed-demo-account.ts [--url <base url>] [--email <email>] [--name <display name>] [--currency ILS|USD|EUR] [--timezone <IANA>] [--locale en|ar] [--prune-earlier-batches]',
  'MUTABA3A_ADMIN_TOKEN is read from the environment.',
  '--prune-earlier-batches removes the batches this seed wrote on earlier days first; it reads DATABASE_URL (the server\'s database).',
  'Set MUTABA3A_SEED_PASSWORD to an existing account\'s current password to keep it instead of rotating.',
].join('\n');

export async function runSeedDemoAccount(argv: string[], deps: SeedDemoAccountDeps): Promise<number> {
  let values: Record<string, string | boolean | undefined>;
  try {
    values = parseArgs({
      args: argv,
      options: {
        url: { type: 'string' },
        email: { type: 'string' },
        name: { type: 'string' },
        currency: { type: 'string' },
        timezone: { type: 'string' },
        locale: { type: 'string' },
        'prune-earlier-batches': { type: 'boolean' },
      },
    }).values;
  } catch (e) {
    deps.err(`${(e as Error).message}\n${USAGE}`);
    return 2;
  }

  if (!deps.adminToken) {
    deps.err('MUTABA3A_ADMIN_TOKEN is not set');
    return 1;
  }

  const prune = values['prune-earlier-batches'] === true;
  if (prune && !deps.claims) {
    deps.err(`--prune-earlier-batches needs DATABASE_URL, the database of the server at --url\n${USAGE}`);
    return 2;
  }
  const str = (name: string): string | undefined => (typeof values[name] === 'string' ? (values[name] as string) : undefined);
  const baseUrl = str('url') ?? deps.url;
  if (!URL.canParse(baseUrl)) {
    deps.err(`--url must be an absolute URL, got "${baseUrl}" (an unset shell variable?)\n${USAGE}`);
    return 2;
  }
  const email = str('email') ?? DEFAULTS.email;
  const displayName = str('name') ?? DEFAULTS.name;
  const currency = str('currency') ?? DEFAULTS.currency;
  const timezone = str('timezone') ?? DEFAULTS.timezone;
  const localeValue = str('locale') ?? DEFAULTS.locale;
  if (localeValue !== 'en' && localeValue !== 'ar') {
    deps.err(`--locale must be "en" or "ar", got "${localeValue}"\n${USAGE}`);
    return 2;
  }
  const locale = localeValue;

  try {
    const admin = adminClient(deps.fetch, baseUrl, deps.adminToken);
    const apiDeps: ApiClientDeps = { fetch: deps.fetch, baseUrl };
    const credentials = await ensureSeedAccount(admin, apiDeps, { email, displayName, currency, timezone, locale, keepPassword: deps.seedPassword });
    deps.out(`account ${credentials.userId} ${credentials.email}`);
    if (deps.seedPassword && credentials.rotated) deps.err('MUTABA3A_SEED_PASSWORD ignored: the account is new, so it was issued a password (below)');

    const session = await signInOrExplain(apiDeps, email, credentials);
    const client = clientFor(apiDeps, session);
    deps.out(`profile ${session.organizationId}`);

    if (prune && deps.claims) {
      const pruned = await pruneEarlierBatches({ client, claims: deps.claims, organizationId: session.organizationId, userId: credentials.userId, now: deps.now() });
      deps.out(`pruned earlier batches: ${pruned.writes} earlier writes found; ${pruned.payments} settle payments reversed, ${pruned.income} income entries undone, ${pruned.expenses} expenses deleted`);
    }

    const counts = { customers: 0, projects: 0, income: 0, settlements: 0, expenses: 0 };
    for (const clientFixture of buildFixtures(deps.now())) {
      const customer = await client.createCustomer({ name: clientFixture.name }, key(clientFixture.slug, 'customer'));
      counts.customers++;

      for (const projectFixture of clientFixture.projects) {
        const project = await client.createProject(
          { customerId: customer.id, name: projectFixture.name, currency: projectFixture.currency },
          key(clientFixture.slug, projectFixture.slug, 'project'),
        );
        counts.projects++;

        for (const income of projectFixture.income) {
          const created = await client.createIncome(
            {
              kind: income.kind,
              amount: income.amount,
              currency: projectFixture.currency,
              occurredOn: income.occurredOn,
              customerId: customer.id,
              projectId: project.id,
              ...(income.title ? { title: income.title } : {}),
              ...(income.dueDate ? { dueDate: income.dueDate } : {}),
              captureSource: 'app',
            },
            key(clientFixture.slug, projectFixture.slug, 'income', income.slug, income.occurredOn),
          );
          counts.income++;

          if (income.settle) {
            await client.settleReceivable(
              created.id,
              { paidAt: income.settle.paidAt, ...(income.settle.amount ? { amount: income.settle.amount } : {}) },
              key(clientFixture.slug, projectFixture.slug, 'settle', income.slug, income.settle.paidAt),
            );
            counts.settlements++;
          }
        }

        for (const expense of projectFixture.expenses) {
          await client.createExpense(
            {
              occurredOn: expense.occurredOn,
              amount: expense.amount,
              currency: projectFixture.currency,
              title: expense.title,
              ...(expense.vendor ? { vendor: expense.vendor } : {}),
              customerId: customer.id,
              projectId: project.id,
            },
            key(clientFixture.slug, projectFixture.slug, 'expense', expense.slug, expense.occurredOn),
          );
          counts.expenses++;
        }
      }
    }

    deps.out(`seeded ${counts.customers} customers, ${counts.projects} projects, ${counts.income} income entries (${counts.settlements} settled), ${counts.expenses} expenses`);
    deps.out('');
    if (!credentials.rotated) {
      deps.out(`${email}: password unchanged (the one in MUTABA3A_SEED_PASSWORD)`);
      return 0;
    }
    deps.out('Sign in on the iOS app with:');
    deps.out(`  email:    ${email}`);
    deps.out(`  password: ${credentials.password}`);
    return 0;
  } catch (e) {
    deps.err((e as Error).message);
    return 1;
  }
}

/** A kept password that doesn't sign in is an operator mistake, not an API fault — say which variable to fix. */
async function signInOrExplain(apiDeps: ApiClientDeps, email: string, credentials: { password: string; rotated: boolean }) {
  try {
    return await signIn(apiDeps, email, credentials.password);
  } catch (e) {
    if (credentials.rotated || !(e instanceof ApiClientError) || e.status !== 401) throw e;
    throw new Error(`MUTABA3A_SEED_PASSWORD does not sign in to ${email}. Fix it, or unset it to rotate a fresh password (that signs out every device on the account).`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const database = process.argv.includes('--prune-earlier-batches') && process.env.DATABASE_URL ? await databaseClaims(process.env.DATABASE_URL) : undefined;
  const code = await runSeedDemoAccount(process.argv.slice(2), {
    fetch,
    url: 'http://localhost:8787',
    adminToken: process.env.MUTABA3A_ADMIN_TOKEN,
    seedPassword: process.env.MUTABA3A_SEED_PASSWORD || undefined,
    claims: database?.claims,
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  await database?.close();
  process.exit(code);
}

/** Read-only: the completed claims among `claimKeys`, straight from idempotency_keys. Nothing is written here. */
async function databaseClaims(databaseUrl: string): Promise<{ claims: SeedClaims; close: () => Promise<void> }> {
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  return {
    claims: {
      async find(organizationId, claimKeys) {
        const rows = await db.idempotencyKey.findMany({
          where: { organizationId, key: { in: claimKeys }, status: 'COMPLETED', responseStatus: { gte: 200, lt: 300 } },
          select: { key: true, responseBody: true },
        });
        return new Map(rows.map((r) => [r.key, r.responseBody]));
      },
      async live(organizationId, ids) {
        if (ids.length === 0) return new Set();
        const where = { organizationId, id: { in: ids } };
        const [payments, receivables, expenses] = await Promise.all([
          db.payment.findMany({ where: { ...where, status: 'POSTED' }, select: { id: true } }),
          db.receivable.findMany({ where: { ...where, deletedAt: null }, select: { id: true } }),
          db.expense.findMany({ where: { ...where, deletedAt: null }, select: { id: true } }),
        ]);
        return new Set([...payments, ...receivables, ...expenses].map((r) => r.id));
      },
    },
    close: () => db.$disconnect(),
  };
}
