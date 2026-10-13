import { CliError, type AdminClient } from '../users.js';

/**
 * The admin-API half of seeding a demo account (MUT-136): get-or-create the
 * QA user, then always rotate its password through the same admin surface
 * `npm run rotate:password` uses. Rotating every run means the script never
 * has to persist a secret to disk or assume a one-time-shown
 * `initialPassword` from a prior run is still known — the returned password
 * is always fresh and always correct for the account this call just touched.
 */

export interface EnsureSeedAccountOptions {
  email: string;
  displayName: string;
  /** Required when the account doesn't exist yet (no organization-id → a personal-only profile, MUT-120). */
  currency: string;
  timezone: string;
}

export interface SeedAccountCredentials {
  userId: string;
  email: string;
  password: string;
}

export async function ensureSeedAccount(admin: AdminClient, options: EnsureSeedAccountOptions): Promise<SeedAccountCredentials> {
  const userId = await findOrCreate(admin, options);
  const { password } = await admin.call<{ password: string }>('POST', `/admin/v1/users/${userId}/password`);
  return { userId, email: options.email, password };
}

async function findOrCreate(admin: AdminClient, options: EnsureSeedAccountOptions): Promise<string> {
  try {
    return (await admin.userByEmail(options.email)).id;
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
  }
  const created = await admin.call<{ user: { id: string } }>('POST', '/admin/v1/users', {
    email: options.email,
    displayName: options.displayName,
    defaultCurrency: options.currency,
    timezone: options.timezone,
  });
  return created.user.id;
}
