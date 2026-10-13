import { CliError, type AdminClient } from '../users.js';

/**
 * The admin-API half of seeding a demo account (MUT-136): get-or-create the
 * QA user, then rotate its password through the same admin surface
 * `npm run rotate:password` uses. Rotating every run means the script never
 * has to persist a secret to disk or assume a one-time-shown
 * `initialPassword` from a prior run is still known — the returned password
 * is always fresh and always correct for the account this call just touched.
 * The one exception is `keepPassword`, for credentials already handed out.
 */

export interface EnsureSeedAccountOptions {
  email: string;
  displayName: string;
  /** Required when the account doesn't exist yet (no organization-id → a personal-only profile, MUT-120). */
  currency: string;
  timezone: string;
  /** Drives the personal profile's own name and the expense-category preset's language (MUT-143) — both are fixed at account creation, not the in-app language picker. Ignored when the account already exists. */
  locale: 'en' | 'ar';
  /**
   * An existing account's current password, to use instead of rotating. For an
   * account whose credentials were handed to someone else (App Store / Play
   * reviewers): rotating would break them and revoke their sessions. Ignored
   * when the account doesn't exist yet — the admin API only issues passwords.
   */
  keepPassword?: string | undefined;
}

export interface SeedAccountCredentials {
  userId: string;
  email: string;
  password: string;
  /** False only when `keepPassword` was used as-is. */
  rotated: boolean;
}

export async function ensureSeedAccount(admin: AdminClient, options: EnsureSeedAccountOptions): Promise<SeedAccountCredentials> {
  const { userId, created } = await findOrCreate(admin, options);
  if (options.keepPassword && !created) {
    return { userId, email: options.email, password: options.keepPassword, rotated: false };
  }
  const { password } = await admin.call<{ password: string }>('POST', `/admin/v1/users/${userId}/password`);
  return { userId, email: options.email, password, rotated: true };
}

async function findOrCreate(admin: AdminClient, options: EnsureSeedAccountOptions): Promise<{ userId: string; created: boolean }> {
  try {
    return { userId: (await admin.userByEmail(options.email)).id, created: false };
  } catch (err) {
    if (!(err instanceof CliError)) throw err;
  }
  const created = await admin.call<{ user: { id: string } }>('POST', '/admin/v1/users', {
    email: options.email,
    displayName: options.displayName,
    defaultCurrency: options.currency,
    timezone: options.timezone,
    locale: options.locale,
  });
  return { userId: created.user.id, created: true };
}
