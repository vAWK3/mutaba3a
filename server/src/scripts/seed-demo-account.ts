import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ensureSeedAccount } from './seed-demo-account/adminAccount.js';
import { ApiClientError, clientFor, signIn, type ApiClientDeps } from './seed-demo-account/apiClient.js';
import { buildFixtures } from './seed-demo-account/fixtures.js';
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
 */

export interface SeedDemoAccountDeps {
  fetch: typeof fetch;
  /** Used when --url is not given. */
  url: string;
  adminToken: string | undefined;
  /** MUTABA3A_SEED_PASSWORD: the existing account's current password; skips rotation. */
  seedPassword?: string | undefined;
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
  'usage: tsx src/scripts/seed-demo-account.ts [--url <base url>] [--email <email>] [--name <display name>] [--currency ILS|USD|EUR] [--timezone <IANA>] [--locale en|ar]',
  'MUTABA3A_ADMIN_TOKEN is read from the environment.',
  'Set MUTABA3A_SEED_PASSWORD to an existing account\'s current password to keep it instead of rotating.',
].join('\n');

export async function runSeedDemoAccount(argv: string[], deps: SeedDemoAccountDeps): Promise<number> {
  let values: Record<string, string | undefined>;
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

  const baseUrl = values.url ?? deps.url;
  if (!URL.canParse(baseUrl)) {
    deps.err(`--url must be an absolute URL, got "${baseUrl}" (an unset shell variable?)\n${USAGE}`);
    return 2;
  }
  const email = values.email ?? DEFAULTS.email;
  const displayName = values.name ?? DEFAULTS.name;
  const currency = values.currency ?? DEFAULTS.currency;
  const timezone = values.timezone ?? DEFAULTS.timezone;
  const localeValue = values.locale ?? DEFAULTS.locale;
  if (localeValue !== 'en' && localeValue !== 'ar') {
    deps.err(`--locale must be "en" or "ar", got "${localeValue}"\n${USAGE}`);
    return 2;
  }
  const locale = localeValue;

  try {
    const admin = adminClient(deps.fetch, baseUrl, deps.adminToken);
    const credentials = await ensureSeedAccount(admin, { email, displayName, currency, timezone, locale, keepPassword: deps.seedPassword });
    deps.out(`account ${credentials.userId} ${credentials.email}`);
    if (deps.seedPassword && credentials.rotated) deps.err('MUTABA3A_SEED_PASSWORD ignored: the account is new, so it was issued a password (below)');

    const apiDeps: ApiClientDeps = { fetch: deps.fetch, baseUrl };
    const session = await signInOrExplain(apiDeps, email, credentials);
    const client = clientFor(apiDeps, session);
    deps.out(`profile ${session.organizationId}`);

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

/** Keeps every Idempotency-Key within [A-Za-z0-9_-:.]{8,128} and tied to exactly the fields that determine the request body. */
function key(...parts: string[]): string {
  return `seed-${parts.join('-')}`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const code = await runSeedDemoAccount(process.argv.slice(2), {
    fetch,
    url: 'http://localhost:8787',
    adminToken: process.env.MUTABA3A_ADMIN_TOKEN,
    seedPassword: process.env.MUTABA3A_SEED_PASSWORD || undefined,
    now: () => new Date(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  });
  process.exit(code);
}
